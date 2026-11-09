// Render the report as one self-contained HTML file: the Decoding AI tokens and
// page styles (client.css), the hand-rolled SVG charts and export panel
// (client.js), the two small mono logo lockups and the data, all inlined, so
// it opens offline from disk. Only Open Sans comes from Google Fonts, with the
// system sans as fallback.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NightConfig } from "../config";
import { nightPaths } from "../paths";
import { buildReportData, type ReportData } from "./data";

const HERE = dirname(fileURLToPath(import.meta.url));
const asset = (name: string) => readFileSync(join(HERE, name));
const dataUri = (name: string) => `data:image/png;base64,${asset(join("assets", name)).toString("base64")}`;

/** For `<script>` bodies: no `</script`, `<!--` or U+2028 can end or corrupt the element. */
function scriptSafe(text: string): string {
  return text.replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export type RenderOptions = {
  /** Set when served by `npm run report -- --serve`: the page posts exports to /api/export with this token. */
  serverToken?: string;
  /** Shown in the CLI fallback command when the page is opened from disk. */
  configPath?: string;
};

export function renderReport(data: ReportData, opts: RenderOptions = {}): string {
  const boot = {
    data,
    server: opts.serverToken ? { token: opts.serverToken } : null,
    configPath: opts.configPath ?? null,
    logos: { onLight: dataUri("logo-horizontal-dark.png"), onDark: dataUri("logo-horizontal-light.png") },
  };
  const js = readFileSync(join(HERE, "client.js"), "utf8");
  if (/<\/script/i.test(js)) throw new Error("client.js must not contain a closing script tag");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CodeClimb Report · ${esc(data.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
${readFileSync(join(HERE, "client.css"), "utf8")}
</style>
</head>
<body>
<div id="app"></div>
<script id="cc-boot" type="application/json">${scriptSafe(JSON.stringify(boot))}</script>
<script>
${js}
</script>
</body>
</html>
`;
}

/** Rebuild `<results dir>/report.html` for every night in the results file. Never throws: a report must not fail a night. */
export async function writeReport(cfg: Pick<NightConfig, "results_path">, opts: { configPath?: string } = {}): Promise<string | null> {
  try {
    const data = await buildReportData(cfg.results_path);
    const out = nightPaths(cfg as NightConfig, "").report;
    mkdirSync(dirname(out), { recursive: true });
    const tmp = `${out}.tmp`;
    writeFileSync(tmp, renderReport(data, { configPath: opts.configPath }));
    renameSync(tmp, out); // atomic swap: a browser reloading mid-write never sees half a page
    return out;
  } catch (e) {
    console.warn(`[report] could not write the report: ${(e as Error).message}`);
    return null;
  }
}
