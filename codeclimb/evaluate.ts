// Eval: one evaluator sandbox runs a list of candidates in turn, so every
// candidate of a round runs on the same machine with nothing else running
// (on Inngest, a new one takes over before the old one reaches its hour).
// Before each candidate it is reset and the candidate's commit cloned; then
// `run_cmd` runs on one split's questions (no gold) and `score_cmd` scores the
// outputs against gold on the worker host. Gold never enters a sandbox; the
// agent never sees runner or outputs.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { NightConfig } from "./config";
import { ExperimentRepo } from "./git";
import { nightPaths, sandboxName } from "./paths";
import { sandboxBackend } from "./sandbox";
import { isMetered, METER_NETWORK, meter, meterBaseUrl, meterEnv } from "./meter";
import type { MeterCall } from "./meter/proxy";
import { cloneInto } from "./sandbox/repo";
import type { Sandbox } from "./sandbox/types";
import { costMetrics, latencyMetrics, type OpLatency, opLatencies, parseTimings, TIMINGS_FILE } from "./standard-metrics";
import type { Metrics } from "./stats";
import { programSpans } from "./tracing";

const pexec = promisify(execFile);
/** A candidate's time on the evaluator beyond `run_cmd`: reset, clone, uploads, the outputs' download. */
const EVAL_OVERHEAD_MS = 5 * 60_000;

export type EvalSplit = "opt" | "val" | "test";

export type EvalRequest = {
  nightId: string;
  evalId: string;
  /** Experiment whose commit is evaluated (`refs/exp/<expId>`). */
  expId: string;
  split: EvalSplit;
  /** Train folds for opt / val; ignored for test. */
  folds: number[];
  runId?: string;
  /** Position in the evaluator's run order. */
  order?: number;
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
  /** The evaluator incarnation that ran it: only evals on the same instance are compared on latency. */
  evaluator_instance: string;
  eval_order: number;
}

type Item = Record<string, unknown> & { id: string; gold: unknown; fold?: number };

function readJsonl(path: string): Item[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Item);
}

export function loadSplit(cfg: NightConfig, split: EvalSplit, folds: number[]): Item[] {
  if (split === "test") return readJsonl(join(cfg.dataset_dir, "test.jsonl"));
  return readJsonl(join(cfg.dataset_dir, "train.jsonl")).filter((it) => folds.includes(Number(it.fold)));
}

export function trainFolds(cfg: NightConfig): number[] {
  return [...new Set(readJsonl(join(cfg.dataset_dir, "train.jsonl")).map((it) => Number(it.fold)))].sort((a, b) => a - b);
}

/** The question only: gold, fold and any `hidden_fields` removed. */
function toQuery(cfg: NightConfig, item: Item): Record<string, unknown> {
  const hidden = new Set(["gold", "fold", ...cfg.hidden_fields]);
  return Object.fromEntries(Object.entries(item).filter(([k]) => !hidden.has(k)));
}

const secs = (t0: number) => Math.round((performance.now() - t0) / 10) / 100;

export function numericMetrics(raw: Record<string, unknown>): Metrics {
  return Object.fromEntries(
    Object.entries(raw).filter(([, v]) => typeof v === "number" && Number.isFinite(v)),
  ) as Metrics;
}

/** Per-item primary scores written by `score_cmd`, in item order. */
export function readPerItem(metricsPath: string): number[] {
  const raw = JSON.parse(readFileSync(metricsPath, "utf8")) as { per_item?: Record<string, number> };
  return Object.values(raw.per_item ?? {});
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
  const needMs = cfg.timeouts.eval_min * 60_000 + EVAL_OVERHEAD_MS;
  if (live && !(backend.maxActiveMs && ((await live.ageMs?.()) ?? 0) + needMs > backend.maxActiveMs)) return live;
  return backend.create({
    name, baseline: cfg.baseline, specDir: cfg.spec_dir, network: isMetered(cfg) ? METER_NETWORK : "none",
    labels: { "cc.night": nightId, ...(runId ? { "cc.run": runId } : {}) },
  });
}

export async function closeEvaluator(cfg: NightConfig, evaluatorId: string): Promise<void> {
  await (await sandboxBackend(cfg.sandbox).find(sandboxName(evaluatorId)))?.destroy();
}

// Kills every process but PID 1, the Inngest guest agent (`init` processes) and this
// script's own chain (its parent and its children), waits until they are gone, then
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
    read -r comm < "$p/comm" 2>/dev/null && [ "$comm" = init ] && continue
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
async function resetFor(cfg: NightConfig, sandbox: Sandbox, commit: { bundle: Buffer; ref: string }): Promise<void> {
  // cwd "/": /repo does not exist before the first clone or after the wipe.
  const r = await sandbox.exec(RESET_SCRIPT, { cwd: "/", timeoutMs: 120_000 });
  if (r.exitCode !== 0) throw new Error(`evaluator reset failed (${r.exitCode}): ${r.stderr.trim()}`);
  await cloneInto(sandbox, commit);
  for (const f of cfg.run_files) await sandbox.writeFile(`/eval/${basename(f)}`, readFileSync(f));
}

