// List the newest Inngest sandboxes: start time, name, status, error.
//   CODECLIMB_ENV=cloud npx tsx scripts/sandboxes.ts [limit]
import "../codeclimb/env";
import { ccInngest } from "../inngest/codeclimb/client";

const { items } = await ccInngest.sandboxes.list({ limit: Number(process.argv[2] ?? 10) });
for (const s of items) console.log(s.createdAt.slice(0, 19), s.status.padEnd(11), s.name, s.error ?? "");
