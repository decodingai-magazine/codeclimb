// Eval: one evaluator sandbox runs a list of candidates in turn, so every
// candidate of a round runs on the same machine with nothing else running
// (on Inngest, a new one takes over before the old one reaches its hour).
// Before each candidate it is reset and the candidate's commit cloned; then, per
// scenario stage, the stage's `inputs` command writes one split's input on the
// worker host (answers removed), `run` runs the program on it in the sandbox,
// and `score` scores the downloaded outputs on the host. Gold never enters a
// sandbox; the agent never sees inputs, outputs or reports.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { evalMinutes, type NightConfig } from "./config";
import type { CreditStop } from "./credits";
import { ExperimentRepo } from "./git";
import { nightPaths, sandboxName } from "./paths";
import { sandboxBackend } from "./sandbox";
import { isMetered, METER_NETWORK, meter, meterBaseUrl, meterEnv } from "./meter";
import type { MeterCall } from "./meter/proxy";
import { cloneInto, uploadPath } from "./sandbox/repo";
import type { Sandbox } from "./sandbox/types";
import { fill, flattenReport, hostCommand, lastLines } from "./scenario";
import { costMetrics, latencyMetrics, type OpLatency, opLatencies, parseTimings, TIMINGS_FILE } from "./standard-metrics";
import type { Metrics } from "./stats";
import { programSpans } from "./tracing";

const pexec = promisify(execFile);
/** A candidate's time on the evaluator beyond the stages' `run`: reset, clone, uploads, the outputs' download. */
const EVAL_OVERHEAD_MS = 5 * 60_000;

/** Dev scores every round's candidates; test scores the final kept commit once. */
export type EvalSplit = "dev" | "test";

export type EvalRequest = {
  nightId: string;
  evalId: string;
  /** Experiment whose commit is evaluated (`refs/exp/<expId>`). */
  expId: string;
  split: EvalSplit;
  runId?: string;
};

export interface EvalResult {
  ok: boolean;
  error?: string;
  /** Aggregate numeric metrics only; per-item scores stay in `metricsPath`. */
  metrics: Metrics;
  metricsPath: string | null;
  program_usd: number;
  t_provision: number;
  t_eval: number;
  t_teardown: number;
  wall_s: number;
  infra_errors: number;
  /** The models ran out of credits: no score, and the night pauses to run it again. */
  credits?: CreditStop;
  /** The evaluator incarnation that ran it: only evals on the same instance are compared on latency. */
  evaluator_instance: string;
}

const secs = (t0: number) => Math.round((performance.now() - t0) / 10) / 100;

/** Bytes the stage's run wrote, its timings aside: 0 means it produced nothing. */
function outputBytes(dir: string): number {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f !== TIMINGS_FILE && statSync(join(dir, f)).isFile())
    .reduce((n, f) => n + statSync(join(dir, f)).size, 0);
}

/**
 * Why a dev run stops at a stage that wrote nothing: a program that swallowed its errors exits clean, and
 * an empty stage can't be kept, so later stages would only spend money. Test always runs every stage.
 */
export function emptyStageError(stage: string, split: EvalSplit, outputs: string, runLog: string): string | null {
  if (split !== "dev" || outputBytes(outputs)) return null;
  return `stage ${stage}: the run exited clean but wrote no output. End of its log: ${lastLines(runLog, 2000)}`;
}

/**
 * The evaluator's sandbox for the next candidate: the live one, else a new empty one. A metered
 * evaluator joins the metering network, whose relay is made sure of first.
 *
 * On a backend that caps a sandbox's life, a new sandbox takes over (create() replaces the old one)
 * when the next candidate might not finish in the time left. The candidates after it run on another
 * instance, so their latency is not compared with the earlier ones'.
 */
export async function openEvaluator(cfg: NightConfig, nightId: string, evaluatorId: string, runId?: string): Promise<Sandbox> {
  const backend = sandboxBackend(cfg.sandbox);
  const name = sandboxName(evaluatorId);
  if (isMetered(cfg)) await meterBaseUrl(cfg);
  const live = await backend.find(name);
  const needMs = evalMinutes(cfg) * 60_000 + EVAL_OVERHEAD_MS;
  if (live && !(backend.maxActiveMs && ((await live.ageMs?.()) ?? 0) + needMs > backend.maxActiveMs)) return live;
  return backend.create({
    name, baseline: cfg.scenario.image, inngestImage: cfg.scenario.inngest_image, network: isMetered(cfg) ? METER_NETWORK : "none",
    labels: { "cc.night": nightId, ...(runId ? { "cc.run": runId } : {}) },
  });
}

export async function closeEvaluator(cfg: NightConfig, evaluatorId: string): Promise<void> {
  await (await sandboxBackend(cfg.sandbox).find(sandboxName(evaluatorId)))?.destroy();
}

