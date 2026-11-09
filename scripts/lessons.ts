// lessons: a scenario's lessons ledger across nights (codeclimb/lessons.ts).
//   npm run lessons -- distill --config configs/graphrag-lite.yaml --night ID [--apply]   propose from one night (a paid model call)
//   npm run lessons -- apply --config configs/graphrag-lite.yaml --night ID              the night's newest proposal into the scenario
//   npm run lessons -- render --config configs/graphrag-lite.yaml [--check]              lessons.md from the ledger
import "../codeclimb/env";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../codeclimb/config";
import { applyProposal, lessonPaths, proposeLessons, readLedger, renderLessons, writeProposal } from "../codeclimb/lessons";
import { scanText } from "../codeclimb/orchestrator";
import { nightPaths } from "../codeclimb/paths";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { config: { type: "string" }, night: { type: "string" }, apply: { type: "boolean", default: false }, check: { type: "boolean", default: false } },
});
const command = positionals[0];
if (!values.config) throw new Error("usage: lessons distill|apply|render --config <yaml> [--night ID]");
const cfg = loadConfig(resolve(values.config));
const paths = lessonPaths(cfg);

if (command === "render") {
  const text = renderLessons(readLedger(cfg));
  if (values.check) {
    const same = existsSync(paths.file) && readFileSync(paths.file, "utf8") === text;
    console.log(same ? `${paths.file} matches the ledger` : `${paths.file} differs from the ledger: run render without --check`);
    process.exit(same ? 0 : 1);
  }
  writeFileSync(paths.file, text);
  console.log(`wrote ${paths.file}`);
} else if (command === "distill" || command === "apply") {
  if (!values.night) throw new Error(`${command} needs --night <id>`);
  const nightId = values.night;
  if (command === "distill") {
    const proposal = await proposeLessons(cfg, nightId, (text) => scanText(cfg, text));
    if (!proposal) {
      console.log(`nothing new to distill from ${nightId}`);
      process.exit(0);
    }
    const { dir, applied } = writeProposal(cfg, proposal, values.apply);
    console.log(`${proposal.ops.length} ops, ${proposal.rejected.length} rejected, $${proposal.usd.toFixed(4)}; ${applied ? "applied" : "proposed"}: ${dir}`);
  } else {
    const root = join(nightPaths(cfg, nightId).root, "lessons");
    const dirs = existsSync(root) ? readdirSync(root).filter((d) => d.startsWith(`${nightId}-r`)).sort((a, b) => a.localeCompare(b, "en", { numeric: true })) : [];
    if (!dirs.length) throw new Error(`no proposal for ${nightId} under ${root}`);
    const dir = join(root, dirs.at(-1)!);
    applyProposal(cfg, dir);
    console.log(`applied ${dir} to ${paths.ledger} and ${paths.file}`);
  }
} else throw new Error(`unknown command ${command}: distill | apply | render`);
