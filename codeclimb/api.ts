// The worker's HTTP API, the app's only backend: scenarios to start from, the
// nights on this worker's disk (summaries, live branches, the report page),
// start, stop and export. It also mounts the metering proxy at /v1, so a hosted
// worker needs one public port. Every request but /v1 needs the bearer token
// (CODECLIMB_WORKER_TOKEN); without one the API only binds to loopback.
import { spawn } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename, join } from "node:path";
import { parse, stringify } from "yaml";
import { ccInngest } from "../inngest/codeclimb/client";
import { markStopped } from "./cleanup";
import { type NightConfig, parseConfig, relativeConfig } from "./config";
import { validateExpId } from "./export";
import { meter } from "./meter";
import { isEmbeddingModel } from "./meter/backends";
import { nightPaths } from "./paths";
import { checkModels } from "./pi/session";
import { buildReportData, nightSpend } from "./report/data";
import { renderReport } from "./report/html";
import { readRows } from "./results";
import { reachableBackends } from "./sandbox";

const root = () => process.env.CODECLIMB_ROOT ?? process.cwd();
const NIGHT_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,47}$/;
/** A night with no file written for this long and no done.json is reported as stale (crashed or lost). */
const STALE_MS = 60 * 60_000;

/** Settings the app may override on a scenario's config; everything else comes from the YAML. */
const OVERRIDABLE = [
  "sandbox", "models", "reviewer_model", "allowed_models", "max_rounds", "deadline", "timeouts", "budget_usd",
  "thresholds", "gates", "min_gain", "overfit_gap", "max_validations", "standard_metrics",
] as const;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

// ---------- scenarios ----------

function scenarioConfigs(): { name: string; text: string; cfg: NightConfig }[] {
  const dir = join(root(), "configs");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .flatMap((f) => {
      const text = readFileSync(join(dir, f), "utf8");
      try {
        return [{ name: basename(f, ".yaml"), text, cfg: parseConfig(text, root()) }];
      } catch {
        return []; // an invalid config is not offered
      }
    });
}

/** Item counts per split and fold, plus the fields a question carries. Never gold values. */
function datasetStats(cfg: NightConfig) {
  const count = (file: string) => {
    const path = join(cfg.dataset_dir, file);
    if (!existsSync(path)) return { items: 0, folds: {} as Record<string, number>, fields: [] as string[] };
    const items = readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    const folds: Record<string, number> = {};
    for (const it of items) if (it.fold !== undefined) folds[String(it.fold)] = (folds[String(it.fold)] ?? 0) + 1;
    const hidden = new Set(["gold", "fold", ...cfg.hidden_fields]);
    return { items: items.length, folds, fields: Object.keys(items[0] ?? {}).filter((k) => !hidden.has(k)) };
  };
  return { train: count("train.jsonl"), test: count("test.jsonl") };
}

function scenarios() {
  return {
    backends: reachableBackends().map((b) => b.kind),
    mode: process.env.INNGEST_DEV ? "local" : "cloud",
    scenarios: scenarioConfigs().map(({ name, text, cfg }) => ({
      name,
      yaml: text,
      config: relativeConfig(cfg),
      spec: Object.fromEntries(
        readdirSync(cfg.spec_dir).filter((f) => f.endsWith(".md")).map((f) => [f, readFileSync(join(cfg.spec_dir, f), "utf8")]),
      ),
      dataset: datasetStats(cfg),
    })),
  };
}

// ---------- nights ----------

type NightFile = { night_id: string; startedAt: number; deadlineMs: number; config: NightConfig };
type DoneFile = { stop_reason: string; rounds: number; kept: { exp_id: string; opt_score: number }; spend_usd: number; finished_at: string };
type CodeState = {
  startedAt: number; coderUsd: number; devUsd?: number; tokens: number; tCode: number; finishedAt?: number; stop?: string;
};

