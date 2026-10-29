// Side-effect import, first in every CLI/worker entry point: loads `.env.local`
// (gitignored) the way `next dev` does for the app, so provider keys such as
// ANTHROPIC_API_KEY reach the CLI and the worker alike. Variables already set win.
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
