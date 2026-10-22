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

export const nightStop = eventType("codeclimb/night.stop", {
  schema: staticSchema<{ night_id: string; reason?: string; sandbox?: "docker" | "inngest" }>(),
});
