// The worker's metering proxy and, for Docker, the path to it: an internal
// network (no route anywhere) shared by metered evaluators and one relay
// container that also sits on the default bridge and forwards TCP to the proxy
// on the host. A metered evaluator can reach the proxy and nothing else.
import type { NightConfig } from "../config";
import { docker } from "../sandbox/docker";
import { modelRuntime } from "../pi/session";
import { piBackends } from "./backends";
import { MeterProxy } from "./proxy";

export const METER_NETWORK = "cc-meter";
const RELAY = "cc-meter-relay";
/** The proxy as a metered evaluator sees it. */
export const METER_BASE_URL = `http://${RELAY}:8080/v1`;

/** A program may call models only when the night lists some. */
export const isMetered = (cfg: Pick<NightConfig, "allowed_models">) => cfg.allowed_models.length > 0;

/** What a metered program sees: the proxy as an OpenAI-compatible endpoint, keyed by one ledger's token. */
export function meterEnv(token: string): Record<string, string> {
  return {
    OPENAI_BASE_URL: METER_BASE_URL, OPENAI_API_KEY: token, CODECLIMB_LLM_BASE_URL: METER_BASE_URL, CODECLIMB_LLM_API_KEY: token,
  };
}

let proxy: Promise<MeterProxy> | undefined;

/**
 * One proxy per worker. It binds loopback by default, which Docker Desktop reaches through
 * host.docker.internal; on Linux set CODECLIMB_PROXY_HOST to the docker0 address (e.g. 172.17.0.1).
 */
export function meter(): Promise<MeterProxy> {
  proxy ??= (async () => {
    const p = new MeterProxy(piBackends(await modelRuntime()), process.env.CODECLIMB_PROXY_HOST ?? "127.0.0.1");
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
