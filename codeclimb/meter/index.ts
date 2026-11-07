// The worker's metering proxy and, for Docker, the path to it: an internal
// network (no route anywhere) shared by metered evaluators and one relay
// container that also sits on the default bridge and forwards TCP to the proxy
// on the host. A metered evaluator can reach the proxy and nothing else.
import type { NightConfig } from "../config";
import { docker } from "../sandbox/docker";
import { modelRuntime } from "../pi/session";
import { piBackends, routedBackends } from "./backends";
import { openRouterBackends } from "./openrouter";
import { MeterProxy } from "./proxy";
import { setTimeout as delay } from "node:timers/promises";

export const METER_NETWORK = "cc-meter";
const RELAY = "cc-meter-relay";
/** The proxy as a metered Docker sandbox sees it. */
const RELAY_URL = `http://${RELAY}:8080/v1`;

/** A program may call models only when the night lists some. */
export const isMetered = (cfg: Pick<NightConfig, "allowed_models">) => cfg.allowed_models.length > 0;

/** What a metered program sees: the proxy as an OpenAI-compatible endpoint, keyed by one ledger's token. */
export function meterEnv(token: string, baseUrl: string): Record<string, string> {
  return { OPENAI_BASE_URL: baseUrl, OPENAI_API_KEY: token, CODECLIMB_LLM_BASE_URL: baseUrl, CODECLIMB_LLM_API_KEY: token };
}

/**
 * The proxy's URL as a metered sandbox sees it. Docker: the relay on the metering network, made
 * sure of first. Inngest: sandboxes sit on the internet, so the proxy must be published at a public
 * URL: CODECLIMB_METER_URL (ending in /v1), else the tunnel `npm run tunnel:cloudflare` or
 * `npm run tunnel` (ngrok) opens to the proxy's port. The per-ledger tokens are what guard it.
 */
export async function meterBaseUrl(cfg: Pick<NightConfig, "sandbox" | "scenario">): Promise<string> {
  if (cfg.sandbox === "inngest") {
    const url = await publicMeterUrl(process.env.CODECLIMB_METER_URL, [cloudflareUrl, ngrokUrl], (await meter()).port);
    await checkMeterUrl(url);
    return url;
  }
  await ensureMeterPath(cfg.scenario.image, (await meter()).port);
  return RELAY_URL;
}

/**
 * Throws unless `url` ends at the proxy, which refuses a call with no token in its own words. A tunnel past
 * its limit still answers, with an error of its own that never reaches the proxy, and a program that
 * swallows errors would then score as a bad program. A blip gets more tries: this can follow a long run.
 */
export async function checkMeterUrl(url: string, tries = 3, waitMs = 5000): Promise<void> {
  let seen = "";
  for (let n = 0; n < tries; n += 1) {
    if (n) await delay(waitMs);
    try {
      const res = await fetch(`${url}/_op`, { method: "POST", signal: AbortSignal.timeout(15_000) });
      const body = await res.text();
      if (res.status === 401 && body.includes("authentication_error")) return;
      seen = `${res.status}: ${body.slice(0, 200)}`;
    } catch (e) {
      seen = (e as Error).message;
    }
  }
  throw new Error(`the metering proxy isn't reachable at ${url}, so model calls fail for reasons outside the program (${seen})`);
}

type TunnelLookup = (port: number) => Promise<string | undefined>;

/** The proxy's public URL: `override`, else the first tunnel up. */
export async function publicMeterUrl(override: string | undefined, tunnels: TunnelLookup[], port: number): Promise<string> {
  if (override) return override.replace(/\/$/, "");
  for (const lookup of tunnels) {
    const tunnel = await lookup(port);
    if (tunnel) return `${tunnel}/v1`;
  }
  throw new Error("a metered night on Inngest sandboxes needs the metering proxy at a public URL: run `npm run tunnel:cloudflare` or `npm run tunnel`, or set CODECLIMB_METER_URL (…/v1)");
}

/**
 * The https URL of a Cloudflare quick tunnel, from cloudflared's metrics server (`npm run tunnel:cloudflare`),
 * if one is up. Looked up before ngrok: it runs only if started on purpose, and a blocked ngrok still answers.
 */
async function cloudflareUrl(): Promise<string | undefined> {
  try {
    const res = await fetch("http://127.0.0.1:20241/quicktunnel", { signal: AbortSignal.timeout(2000) });
    const { hostname } = (await res.json()) as { hostname: string };
    return hostname ? `https://${hostname}` : undefined;
  } catch {
    return undefined;
  }
}

