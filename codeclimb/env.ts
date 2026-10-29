// Side-effect import, first in every CLI/worker entry point: loads `.env.local`
// (gitignored) the way `next dev` does for the app, so provider keys such as
// ANTHROPIC_API_KEY reach the CLI and the worker alike. Variables already set win.
//
// CODECLIMB_ENV=cloud first loads `.env.cloud.local` (Inngest Cloud signing and
// event keys), so its values win over `.env.local`. Cloud mode refuses
// INNGEST_DEV: the SDK would quietly talk to the dev server instead.
import { existsSync } from "node:fs";

const cloud = process.env.CODECLIMB_ENV === "cloud";
if (cloud && existsSync(".env.cloud.local")) process.loadEnvFile(".env.cloud.local");
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

if (cloud) {
  if (process.env.INNGEST_DEV) throw new Error("CODECLIMB_ENV=cloud: unset INNGEST_DEV (it points the SDK at the dev server)");
  const missing = ["INNGEST_SIGNING_KEY", "INNGEST_EVENT_KEY"].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`CODECLIMB_ENV=cloud: set ${missing.join(" and ")} in .env.cloud.local`);
}