/** Every night on this worker's disk: `runs/<scenario>/nights/<id>/night.json`. */
function nightFiles(): { scenario: string; dir: string; night: NightFile }[] {
  const runs = join(root(), "runs");
  if (!existsSync(runs)) return [];
  return readdirSync(runs).flatMap((scenario) => {
    const nights = join(runs, scenario, "nights");
    if (!existsSync(nights)) return [];
    return readdirSync(nights).flatMap((id) => {
      const night = readJson<NightFile>(join(nights, id, "night.json"));
      return night?.config ? [{ scenario, dir: join(nights, id), night }] : [];
    });
  });
}

function findNight(id: string) {
  if (!NIGHT_ID.test(id)) throw new HttpError(400, "invalid night id");
  const n = nightFiles().find((f) => f.night.night_id === id);
  if (!n) throw new HttpError(404, `no night ${id}`);
  return n;
}

/** Newest mtime under a directory (two levels deep is enough: exps/<id>/code-state.json). */
function lastActivity(dir: string): number {
  let t = statSync(dir).mtimeMs;
  for (const a of readdirSync(dir)) {
    const p = join(dir, a);
    const s = statSync(p);
    t = Math.max(t, s.mtimeMs);
    if (s.isDirectory()) for (const b of readdirSync(p)) t = Math.max(t, statSync(join(p, b)).mtimeMs);
  }
  return t;
}

function summary({ scenario, dir, night }: ReturnType<typeof findNight>) {
  const cfg = night.config;
  const done = readJson<DoneFile>(join(dir, "done.json"));
  const stop = readJson<{ at: string; reason: string }>(join(dir, "stop.json"));
  const rows = readRows(cfg.results_path).filter((r) => r.night_id === night.night_id);
  const exps = existsSync(join(dir, "exps")) ? readdirSync(join(dir, "exps")) : [];
  const round = Math.max(0, ...exps.map((e) => Number(/-r(\d+)-b\d+$/.exec(e)?.[1] ?? 0)));
  const kept = rows.filter((r) => r.kind === "experiment" && r.decision === "keep").at(-1);
  const status = done ? "finished" : stop ? "stopped" : Date.now() - lastActivity(dir) > STALE_MS ? "stale" : "running";
  return {
    id: night.night_id, scenario, sandbox: cfg.sandbox, status, stop_reason: done?.stop_reason ?? (stop ? "stopped" : null),
    round, max_rounds: cfg.max_rounds, primary_metric: cfg.primary_metric,
    best: done?.kept.opt_score ?? kept?.metrics[cfg.primary_metric] ?? null, best_exp: done?.kept.exp_id ?? kept?.exp_id ?? null,
    threshold: cfg.thresholds[cfg.primary_metric] ?? null,
    spend_usd: done?.spend_usd ?? nightSpend(rows), budget_usd: cfg.budget_usd.night,
    started_at: night.startedAt, deadline_at: night.deadlineMs, finished_at: done?.finished_at ?? null,
  };
}

/** Per branch of the current round: model, coding / waiting / evaluated, elapsed, spend. */
function live(n: ReturnType<typeof findNight>) {
  const cfg = n.night.config;
  const s = summary(n);
  const rows = readRows(cfg.results_path).filter((r) => r.night_id === n.night.night_id);
  const coding = cfg.models.map((model, b) => {
    const expId = `${n.night.night_id}-r${s.round}-b${b}`;
    const state = readJson<CodeState>(join(n.dir, "exps", expId, "code-state.json"));
    const row = rows.find((r) => r.exp_id === expId && r.kind === "experiment");
    const phase = row ? "evaluated" : !state ? "starting" : state.finishedAt ? "waiting for eval" : "coding";
    return {
      branch: b, exp_id: expId, model, phase,
      elapsed_s: state ? Math.round(((state.finishedAt ?? Date.now()) - state.startedAt) / 1000) : 0,
      coder_usd: state?.coderUsd ?? 0, dev_usd: state?.devUsd ?? 0, tokens: state?.tokens ?? 0,
      stop: state?.stop ?? null, score: row?.metrics[cfg.primary_metric] ?? null, decision: row?.decision ?? null,
    };
  });
  // Exportable: every committed experiment, newest first.
  const experiments = rows
    .filter((r) => r.kind === "experiment" && r.commit)
    .map((r) => ({ exp_id: r.exp_id, round: r.round, decision: r.decision, score: r.metrics[cfg.primary_metric] ?? null, hypothesis: r.hypothesis }))
    .reverse();
  const branches = s.round > 0 && s.status === "running" ? coding : [];
  // Spend so far: finished rows plus what the current round's coders have spent before their rows land.
  const pending = branches.filter((b) => !b.decision).reduce((a, b) => a + b.coder_usd + b.dev_usd, 0);
  return { ...s, spend_usd: Math.round((s.spend_usd + pending) * 10_000) / 10_000, branches, rows: rows.length, experiments };
}

