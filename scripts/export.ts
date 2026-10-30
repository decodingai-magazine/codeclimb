// Export one experiment's code from a night's experiments.git.
//   npm run export -- --config configs/datenorm-hard.yaml --exp best --to-dir ../datenorm-solution
//   npm run export -- --results runs/datenorm-hard/results.jsonl --exp hard2-r6-b2 --to-dir out --with-history
//   npm run export -- --config configs/datenorm-hard.yaml --exp best --to-remote git@github.com:you/repo.git [--branch main]
// `--exp best` is the kept commit of the most recently finished night.
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../codeclimb/config";
import { exportExperiment, resolveExpId } from "../codeclimb/export";

const { values } = parseArgs({
  options: {
    config: { type: "string" },
    results: { type: "string" },
    exp: { type: "string", default: "best" },
    "to-dir": { type: "string" },
    "to-remote": { type: "string" },
    branch: { type: "string" },
    "with-history": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
  },
});

const resultsPath = values.results ? resolve(values.results) : values.config ? loadConfig(resolve(values.config)).results_path : null;
if (!resultsPath || (!values["to-dir"] === !values["to-remote"])) {
  throw new Error("usage: export (--config <yaml> | --results <jsonl>) [--exp <id>|best] (--to-dir <path> [--with-history] [--force] | --to-remote <url> [--branch <name>])");
}
const root = dirname(resultsPath);
try {
  const expId = resolveExpId(root, values.exp!);
  const result = await exportExperiment(
    join(root, "experiments.git"),
    expId,
    values["to-dir"]
      ? { kind: "dir", path: values["to-dir"], withHistory: values["with-history"], force: values.force }
      : { kind: "remote", url: values["to-remote"]!, branch: values.branch },
  );
  console.log(`[export] ${result.expId} (${result.sha.slice(0, 7)}) → ${result.destination}${result.branch ? ` · branch ${result.branch}` : ""}\n${result.log}`);
} catch (e) {
  console.error(`[export] ${(e as Error).message}`);
  process.exit(1);
}