/** Evaluate one candidate in the open evaluator. Throws on infra failures (retried); program failures return ok: false. */
export async function evalCandidate(cfg: NightConfig, sandbox: Sandbox, req: EvalRequest): Promise<EvalResult> {
  const paths = nightPaths(cfg, req.nightId);
  const dir = paths.evalDir(req.evalId);
  mkdirSync(dir, { recursive: true });
  const items = loadSplit(cfg, req.split, req.folds);
  writeFileSync(join(dir, "items.jsonl"), items.map((it) => JSON.stringify(it)).join("\n") + "\n");
  const queries = items.map((it) => JSON.stringify(toQuery(cfg, it))).join("\n") + "\n";

  const started = performance.now();
  const result: EvalResult = {
    ok: false, metrics: { [cfg.primary_metric]: 0 }, metricsPath: null, program_usd: 0,
    t_provision: 0, t_eval: 0, t_teardown: 0, wall_s: 0, infra_errors: 0,
    evaluator_instance: await sandbox.instanceId(), eval_order: req.order ?? 0,
  };
  const repo = new ExperimentRepo(paths.gitDir);

  let t0 = performance.now();
  let runStartMs = 0;
  await resetFor(cfg, sandbox, await repo.bundle(req.expId));
  result.t_provision = secs(t0);
  // The program's model calls: a token for this eval only, revoked when the run ends.
  const proxy = isMetered(cfg) ? await meter() : null;
  const token = proxy?.open({
    evalId: req.evalId, allowedModels: cfg.allowed_models, capUsd: cfg.budget_usd.eval,
    attrs: { "codeclimb.eval_id": req.evalId, "codeclimb.exp_id": req.expId },
  });
  let calls: MeterCall[] = [];
  try {
    await sandbox.writeFile("/work/queries.jsonl", queries);
    runStartMs = Date.now();
    t0 = performance.now();
    const run = await sandbox.exec(
      `${cfg.run_cmd} --queries /work/queries.jsonl --repo /repo --out /work/out > /work/run.log 2>&1`,
      { cwd: "/work", timeoutMs: cfg.timeouts.eval_min * 60_000, ...(token ? { env: meterEnv(token, await meterBaseUrl(cfg)) } : {}) },
    );
    calls = token ? proxy!.close(token) : [];
    result.t_eval = secs(t0);
    if (run.timedOut || run.exitCode !== 0) {
      const log = (await sandbox.readFile("/work/run.log").catch(() => Buffer.from(""))).toString().slice(-2000);
      writeFileSync(join(dir, "run.log"), log);
      result.error = run.timedOut ? `run_cmd timed out after ${cfg.timeouts.eval_min} min` : `run_cmd exited ${run.exitCode}: ${log}`;
      return result;
    }
    const tar = await sandbox.exec("tar -C /work/out -cf /tmp/cc-out.tar .", { cwd: "/" });
    if (tar.exitCode !== 0) throw new Error(`cannot pack outputs: ${tar.stderr}`);
    writeFileSync(join(dir, "outputs.tar"), await sandbox.readFile("/tmp/cc-out.tar"));
  } finally {
    if (token) calls.push(...proxy!.close(token)); // no-op after the close above; revokes it if exec threw
    // Spent even when the run fails.
    result.program_usd = calls.reduce((a, c) => a + c.cost_usd, 0);
    if (calls.length) writeFileSync(join(dir, "meter.jsonl"), calls.map((c) => JSON.stringify(c)).join("\n") + "\n");
    result.wall_s = secs(started);
  }

  // Score on the worker host, outside every sandbox.
  const outputs = join(dir, "outputs");
  mkdirSync(outputs, { recursive: true });
  await pexec("tar", ["-xf", join(dir, "outputs.tar"), "-C", outputs]);
  // Latency: only the program's operations, as the runner timed them.
  let ops: OpLatency[] = [];
  const timingsPath = join(outputs, TIMINGS_FILE);
  if (existsSync(timingsPath)) {
    try {
      ops = opLatencies(parseTimings(readFileSync(timingsPath, "utf8")));
    } catch (e) {
      result.error = `run_cmd wrote a bad ${TIMINGS_FILE}: ${(e as Error).message}`;
      return result;
    }
    programSpans({ "codeclimb.eval_id": req.evalId, "codeclimb.exp_id": req.expId }, runStartMs, ops);
  }
  const metricsPath = join(dir, "metrics.json");
  t0 = performance.now();
  try {
    await pexec(
      "bash",
      ["-c", `${cfg.score_cmd} --items "$1" --outputs "$2" --out "$3"`, "score", join(dir, "items.jsonl"), outputs, metricsPath],
      { cwd: cfg.base_dir, maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (e) {
    result.error = `score_cmd failed: ${(e as Error).message.slice(0, 2000)}`;
    return result;
  }
  result.t_eval += secs(t0);
  const raw = JSON.parse(readFileSync(metricsPath, "utf8")) as Record<string, unknown>;
  // Standard metrics win over a scorer's metric of the same name; program $ is the proxy's ledger.
  result.metrics = { ...numericMetrics(raw), ...(ops.length ? latencyMetrics(ops) : {}), ...costMetrics(calls, items.length) };
  result.metricsPath = metricsPath;
  result.ok = typeof result.metrics[cfg.primary_metric] === "number";
  if (!result.ok) result.error = `metrics.json has no primary metric "${cfg.primary_metric}"`;
  result.wall_s = secs(started);
  return result;
}