// Kills every process but PID 1, the Inngest guest agent (`init` processes), a published
// image's `sleep` CMD (a child of Inngest's reaper; killing it ends the sandbox's exec) and
// this script's own chain (its parent and its children), waits until they are gone, then
// wipes everything a candidate writes to. Zombies are skipped: PID 1 (`sleep` under
// Docker) never reaps them, and they hold nothing.
export const RESET_SCRIPT = `
others() {
  n=0
  for p in /proc/[0-9]*; do
    q=\${p#/proc/}
    case $q in 1|$$|$PPID) continue ;; esac
    read -r st < "$p/stat" 2>/dev/null || continue
    st=\${st##*) }
    set -- $st
    [ "$2" = "$$" ] && continue
    [ "$1" = Z ] && continue
    read -r comm < "$p/comm" 2>/dev/null
    [ "$comm" = init ] && continue
    [ "$comm" = sleep ] && [ "$2" = 1 ] && continue
    kill -KILL "$q" 2>/dev/null
    n=$((n + 1))
  done
  [ "$n" -gt 0 ]
}
i=0
while others; do
  i=$((i + 1))
  [ "$i" -ge 100 ] && { echo "processes survive kill -9" >&2; exit 1; }
  sleep 0.05
done
find /tmp -mindepth 1 -maxdepth 1 ! -name 'cc-exec-*' -exec rm -rf {} +
rm -rf /repo /work /eval "\${HOME:-/root}/.cache"
mkdir -p /work /eval
`;

/** A clean evaluator for the next candidate: no processes or files from the previous one, the commit in /repo. */
async function resetFor(sandbox: Sandbox, commit: { bundle: Buffer; ref: string }): Promise<void> {
  // cwd "/": /repo does not exist before the first clone or after the wipe.
  const r = await sandbox.exec(RESET_SCRIPT, { cwd: "/", timeoutMs: 120_000 });
  if (r.exitCode !== 0) throw new Error(`evaluator reset failed (${r.exitCode}): ${r.stderr.trim()}`);
  await cloneInto(sandbox, commit);
}

const lines = (path: string) => readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).length;

/**
 * Evaluate one candidate in the open evaluator: every stage of the scenario in order. Throws on infra
 * failures (retried); program or scorer failures return ok: false. Metrics are each stage report's
 * numbers, flattened (`<stage>.` in front when the scenario has more than one stage), plus the standard
 * latency (from `timings.jsonl` in a stage's outputs) and cost (the proxy's ledger) metrics.
 */
