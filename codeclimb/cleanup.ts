import { sandboxPrefix } from "./paths";
import { reachableBackends } from "./sandbox";
import type { SandboxBackend } from "./sandbox/types";

// Sweeps try every backend this worker reaches, so a stop never leaves billed sandboxes
// because the event did not say which backend the night used. One backend failing
// (no Docker on a cloud host) does not stop the others.
async function sweepAll(filter: Parameters<SandboxBackend["sweep"]>[0]): Promise<number> {
  const counts = await Promise.all(reachableBackends().map((b) => b.sweep(filter).catch(() => 0)));
  return counts.reduce((a, b) => a + b, 0);
}

/** Destroy every sandbox left over from a night (crashed attempts, auto-paused sandboxes). */
export function sweepNight(nightId: string): Promise<number> {
  return sweepAll({ prefix: sandboxPrefix(nightId) });
}

/** Destroy the sandboxes a (cancelled) Inngest run created. */
export function sweepRun(runId: string): Promise<number> {
  return sweepAll({ label: ["cc.run", runId] });
}
