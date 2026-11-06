// run-night --config <yaml>: start a night on the Inngest dev server and follow it.
//   npm run run-night -- --config configs/datenorm-smoke.yaml [--night-id ID] [--no-wait] [--mock]     (always on Docker)
//   npm run run-night:cloud -- --config configs/graphrag.yaml [--sandbox docker|inngest]
//   npm run run-night -- stop --night ID
//   npm run run-night -- resume --night ID     (after a pause for credits)
import "../codeclimb/env";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { checkSandboxLimits, loadConfig, mockConfig, relativeConfig, type NightConfig } from "../codeclimb/config";
import { nightPaths } from "../codeclimb/paths";
import { checkNightModels } from "../codeclimb/meter/backends";
import { readRows, rowSpend } from "../codeclimb/results";
import { ccInngest, nightStartEvent } from "../inngest/codeclimb/client";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string" },
    "night-id": { type: "string" },
    night: { type: "string" },
    sandbox: { type: "string" },
    "no-wait": { type: "boolean", default: false },
    mock: { type: "boolean", default: false },
  },
});

function newNightId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `n${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function follow(cfg: NightConfig, nightId: string): Promise<void> {
  const { doneJson, stopJson, pauseJson } = nightPaths(cfg, nightId);
  let printed = 0;
  let paused = false;
  console.log(`[run-night] following ${nightId} (Ctrl-C detaches; the night keeps running)`);
  for (;;) {
    const rows = readRows(cfg.results_path).filter((r) => r.night_id === nightId);
    for (const r of rows.slice(printed)) {
      const primary = r.metrics[cfg.primary_metric];
      console.log(
        `  r${r.round} ${r.kind.padEnd(10)} ${r.split.padEnd(5)} ${r.exp_id.replace(`${nightId}-`, "").padEnd(14)} ` +
          `${cfg.primary_metric}=${primary?.toFixed(4) ?? "-"} ${r.decision.padEnd(6)} ` +
          `$${rowSpend(r).toFixed(4)} ${r.hypothesis ? `· ${r.hypothesis.slice(0, 90)}` : ""}`,
      );
    }
    printed = rows.length;
    if (existsSync(doneJson)) {
      console.log(`[run-night] done:\n${readFileSync(doneJson, "utf8")}`);
      return;
    }
    if (existsSync(stopJson)) {
      console.log(`[run-night] stopped: ${readFileSync(stopJson, "utf8")}`);
      return;
    }
    const pausing = existsSync(pauseJson);
    if (pausing && !paused) {
      const { stops } = JSON.parse(readFileSync(pauseJson, "utf8")) as { stops: { where: string; who: string; model: string; message: string }[] };
      for (const s of stops) console.log(`[run-night] paused, out of credits: ${s.where}, ${s.who} on ${s.model}: ${s.message}`);
      console.log(`[run-night] add credits, then: npm run run-night${process.env.CODECLIMB_ENV === "cloud" ? ":cloud" : ""} -- resume --night ${nightId}`);
    }
    if (paused && !pausing) console.log("[run-night] resumed");
    paused = pausing;
    await new Promise((r) => setTimeout(r, 5000));
  }
}

if (positionals[0] === "resume") {
  if (!values.night) throw new Error("resume needs --night <id>");
  await ccInngest.send({ name: "codeclimb/night.resume", data: { night_id: values.night } });
  console.log(`[run-night] sent codeclimb/night.resume for ${values.night}`);
  process.exit(0);
}

if (positionals[0] === "stop") {
  if (!values.night) throw new Error("stop needs --night <id>");
  await ccInngest.send({ name: "codeclimb/night.stop", data: { night_id: values.night, reason: "manual" } });
  console.log(`[run-night] sent codeclimb/night.stop for ${values.night}`);
} else {
  if (!values.config) throw new Error("usage: run-night --config <yaml>");
  const loaded = loadConfig(resolve(values.config));
  const cfg = values.mock ? mockConfig(loaded) : loaded;
  if (values.sandbox && values.sandbox !== "docker" && values.sandbox !== "inngest") throw new Error("--sandbox must be docker | inngest");
  const wanted = (values.sandbox ?? cfg.sandbox) as NightConfig["sandbox"];
  // A local night runs on Docker: Inngest sandboxes need Inngest Cloud.
  cfg.sandbox = process.env.INNGEST_DEV ? "docker" : wanted;
  if (cfg.sandbox !== wanted) console.log("[run-night] local night: Docker sandboxes instead of inngest");
  checkSandboxLimits(cfg);
  await checkNightModels(cfg);
  if (cfg.mock) console.log("[run-night] mock: scripted models, metrics mean nothing");
  const nightId = values["night-id"] ?? newNightId();
  const { ids } = await ccInngest.send(nightStartEvent(nightId, relativeConfig(cfg)));
  console.log(`[run-night] started night ${nightId} (event ${ids[0]}); results → ${cfg.results_path}`);
  if (!values["no-wait"]) await follow(cfg, nightId);
}