async function report(n: ReturnType<typeof findNight>): Promise<string> {
  const data = await buildReportData(n.night.config.results_path, { title: n.night.night_id });
  data.nights = data.nights.filter((x) => x.id === n.night.night_id);
  const ids = new Set(data.nights.flatMap((x) => x.rows.map((r) => r.exp_id)));
  data.diffs = Object.fromEntries(Object.entries(data.diffs).filter(([k]) => ids.has(k)));
  return renderReport(data);
}

async function startNight(body: { scenario?: string; night_id?: string; overrides?: Record<string, unknown> }) {
  const scenario = scenarioConfigs().find((s) => s.name === body.scenario);
  if (!scenario) throw new HttpError(400, `unknown scenario ${body.scenario}`);
  const raw = parse(scenario.text) as Record<string, unknown>;
  for (const [k, v] of Object.entries(body.overrides ?? {})) {
    if (!(OVERRIDABLE as readonly string[]).includes(k)) throw new HttpError(400, `${k} cannot be overridden`);
    raw[k] = v;
  }
  let cfg: NightConfig;
  try {
    cfg = parseConfig(stringify(raw), root());
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  if (!reachableBackends().some((b) => b.kind === cfg.sandbox)) throw new HttpError(400, `this worker cannot use sandbox ${cfg.sandbox}`);
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  const nightId = body.night_id || `n${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  if (!NIGHT_ID.test(nightId)) throw new HttpError(400, "night id: letters, digits and dashes, at most 48");
  if (nightFiles().some((f) => f.night.night_id === nightId) || existsSync(nightPaths(cfg, nightId).nightDir)) {
    throw new HttpError(409, `night ${nightId} exists`);
  }
  try {
    await checkModels([...cfg.models, cfg.reviewer_model, ...cfg.allowed_models.filter((m) => !isEmbeddingModel(m))]);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  const { ids } = await ccInngest.send({ name: "codeclimb/night.start", data: { night_id: nightId, config: relativeConfig(cfg) } });
  return { night_id: nightId, event_id: ids[0] };
}

async function stopNight(n: ReturnType<typeof findNight>) {
  // night-stop-cleanup writes it too; writing it now shows the stop at once.
  markStopped(n.night.night_id, "app");
  await ccInngest.send({ name: "codeclimb/night.stop", data: { night_id: n.night.night_id, reason: "app" } });
  return { stopped: n.night.night_id };
}

/** The experiment's code: a tar.gz of its tree, or a git bundle with its lineage. */
function exportStream(n: ReturnType<typeof findNight>, expId: string, format: string, res: ServerResponse): void {
  validateExpId(expId);
  if (!expId.startsWith(`${n.night.night_id}-`)) throw new HttpError(400, "experiment is not from this night");
  const gitDir = nightPaths(n.night.config, n.night.night_id).gitDir;
  const ref = `refs/exp/${expId}`;
  const args =
    format === "bundle" ? ["--git-dir", gitDir, "bundle", "create", "-", ref] : ["--git-dir", gitDir, "archive", "--format=tar.gz", `--prefix=${expId}/`, ref];
  const name = format === "bundle" ? `${expId}.bundle` : `${expId}.tar.gz`;
  const p = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"] });
  let started = false;
  let err = "";
  p.stderr.on("data", (d) => (err += d));
  p.stdout.on("data", (chunk: Buffer) => {
    if (!started) {
      started = true;
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${name}"` });
    }
    res.write(chunk);
  });
  p.on("close", (code) => {
    if (started) return void res.end();
    send(res, code === 0 ? 500 : 404, { error: code === 0 ? "empty export" : `no experiment ${expId}: ${err.trim().split("\n").at(-1)}` });
  });
}