/** The https URL of an ngrok tunnel to `port`, from ngrok's local API (`npm run tunnel`), if one is up. */
async function ngrokUrl(port: number): Promise<string | undefined> {
  try {
    const res = await fetch("http://127.0.0.1:4040/api/tunnels", { signal: AbortSignal.timeout(2000) });
    const { tunnels } = (await res.json()) as { tunnels: { public_url: string; config: { addr: string } }[] };
    return tunnels.find((t) => t.public_url.startsWith("https://") && /:(\d+)$/.exec(t.config.addr)?.[1] === String(port))?.public_url;
  } catch {
    return undefined;
  }
}

let proxy: Promise<MeterProxy> | undefined;

/**
 * One proxy per worker. It binds loopback by default, which Docker Desktop reaches through
 * host.docker.internal; on Linux set CODECLIMB_PROXY_HOST to the docker0 address (e.g. 172.17.0.1).
 */
export function meter(): Promise<MeterProxy> {
  proxy ??= (async () => {
    const p = new MeterProxy(routedBackends(openRouterBackends(), piBackends(await modelRuntime())), process.env.CODECLIMB_PROXY_HOST ?? "127.0.0.1");
    await p.listen(Number(process.env.CODECLIMB_PROXY_PORT ?? 0));
    return p;
  })();
  return proxy;
}

// Python's stdlib, so it runs on the scenario's baseline image without pulling another one.
const RELAY_PY = `
import asyncio, os
UP = (os.environ["UP_HOST"], int(os.environ["UP_PORT"]))
async def pipe(r, w):
    try:
        while b := await r.read(65536):
            w.write(b)
            await w.drain()
    except OSError:
        pass
    finally:
        w.close()
async def handle(r, w):
    try:
        ur, uw = await asyncio.open_connection(*UP)
    except OSError:
        w.close()
        return
    await asyncio.gather(pipe(r, uw), pipe(ur, w))
async def main():
    server = await asyncio.start_server(handle, "0.0.0.0", 8080)
    async with server:
        await server.serve_forever()
asyncio.run(main())
`;

async function relayState(): Promise<string> {
  const r = await docker(["inspect", "-f", '{{.State.Running}} {{index .Config.Labels "cc.meter.port"}}', RELAY]);
  return r.code === 0 ? r.stdout.toString().trim() : "";
}

let ensuring: Promise<void> | undefined;

/**
 * The metering network and a relay to this worker's proxy port, (re)created as needed. The relay is
 * not `cc.managed`: night sweeps leave it, since every night of this worker shares it. A round's
 * coders call this at once: they share one run, so none removes a relay another just started.
 */
export function ensureMeterPath(image: string, port: number): Promise<void> {
  const run = (ensuring ?? Promise.resolve()).catch(() => undefined).then(() => ensureOnce(image, port));
  ensuring = run;
  return run;
}

async function ensureOnce(image: string, port: number): Promise<void> {
  if ((await docker(["network", "inspect", METER_NETWORK])).code !== 0) {
    const r = await docker(["network", "create", "--internal", "--label", "cc.meter=1", METER_NETWORK]);
    if (r.code !== 0 && !/already exists/.test(r.stderr.toString())) throw new Error(`cannot create ${METER_NETWORK}: ${r.stderr.toString().trim()}`);
  }
  if ((await relayState()) === `true ${port}`) return;
  await docker(["rm", "-f", RELAY]);
  const run = await docker([
    "run", "-d", "--name", RELAY, "--label", "cc.meter=1", "--label", `cc.meter.port=${port}`,
    "--add-host", "host.docker.internal:host-gateway", "-e", "UP_HOST=host.docker.internal", "-e", `UP_PORT=${port}`,
    image, "python3", "-c", RELAY_PY,
  ]);
  // A concurrent caller may have just created it.
  if (run.code !== 0 && (await relayState()) !== `true ${port}`) throw new Error(`cannot start ${RELAY}: ${run.stderr.toString().trim()}`);
  const connect = await docker(["network", "connect", METER_NETWORK, RELAY]);
  if (connect.code !== 0 && !/already exists|already attached/i.test(connect.stderr.toString())) {
    throw new Error(`cannot attach ${RELAY} to ${METER_NETWORK}: ${connect.stderr.toString().trim()}`);
  }
}
