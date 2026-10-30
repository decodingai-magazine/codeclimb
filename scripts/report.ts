// Interactive HTML report over every night in a results file, with an export panel.
//   npm run report -- --config configs/datenorm-hard.yaml          # writes runs/<...>/report.html
//   npm run report -- --results runs/datenorm-hard/results.jsonl --out /tmp/r.html
//   npm run report -- --config configs/datenorm-hard.yaml --serve  # http://127.0.0.1:7420, Export button live
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../codeclimb/config";
import { exportExperiment, type ExportTarget } from "../codeclimb/export";
import { buildReportData } from "../codeclimb/report/data";
import { renderReport } from "../codeclimb/report/html";

const { values } = parseArgs({
  options: {
    config: { type: "string" },
    results: { type: "string" },
    out: { type: "string" },
    serve: { type: "boolean", default: false },
    port: { type: "string", default: "7420" },
  },
});

const resultsPath = values.results ? resolve(values.results) : values.config ? loadConfig(resolve(values.config)).results_path : null;
if (!resultsPath) throw new Error("usage: report --config <yaml> | --results <results.jsonl> [--out file] [--serve] [--port N]");
const gitDir = join(dirname(resultsPath), "experiments.git");
const configPath = values.config ? resolve(values.config) : undefined;

if (!values.serve) {
  const out = resolve(values.out ?? join(dirname(resultsPath), "report.html"));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, renderReport(await buildReportData(resultsPath), { configPath }));
  console.log(`[report] wrote ${out}`);
} else {
  const port = Number(values.port);
  const token = randomBytes(24).toString("hex");
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const tokenOk = (t: string | undefined) =>
    !!t && t.length === token.length && timingSafeEqual(Buffer.from(t), Buffer.from(token));

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((ok, fail) => {
      let body = "";
      req.on("data", (c) => {
        body += c;
        if (body.length > 64 * 1024) {
          fail(new Error("request body too large"));
          req.destroy();
        }
      });
      req.on("end", () => ok(body));
      req.on("error", fail);
    });

  const server = createServer(async (req, res) => {
    const send = (code: number, type: string, body: string) => {
      res.writeHead(code, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(body);
    };
    // DNS-rebinding guard: only answer requests addressed to this loopback port.
    if (!hosts.has(req.headers.host ?? "")) return send(421, "text/plain", "wrong host");
    try {
      if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
        // Rebuilt per request, so a reload shows rounds that finished since.
        const html = renderReport(await buildReportData(resultsPath), { serverToken: token, configPath });
        return send(200, "text/html; charset=utf-8", html);
      }
      if (req.method === "POST" && req.url === "/api/export") {
        // The token lives only in the served page; a JSON content type forces a CORS preflight that this server never answers.
        if (!tokenOk(req.headers["x-codeclimb-token"] as string | undefined)) return send(403, "application/json", JSON.stringify({ error: "bad token: reload the page" }));
        if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return send(415, "application/json", JSON.stringify({ error: "expected JSON" }));
        const b = JSON.parse(await readBody(req)) as {
          exp_id?: string; kind?: string; path?: string; url?: string; branch?: string; with_history?: boolean; force?: boolean;
        };
        const target: ExportTarget =
          b.kind === "remote"
            ? { kind: "remote", url: String(b.url ?? ""), branch: b.branch ? String(b.branch) : undefined }
            : { kind: "dir", path: String(b.path ?? ""), withHistory: b.with_history === true, force: b.force === true };
        const result = await exportExperiment(gitDir, String(b.exp_id ?? ""), target);
        console.log(`[report] exported ${result.expId} → ${result.destination}${result.branch ? ` (${result.branch})` : ""}`);
        return send(200, "application/json", JSON.stringify(result));
      }
      return send(404, "text/plain", "not found");
    } catch (e) {
      return send(400, "application/json", JSON.stringify({ error: (e as Error).message }));
    }
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`[report] serving ${resultsPath}\n[report] open http://127.0.0.1:${port}  (Ctrl-C to stop)`);
  });
}
