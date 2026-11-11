// Side-effect import, first in every CLI/worker entry point: loads `.env`
// (gitignored), one file for local and cloud mode, so provider keys such as
// ANTHROPIC_API_KEY reach the CLI and the worker alike. Variables already set win.
//
// CODECLIMB_ENV=cloud needs the Inngest Cloud signing and event keys from `.env`.
// Cloud mode refuses INNGEST_DEV: the SDK would quietly talk to the dev server
// instead. It also pins the metering proxy's port (CODECLIMB_PROXY_PORT, default 7422) for the tunnel.
//
// Any other run is local: INNGEST_DEV defaults to 1, so the cloud keys that share
// `.env` never put the SDK or the sandbox sweep in cloud mode by accident.
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

if (process.env.CODECLIMB_ENV === "cloud") {
  if (process.env.INNGEST_DEV) throw new Error("CODECLIMB_ENV=cloud: unset INNGEST_DEV (it points the SDK at the dev server)");
  const missing = ["INNGEST_SIGNING_KEY", "INNGEST_EVENT_KEY"].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`CODECLIMB_ENV=cloud: set ${missing.join(" and ")} in .env`);
  // A fixed port for the metering proxy, so `npm run tunnel` can publish it to Inngest sandboxes.
  process.env.CODECLIMB_PROXY_PORT ??= "7422";
} else {
  process.env.INNGEST_DEV ??= "1";
}
