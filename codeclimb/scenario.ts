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
  /** Host: `score` with per-item errors under the report's `details`, for the reviewer. Used on dev, never on test. */
  details?: string;
}

export interface Scenario {
  name: string;
  /** Sandbox image (Docker) / baseline for coders and evaluators. */
  image: string;
  /** Host: writes the coder's bundle into `{out}`; it becomes /spec, `spec/` holding the agent's spec. */
  bundle: string;
  stages: Stage[];
  /**
   * Headline metric → the drop from the parent that fails a branch: a number, or `ci95` for the half-width
   * of the parent's interval (`<metric>` ending `.mean`, with `.ci95_half` beside it). Empty: no such guardrail.
   */
  headline: Record<string, number | "ci95">;
  /** `shared`: a round's candidates run in turn in one evaluator, so latency compares. `per_candidate`: one sandbox each, in parallel. */
  eval_sandboxes: "shared" | "per_candidate";
  /** What the reviewer reads as its protocol: files of the scenario, `path#Heading` for one `##` section. */
  protocol: string[];
  /** Host path (relative to the scenario dir) of the pip requirements the image holds, for backends without images. */
  requirements?: string;
  /** Host: checks a branch's files in `{repo}` before it is evaluated and writes `RepoCheck` as JSON to `{report}`. */
  check?: string;
}

/** A `check` command's report. */
export interface RepoCheck {
  /** Why the branch can't be evaluated. */
  errors: string[];
  /** What the reviewer should know; the branch still runs. */
  notes: string[];
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
    return {
      name, inputs: str(s, "inputs", at), files: files as Record<string, string>, run: str(s, "run", at), score: str(s, "score", at),
      ...(s.details === undefined ? {} : { details: str(s, "details", at) }),
    };
  });
  if (new Set(stages.map((s) => s.name)).size !== stages.length) throw new Error(`${where}: stage names must be unique`);
  const headline = (raw.headline ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(headline)) {
    if (v !== "ci95" && !(typeof v === "number" && v >= 0)) throw new Error(`${where}: headline.${k} must be a margin >= 0 or "ci95"`);
    if (v === "ci95" && !k.endsWith(".mean")) throw new Error(`${where}: headline.${k}: "ci95" needs a metric ending .mean`);
  }
  const evalSandboxes = raw.eval_sandboxes ?? "shared";
  if (evalSandboxes !== "shared" && evalSandboxes !== "per_candidate") throw new Error(`${where}: eval_sandboxes must be shared or per_candidate`);
  const protocol = (raw.protocol ?? []) as unknown[];
  if (!Array.isArray(protocol) || !protocol.every((p) => typeof p === "string")) throw new Error(`${where}: protocol must list files`);
  return {
    name: str(raw, "name", where), image: str(raw, "image", where), bundle: str(raw, "bundle", where), stages,
    headline: headline as Scenario["headline"], eval_sandboxes: evalSandboxes, protocol: protocol as string[],
    ...(raw.check === undefined ? {} : { check: str(raw, "check", where) }),
    ...(raw.requirements === undefined ? {} : { requirements: str(raw, "requirements", where) }),
  };
}

/** The scenario's `protocol` files as one text; a `path#Heading` entry is that `## Heading` section of the file. */
export function readProtocol(dir: string, protocol: string[]): string {
  return protocol
    .map((entry) => {
      const [path, heading] = entry.split("#");
      const text = readFileSync(join(dir, path), "utf8");
      if (!heading) return text;
      const body = text.split(/^(?=## )/m).find((section) => section.startsWith(`## ${heading}\n`));
      if (!body) throw new Error(`${dir}: ${path} has no "## ${heading}" section`);
      return body;
    })
    .join("\n\n");
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
 * (per-item detail stays in the report file), and a `ci95: [lo, hi]` kept as its half-width, `ci95_half`.
 * With more than one stage each key gets `<stage>.` in front.
 */
export function flattenReport(report: unknown, prefix = ""): Record<string, number> {
  const out: Record<string, number> = {};
  if (report === null || typeof report !== "object" || Array.isArray(report)) return out;
  for (const [k, v] of Object.entries(report)) {
    if (k === "per_item" || k === "details") continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    else if (k === "ci95" && Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number") out[`${key}_half`] = (v[1] - v[0]) / 2;
    else if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flattenReport(v, key));
  }
  return out;
}
