// run-night --config <yaml>: start a night on the Inngest dev server and follow it.
//   npm run run-night -- --config configs/datenorm-smoke.yaml [--night-id ID] [--no-wait]
//   npm run run-night -- stop --night ID
import "../codeclimb/env";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig, type NightConfig } from "../codeclimb/config";
import { nightPaths } from "../codeclimb/paths";
import { checkModels } from "../codeclimb/pi/session";
import { readRows } from "../codeclimb/results";
import { ccInngest } from "../inngest/codeclimb/client";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string" },
    "night-id": { type: "string" },
    night: { type: "string" },
    "no-wait": { type: "boolean", default: false },
  },
});

function newNightId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `n${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function follow(cfg: NightConfig, nightId: string): Promise<void> {
  const { doneJson } = nightPaths(cfg, nightId);
  let printed = 0;
  console.log(`[run-night] following ${nightId} (Ctrl-C detaches; the night keeps running)`);
  for (;;) {
    const rows = readRows(cfg.results_path).filter((r) => r.night_id === nightId);
    for (const r of rows.slice(printed)) {
      const primary = r.metrics[cfg.primary_metric];
      console.log(
        `  r${r.round} ${r.kind.padEnd(10)} ${r.split.padEnd(5)} ${r.exp_id.replace(`${nightId}-`, "").padEnd(14)} ` +
          `${cfg.primary_metric}=${primary?.toFixed(4) ?? "-"} ${r.decision.padEnd(6)} ` +
          `$${(r.coder_usd + r.program_usd).toFixed(4)} ${r.hypothesis ? `· ${r.hypothesis.slice(0, 90)}` : ""}`,
      );
    }
    printed = rows.length;
    if (existsSync(doneJson)) {
      console.log(`[run-night] done:\n${readFileSync(doneJson, "utf8")}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

if (positionals[0] === "stop") {
  if (!values.night) throw new Error("stop needs --night <id>");
  await ccInngest.send({ name: "codeclimb/night.stop", data: { night_id: values.night, reason: "manual" } });
  console.log(`[run-night] sent codeclimb/night.stop for ${values.night}`);
} else {
  if (!values.config) throw new Error("usage: run-night --config <yaml>");
  const cfg = loadConfig(resolve(values.config));
  await checkModels([...cfg.models, cfg.reviewer_model]);
  const nightId = values["night-id"] ?? newNightId();
  const { ids } = await ccInngest.send({ name: "codeclimb/night.start", data: { night_id: nightId, config: cfg } });
  console.log(`[run-night] started night ${nightId} (event ${ids[0]}); results → ${cfg.results_path}`);
  if (!values["no-wait"]) await follow(cfg, nightId);
}
