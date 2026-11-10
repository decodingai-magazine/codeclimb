// lessons: a scenario's lessons.md across nights (codeclimb/lessons.ts).
//   npm run lessons -- distill --config configs/graphrag.yaml --night ID [--apply]   propose from one night (a paid model call)
//   npm run lessons -- apply --config configs/graphrag.yaml --night ID              the night's newest proposal into the scenario
//   npm run lessons -- format --config configs/graphrag.yaml [--check]              lessons.md in its one layout, after a hand edit
import "../codeclimb/env";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../codeclimb/config";
import { applyProposal, lessonsFile, parseLessons, proposalsOf, proposeLessons, serializeLessons, writeProposal } from "../codeclimb/lessons";
import { scanText } from "../codeclimb/orchestrator";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { config: { type: "string" }, night: { type: "string" }, apply: { type: "boolean", default: false }, check: { type: "boolean", default: false } },
});
const command = positionals[0];
if (!values.config) throw new Error("usage: lessons distill|apply|format --config <yaml> [--night ID]");
const cfg = loadConfig(resolve(values.config));
const file = lessonsFile(cfg);

if (command === "format") {
  const text = readFileSync(file, "utf8");
  const formatted = serializeLessons(parseLessons(text));
  if (values.check) {
    console.log(formatted === text ? `${file} is in layout` : `${file} is out of layout: run format without --check`);
    process.exit(formatted === text ? 0 : 1);
  }
  writeFileSync(file, formatted);
  console.log(`wrote ${file}`);
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
    const newest = proposalsOf(cfg, nightId).at(-1);
    if (!newest) throw new Error(`no proposal for ${nightId}`);
    applyProposal(cfg, newest.dir);
    console.log(`applied ${newest.dir} to ${file}`);
  }
} else throw new Error(`unknown command ${command}: distill | apply | format`);
