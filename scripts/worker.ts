// The CodeClimb worker: orchestrator + Pi, connected to Inngest over `connect()`
// (long-running steps, no HTTP request timeouts). Locally it connects to the
// Inngest dev server when INNGEST_DEV=1. It also serves the app's API (and the
// metering proxy at /v1) on CODECLIMB_API_PORT, default 7421.
//   npm run worker
import "../codeclimb/env";
import { spawn } from "node:child_process";
import { connect } from "inngest/connect";
import { serveApi } from "../codeclimb/api";
import { ccInngest } from "../inngest/codeclimb/client";
import { codeclimbFunctions } from "../inngest/codeclimb/functions";

// A night runs on this machine, so on macOS it must not idle-sleep while the worker is up.
if (process.platform === "darwin") spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" }).unref();

const connection = await connect({
  apps: [{ client: ccInngest, functions: codeclimbFunctions }],
  instanceId: process.env.CODECLIMB_WORKER_ID ?? "codeclimb-worker-local",
});
await serveApi();
console.log(`[worker] connected (${connection.connectionId}); functions: ${codeclimbFunctions.map((f) => f.id()).join(", ")}`);
await connection.closed;
console.log("[worker] connection closed");
