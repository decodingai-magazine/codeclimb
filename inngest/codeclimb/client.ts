import { eventType, Inngest, staticSchema } from "inngest";
import { extendedTracesMiddleware, scoreMiddleware } from "inngest/experimental";
import type { NightConfig } from "../../codeclimb/config";

// A separate app from the Next.js one: the CodeClimb worker connects with
// `connect()` and keeps Pi (and its native deps) out of the Next bundle.
export const ccInngest = new Inngest({
  id: "codeclimb-worker",
  middleware: [scoreMiddleware(), extendedTracesMiddleware()],
});

export const nightStart = eventType("codeclimb/night.start", {
  schema: staticSchema<{ night_id: string; config: NightConfig }>(),
});

/**
 * A night start with a stable event id: Inngest drops a duplicate send, so one night id starts one run.
 * The dedup also holds for a later retry of the same night id (within Inngest's dedup window), so a
 * night whose start failed before `init` needs a new id.
 */
export function nightStartEvent(nightId: string, config: NightConfig) {
  return { id: `night-start-${nightId}`, name: nightStart.name, data: { night_id: nightId, config } };
}

export const nightStop = eventType("codeclimb/night.stop", {
  schema: staticSchema<{ night_id: string; reason?: string }>(),
});
