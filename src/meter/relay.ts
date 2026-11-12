// The path from a metered sandbox to the proxy: the `cc-meter` network and the shared relay container (spec: Metering proxy, Path to the proxy).
import { docker } from "../sandbox/docker.ts";

export const METER_NETWORK = "cc-meter";
export const RELAY = "cc-meter-relay";
export const RELAY_PORT = 8080;
export const RELAY_URL = `http://${RELAY}:${RELAY_PORT}/v1`;

/** A TCP forwarder written with Python's standard library: 8080 → the target and the proxy's port. */
const forwarder = (target: string, port: number) => `
import socket, threading
def pipe(a, b):
    try:
        while True:
            d = a.recv(65536)
            if not d: break
            b.sendall(d)
    except OSError: pass
    finally:
        for s in (a, b):
            try: s.shutdown(socket.SHUT_RDWR)
            except OSError: pass
def handle(c):
    try: u = socket.create_connection(("${target}", ${port}))
    except OSError:
        c.close(); return
    threading.Thread(target=pipe, args=(c, u), daemon=True).start()
    threading.Thread(target=pipe, args=(u, c), daemon=True).start()
srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("0.0.0.0", ${RELAY_PORT})); srv.listen(256)
while True:
    c, _ = srv.accept(); threading.Thread(target=handle, args=(c,), daemon=True).start()
`;

type RelayState = { running: boolean; port: number; target: string; onNetwork: boolean };

async function relayState(): Promise<RelayState | null> {
	const r = await docker(["inspect", "--format", '{{.State.Running}} {{index .Config.Labels "cc.meter.port"}} {{index .Config.Labels "cc.meter.target"}} {{json .NetworkSettings.Networks}}', RELAY]);
	if (r.code !== 0) return null;
	const [running, port, target, ...nets] = r.stdout.toString().trim().split(" ");
	return { running: running === "true", port: Number(port), target: target ?? "", onNetwork: nets.join(" ").includes(`"${METER_NETWORK}"`) };
}

/** The relay forwards to this server's proxy: it runs, and its port and target labels match. */
const matches = (s: RelayState | null, port: number, target: string) => !!s?.running && s.port === port && s.target === target;

let lock: Promise<void> = Promise.resolve();

/** The path is up: `cc-meter` and the relay exist, the relay runs, its port label is the proxy's port and its target label the relay target; otherwise recreate it. */
export function ensureMeterPath(image: string, port: number): Promise<void> {
	const next = lock.then(() => ensure(image, port));
	lock = next.catch(() => {});
	return next;
}

/** Create `cc-meter` when it is missing; another caller creating it first is fine. */
export async function ensureMeterNetwork(): Promise<void> {
	if ((await docker(["network", "inspect", METER_NETWORK])).code === 0) return;
	const c = await docker(["network", "create", METER_NETWORK]);
	if (c.code !== 0 && !/already exists/.test(c.stderr)) throw new Error(`docker network create ${METER_NETWORK} failed: ${c.stderr.trim()}`);
}

async function ensure(image: string, port: number): Promise<void> {
	await ensureMeterNetwork();
	// Where the relay forwards: the server container's alias on cc-meter (CODECLIMB_RELAY_TARGET), else the host alias.
	const target = process.env.CODECLIMB_RELAY_TARGET ?? "host.docker.internal";
	const s = await relayState();
	if (s && matches(s, port, target)) {
		if (!s.onNetwork) await docker(["network", "connect", METER_NETWORK, RELAY]);
		return;
	}
	if (s) await docker(["rm", "-f", RELAY]);
	const run = await docker([
		"run", "-d", "--name", RELAY, "--label", "cc.meter=1", "--label", `cc.meter.port=${port}`, "--label", `cc.meter.target=${target}`,
		"--add-host", "host.docker.internal:host-gateway", image, "python3", "-c", forwarder(target, port),
	]);
	if (run.code !== 0) {
		// Another caller may have just started it: accept theirs when it matches.
		const again = await relayState();
		if (!matches(again, port, target)) throw new Error(`the relay failed to start: ${run.stderr.trim().slice(-1000)}`);
	}
	const conn = await docker(["network", "connect", METER_NETWORK, RELAY]);
	if (conn.code !== 0 && !/already exists|endpoint with name/.test(conn.stderr)) throw new Error(`docker network connect failed: ${conn.stderr.trim()}`);
	const ready = await relayState();
	if (!ready?.running) throw new Error("the relay is not running");
}

/** The environment a metered program or coder shell gets. */
export const meterEnv = (token: string): Record<string, string> => ({
	OPENAI_BASE_URL: RELAY_URL,
	OPENAI_API_KEY: token,
	CODECLIMB_LLM_BASE_URL: RELAY_URL,
	CODECLIMB_LLM_API_KEY: token,
});
