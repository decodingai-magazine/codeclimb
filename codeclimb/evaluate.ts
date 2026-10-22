// Eval: a fresh sandbox at the commit runs `run_cmd` on one split's questions
// (no gold); `score_cmd` then scores the outputs against gold on the worker
// host. Gold never enters a sandbox; the agent never sees runner or outputs.
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { NightConfig } from "./config";
import { ExperimentRepo } from "./git";
import { nightPaths, sandboxName } from "./paths";
import { sandboxBackend } from "./sandbox";
import type { Metrics } from "./stats";

const pexec = promisify(execFile);

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

export async function runEval(cfg: NightConfig, req: EvalRequest): Promise<EvalResult> {
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
  };
  const repo = new ExperimentRepo(paths.gitDir);
  const backend = sandboxBackend(cfg.sandbox);

  let t0 = performance.now();
  const sandbox = await backend.create({
    name: sandboxName(req.evalId),
    baseline: cfg.baseline,
    commit: await repo.bundle(req.expId),
    labels: { "cc.night": req.nightId, ...(req.runId ? { "cc.run": req.runId } : {}) },
  });
  result.t_provision = secs(t0);
  try {
    for (const f of cfg.run_files) await sandbox.writeFile(`/eval/${basename(f)}`, readFileSync(f));
    await sandbox.writeFile("/work/queries.jsonl", queries);
    t0 = performance.now();
    const run = await sandbox.exec(
      `${cfg.run_cmd} --queries /work/queries.jsonl --repo /repo --out /work/out > /work/run.log 2>&1`,
      { cwd: "/work", timeoutMs: cfg.timeouts.eval_min * 60_000 },
    );
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
    t0 = performance.now();
    await sandbox.destroy();
    result.t_teardown = secs(t0);
    result.wall_s = secs(started);
  }

  // Score on the worker host, outside every sandbox.
  const outputs = join(dir, "outputs");
  mkdirSync(outputs, { recursive: true });
  await pexec("tar", ["-xf", join(dir, "outputs.tar"), "-C", outputs]);
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
  // No metering proxy in this iteration: the built program makes no model calls, so program $ is 0.
  result.program_usd = typeof raw.program_usd === "number" ? raw.program_usd : 0;
  result.metrics = numericMetrics(raw);
  result.metricsPath = metricsPath;
  result.ok = typeof result.metrics[cfg.primary_metric] === "number";
  if (!result.ok) result.error = `metrics.json has no primary metric "${cfg.primary_metric}"`;
  result.wall_s = secs(started);
  return result;
}
