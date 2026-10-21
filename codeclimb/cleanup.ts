import type { NightConfig } from "./config";
import { sandboxPrefix } from "./paths";
import { sandboxBackend } from "./sandbox";

/** Destroy every sandbox left over from a night (crashed attempts, auto-paused sandboxes). */
export function sweepNight(cfg: Pick<NightConfig, "sandbox">, nightId: string): Promise<number> {
  return sandboxBackend(cfg.sandbox).sweep({ prefix: sandboxPrefix(nightId) });
}

/** Destroy the sandboxes a (cancelled) Inngest run created. */
export function sweepRun(cfg: Pick<NightConfig, "sandbox">, runId: string): Promise<number> {
  return sandboxBackend(cfg.sandbox).sweep({ label: ["cc.run", runId] });
}