export async function evalCandidate(cfg: NightConfig, sandbox: Sandbox, req: EvalRequest): Promise<EvalResult> {
  const paths = nightPaths(cfg, req.nightId);
  const dir = paths.evalDir(req.evalId);
  mkdirSync(dir, { recursive: true });
  const { stages } = cfg.scenario;

  const started = performance.now();
  const result: EvalResult = {
    ok: false, metrics: { [cfg.primary_metric]: 0 }, metricsPath: null, program_usd: 0,
    t_provision: 0, t_eval: 0, t_teardown: 0, wall_s: 0, infra_errors: 0,
    evaluator_instance: await sandbox.instanceId(),
  };
  const repo = new ExperimentRepo(paths.gitDir);

  let t0 = performance.now();
  await resetFor(sandbox, await repo.bundle(req.expId));
  result.t_provision = secs(t0);
  const metrics: Metrics = {};
  let ops: OpLatency[] = [];
  let nItems = 0;
  // The program's model calls: a token for this eval only, revoked when the run ends.
  const proxy = isMetered(cfg) ? await meter() : null;
  // The first out-of-credits call ends the stage: every later call would fail too.
  let creditsOut = () => {};
  const outOfCredits = new Promise<null>((r) => {
    creditsOut = () => r(null);
  });
  const token = proxy?.open({
    evalId: req.evalId, allowedModels: cfg.allowed_models, capUsd: cfg.budget_usd.eval, mock: cfg.mock, replayScope: req.nightId,
    onCreditStop: (stop) => {
      result.credits = stop;
      result.error = `out of credits on ${stop.model}: ${stop.message}`;
      creditsOut();
    },
    attrs: { "codeclimb.eval_id": req.evalId, "codeclimb.exp_id": req.expId },
  });
  const env = token ? meterEnv(token, await meterBaseUrl(cfg)) : undefined;
  let calls: MeterCall[] = [];
  try {
    for (const stage of stages) {
      const sdir = join(dir, stage.name);
      const box = `/eval/${stage.name}`;
      mkdirSync(sdir, { recursive: true });
      // Inputs, written on the host: the answers never reach the sandbox.
      t0 = performance.now();
      const inputs = join(sdir, "inputs.jsonl");
      try {
        await hostCommand(cfg.scenario_dir, stage.inputs, { split: req.split, inputs });
      } catch (e) {
        throw new Error(`stage ${stage.name}: inputs: ${(e as Error).message}`); // the scenario's fault: retried, then the eval fails
      }
      nItems += lines(inputs);
      await uploadPath(sandbox, inputs, `${box}/inputs.jsonl`);
      for (const [to, from] of Object.entries(stage.files)) await uploadPath(sandbox, resolve(cfg.scenario_dir, from), to);
      result.t_provision += secs(t0);

      const runStartMs = Date.now();
      t0 = performance.now();
      const exec = sandbox.exec(
        `mkdir -p ${box}/out && (${fill(stage.run, { inputs: `${box}/inputs.jsonl`, out: `${box}/out` })}) > ${box}/run.log 2>&1`,
        { cwd: "/repo", timeoutMs: cfg.timeouts.eval_min * 60_000, ...(env ? { env } : {}) },
      );
      exec.catch(() => undefined); // abandoned on running out of credits; the evaluator's close ends it
      const run = await Promise.race([exec, outOfCredits]);
      result.t_eval += secs(t0);
      // Saved even on a clean exit: a program that swallows its errors shows them only here. It stays on the host.
      const runLog = await sandbox.readFile(`${box}/run.log`).catch(() => Buffer.from(""));
      writeFileSync(join(sdir, "run.log"), runLog);
      if (!run || result.credits) return result; // the program may have swallowed the errors and exited 0
      if (proxy) await meterBaseUrl(cfg); // Throws if the way to the proxy went during the run: the scores would be the outage's.
      if (run.timedOut || run.exitCode !== 0) {
        const log = lastLines(runLog.toString(), 2000);
        result.error = `stage ${stage.name}: ${run.timedOut ? `run timed out after ${cfg.timeouts.eval_min} min` : `run exited ${run.exitCode}: ${log}`}`;
        return result;
      }
      const tar = await sandbox.exec(`tar -C ${box}/out -cf /tmp/cc-out.tar .`, { cwd: "/" });
      if (tar.exitCode !== 0) throw new Error(`cannot pack outputs: ${tar.stderr}`);
      writeFileSync(join(sdir, "outputs.tar"), await sandbox.readFile("/tmp/cc-out.tar"));
      const outputs = join(sdir, "outputs");
      mkdirSync(outputs, { recursive: true });
      await pexec("tar", ["-xf", join(sdir, "outputs.tar"), "-C", outputs]);
      result.error = emptyStageError(stage.name, req.split, outputs, runLog.toString()) ?? undefined;
      if (result.error) return result;

      // Latency: only the program's operations, as the runner timed them.
      const timingsPath = join(outputs, TIMINGS_FILE);
      if (existsSync(timingsPath)) {
        try {
          const stageOps = opLatencies(parseTimings(readFileSync(timingsPath, "utf8")));
          programSpans({ "codeclimb.eval_id": req.evalId, "codeclimb.exp_id": req.expId }, runStartMs, stageOps);
          ops = [...ops, ...stageOps];
        } catch (e) {
          result.error = `stage ${stage.name}: the run wrote a bad ${TIMINGS_FILE}: ${(e as Error).message}`;
          return result;
        }
      }

      // Score on the worker host, outside every sandbox.
      const report = join(sdir, "report.json");
      t0 = performance.now();
      try {
        const score = req.split === "dev" && stage.details ? stage.details : stage.score; // test's errors stay unread
        await hostCommand(cfg.scenario_dir, score, { split: req.split, out: outputs, report });
      } catch (e) {
        result.error = `stage ${stage.name}: score failed: ${(e as Error).message}`;
        return result;
      }
      result.t_eval += secs(t0);
      const prefix = stages.length > 1 ? stage.name : "";
      Object.assign(metrics, flattenReport(JSON.parse(readFileSync(report, "utf8")), prefix), {
        [prefix ? `${prefix}.output_bytes` : "output_bytes"]: outputBytes(outputs),
      });
    }
  } finally {
    if (token) calls = proxy!.close(token); // revokes it; spent even when a stage fails
    result.program_usd = calls.reduce((a, c) => a + c.cost_usd, 0);
    if (calls.length) writeFileSync(join(dir, "meter.jsonl"), calls.map((c) => JSON.stringify(c)).join("\n") + "\n");
    result.wall_s = secs(started);
  }

  // Standard metrics win over a scorer's metric of the same name; program $ is the proxy's ledger.
  result.metrics = { ...metrics, ...(ops.length ? latencyMetrics(ops) : {}), ...costMetrics(calls, nItems) };
  result.metricsPath = join(dir, "metrics.json");
  writeFileSync(result.metricsPath, JSON.stringify(result.metrics, null, 2));
  result.ok = typeof result.metrics[cfg.primary_metric] === "number";
  if (!result.ok) result.error = `the stage reports have no primary metric "${cfg.primary_metric}"`;
  return result;
}
