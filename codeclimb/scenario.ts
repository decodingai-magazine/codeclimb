// A scenario directory (docs/scenario-contract.md): `scenario.yaml` names the sandbox image, the command
// that writes the coder's bundle, and per stage the host commands that write its inputs and score its
// outputs, plus the sandbox command that runs the program. Codeclimb never reads the scenario's data
// itself: gold stays behind these commands, on the worker host.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";

const pexec = promisify(execFile);

export type Split = "train" | "dev" | "test";

export interface Stage {
  name: string;
  /** Host: writes the stage's input for `{split}` to `{inputs}`, with the answers removed. */
  inputs: string;
  /** Sandbox path → host path (relative to the scenario dir; a directory goes whole), uploaded before `run`. */
  files: Record<string, string>;
  /** Sandbox: runs the program on `{inputs}` and writes its outputs under `{out}`. */
  run: string;
  /** Host: scores `{out}` (the downloaded outputs) on `{split}` and writes the JSON report `{report}`. */
  score: string;
}

export interface Scenario {
  name: string;
  /** Sandbox image (Docker) / baseline for coders and evaluators. */
  image: string;
  /** Host: writes the coder's bundle into `{out}`; it becomes /spec, `spec/` holding the agent's spec. */
  bundle: string;
  stages: Stage[];
}

const STAGE_NAME = /^[a-z][a-z0-9_-]*$/;

function str(o: Record<string, unknown>, key: string, where: string): string {
  const v = o[key];
  if (typeof v !== "string" || !v.trim()) throw new Error(`${where}: "${key}" must be a non-empty string`);
  return v;
}

export function parseScenario(text: string, where = "scenario.yaml"): Scenario {
  const raw = (parse(text) ?? {}) as Record<string, unknown>;
  if (!Array.isArray(raw.stages) || !raw.stages.length) throw new Error(`${where}: "stages" must list at least one stage`);
  const stages = raw.stages.map((s: Record<string, unknown>, i: number): Stage => {
    const at = `${where}: stages[${i}]`;
    const name = str(s, "name", at);
    if (!STAGE_NAME.test(name)) throw new Error(`${at}: name "${name}" must match ${STAGE_NAME}`);
    const files = (s.files ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(files)) {
      if (!k.startsWith("/") || typeof v !== "string") throw new Error(`${at}: files maps an absolute sandbox path to a host path`);
    }
    return { name, inputs: str(s, "inputs", at), files: files as Record<string, string>, run: str(s, "run", at), score: str(s, "score", at) };
  });
  if (new Set(stages.map((s) => s.name)).size !== stages.length) throw new Error(`${where}: stage names must be unique`);
  return { name: str(raw, "name", where), image: str(raw, "image", where), bundle: str(raw, "bundle", where), stages };
}

export function loadScenario(dir: string): Scenario {
  const file = join(dir, "scenario.yaml");
  if (!existsSync(file)) throw new Error(`config: ${dir} has no scenario.yaml`);
  const s = parseScenario(readFileSync(file, "utf8"), file);
  if (!existsSync(join(dir, "starter"))) throw new Error(`${file}: the scenario needs a starter/ directory (the round-0 repo)`);
  return s;
}

/** `cmd` with `{name}` placeholders replaced by shell-quoted values. Unknown placeholders are an error. */
export function fill(cmd: string, values: Record<string, string>): string {
  return cmd.replace(/\{(\w+)\}/g, (_, k: string) => {
    if (!(k in values)) throw new Error(`command "${cmd}": unknown placeholder {${k}}`);
    return `'${values[k].replace(/'/g, `'\\''`)}'`;
  });
}

/** Runs a host command of the scenario in its directory. Throws with the tail of its output on failure. */
export async function hostCommand(dir: string, cmd: string, values: Record<string, string>, timeoutMs = 30 * 60_000): Promise<void> {
  try {
    await pexec("bash", ["-c", fill(cmd, values)], { cwd: dir, maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs });
  } catch (e) {
    const err = e as Error & { stderr?: string; stdout?: string };
    throw new Error(`${fill(cmd, values)} failed: ${(err.stderr || err.stdout || err.message).slice(-2000)}`);
  }
}

/**
 * A stage report's numeric values, flattened: nested keys joined by ".", lists and non-numbers skipped
 * (per-item detail stays in the report file). With more than one stage each key gets `<stage>.` in front.
 */
export function flattenReport(report: unknown, prefix = ""): Record<string, number> {
  const out: Record<string, number> = {};
  if (report === null || typeof report !== "object" || Array.isArray(report)) return out;
  for (const [k, v] of Object.entries(report)) {
    if (k === "per_item") continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    else if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flattenReport(v, key));
  }
  return out;
}
