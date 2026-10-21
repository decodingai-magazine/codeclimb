import { dirname, join } from "node:path";
import type { NightConfig } from "./config";

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
    expDir: (expId: string) => join(nightDir, "exps", expId),
    evalDir: (evalId: string) => join(nightDir, "evals", evalId),
  };
}

/** Sandbox names start with the night id (exp and eval ids do), so a sweep finds leftovers by prefix. */
export const sandboxName = (id: string) => `cc-${id}`;
export const sandboxPrefix = (nightId: string) => sandboxName(nightId);