// ---------- server ----------

function send(res: ServerResponse, status: number, body: unknown, type = "application/json"): void {
  const text = type === "application/json" ? JSON.stringify(body) : String(body);
  res.writeHead(status, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store" });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 1_000_000) throw new HttpError(413, "body too large");
  }
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, "body must be JSON");
  }
}

const digest = (s: string) => createHash("sha256").update(s).digest();

function authorized(req: IncomingMessage): boolean {
  const token = process.env.CODECLIMB_WORKER_TOKEN;
  if (!token) return true; // loopback only, enforced at listen
  const got = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
  return timingSafeEqual(digest(got), digest(token));
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://worker");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  try {
    // The metering proxy authenticates by its own per-ledger tokens.
    if (path.startsWith("/v1/")) return void (await (await meter()).handle(req, res));
    if (!authorized(req)) throw new HttpError(401, "missing or wrong worker token");
    const m = /^\/api\/nights\/([^/]+)(?:\/(live|report|stop|export)(?:\/([^/]+))?)?$/.exec(path);
    if (req.method === "GET" && path === "/api/health") return send(res, 200, { ok: true });
    if (req.method === "GET" && path === "/api/scenarios") return send(res, 200, scenarios());
    if (req.method === "GET" && path === "/api/nights") {
      const all = nightFiles().map(summary).sort((a, b) => b.started_at - a.started_at);
      return send(res, 200, { nights: all });
    }
    if (req.method === "POST" && path === "/api/nights") return send(res, 201, await startNight(await readBody(req)));
    if (m) {
      const n = findNight(decodeURIComponent(m[1]));
      if (req.method === "GET" && !m[2]) return send(res, 200, summary(n));
      if (req.method === "GET" && m[2] === "live") return send(res, 200, live(n));
      if (req.method === "GET" && m[2] === "report") return send(res, 200, await report(n), "text/html");
      if (req.method === "POST" && m[2] === "stop") return send(res, 200, await stopNight(n));
      if (req.method === "GET" && m[2] === "export" && m[3]) return exportStream(n, decodeURIComponent(m[3]), url.searchParams.get("format") ?? "tar.gz", res);
    }
    throw new HttpError(404, `no route ${req.method} ${path}`);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error("[api]", e);
    if (!res.headersSent) send(res, status, { error: (e as Error).message });
    else res.end();
  }
}

/**
 * Serve the API on CODECLIMB_API_HOST:CODECLIMB_API_PORT (default 127.0.0.1:7421, or PORT on a host
 * that sets it). Off the loopback interface a token is required. A busy port is logged, not fatal:
 * a local and a cloud worker may run side by side.
 */
export async function serveApi(): Promise<Server | null> {
  const host = process.env.CODECLIMB_API_HOST ?? "127.0.0.1";
  const port = Number(process.env.CODECLIMB_API_PORT ?? process.env.PORT ?? 7421);
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(host);
  if (!loopback && !process.env.CODECLIMB_WORKER_TOKEN) throw new Error(`the worker API on ${host} needs CODECLIMB_WORKER_TOKEN`);
  const server = createServer((req, res) => void handle(req, res));
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, resolve);
    });
  } catch (e) {
    console.warn(`[api] not serving on ${host}:${port}: ${(e as Error).message}`);
    return null;
  }
  console.log(`[api] http://${host}:${port}/api (metering proxy at /v1)`);
  return server;
}
