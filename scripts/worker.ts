// The CodeClimb worker: orchestrator + Pi, connected to Inngest over `connect()`
// (long-running steps, no HTTP request timeouts). Locally it connects to the
// Inngest dev server when INNGEST_DEV=1.
//   npm run worker
import { connect } from "inngest/connect";
import { ccInngest } from "../inngest/codeclimb/client";
import { codeclimbFunctions } from "../inngest/codeclimb/functions";

const connection = await connect({
  apps: [{ client: ccInngest, functions: codeclimbFunctions }],
  instanceId: process.env.CODECLIMB_WORKER_ID ?? "codeclimb-worker-local",
});
console.log(`[worker] connected (${connection.connectionId}); functions: ${codeclimbFunctions.map((f) => f.id()).join(", ")}`);
await connection.closed;
console.log("[worker] connection closed");
