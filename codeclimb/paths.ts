import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { NightConfig } from "./config";

/** This stack's runs folder, under the checkout. A config's `results_path` is relative to it. */
export const RUNS_DIR = "runs-inngest";

/** The runs folder of a checkout (CODECLIMB_ROOT, else cwd). */
export const runsRoot = (root = process.env.CODECLIMB_ROOT ?? process.cwd()): string => join(root, RUNS_DIR);

/**
 * Every night folder under the runs folder, at any depth: `<runs>/<results dir>/nights/<id>/night.json`.
 * `scenario` is the results dir relative to the runs folder (`datenorm`, `mock/capitals-smoke`).
 */
export function nightDirs(runs = runsRoot()): { scenario: string; id: string; dir: string }[] {
  if (!existsSync(runs)) return [];
  const found: { scenario: string; id: string; dir: string }[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === "experiments.git" || e.name === "lessons") continue;
      const sub = join(dir, e.name);
      if (e.name !== "nights") {
        walk(sub);
        continue;
      }
      for (const id of readdirSync(sub)) {
        if (existsSync(join(sub, id, "night.json"))) found.push({ scenario: relative(runs, dir), id, dir: join(sub, id) });
      }
    }
  };
  walk(runs);
  return found;
}

/** Where one night keeps its files. The experiment repo is shared across nights. */
export function nightPaths(cfg: NightConfig, nightId: string) {
  const root = dirname(cfg.results_path);
  const nightDir = join(root, "nights", nightId);
  return {
    root,
    gitDir: join(root, "experiments.git"),
    nightDir,
    nightJson: join(nightDir, "night.json"),
    doneJson: join(nightDir, "done.json"),
    /** The coder's bundle (the scenario's `bundle` command), /spec in every coder sandbox. */
    bundleDir: join(nightDir, "bundle"),
    /** Written by `markStopped` when a night is stopped, fails or times out (it never gets a done.json). */
    stopJson: join(nightDir, "stop.json"),
    /** Written while the night waits for credits: where it stopped, and how to go on. */
    pauseJson: join(nightDir, "pause.json"),
    /** Every pause so far, one per line. */
    pausesLog: join(nightDir, "pauses.jsonl"),
    /** The evaluation's measured noise: the keep margin on the weighted score. */
    noiseJson: join(nightDir, "noise.json"),
    expDir: (expId: string) => join(nightDir, "exps", expId),
    evalDir: (evalId: string) => join(nightDir, "evals", evalId),
    /** The reviewer's feedback and next-round hypotheses, kept for the report. */
    reviewJson: (round: number) => join(nightDir, "reviews", `r${round}.json`),
    /** What the reviewer read that round. */
    reviewPrompt: (round: number) => join(nightDir, "reviews", `r${round}.prompt.md`),
  };
}

/** A new night's id, from the time: `n<date>-<time>`. */
export function newNightId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `n${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Sandbox names start with the night id (exp and eval ids do), so a sweep finds leftovers by prefix. */
export const sandboxName = (id: string) => `cc-${id}`;
export const sandboxPrefix = (nightId: string) => sandboxName(nightId);
