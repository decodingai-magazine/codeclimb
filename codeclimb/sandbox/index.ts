import { spawnSync } from "node:child_process";
import { DockerBackend } from "./docker";
import { InngestBackend } from "./inngest";
import type { SandboxBackend } from "./types";

export function sandboxBackend(kind: "docker" | "inngest"): SandboxBackend {
  if (kind === "docker") return new DockerBackend();
  // In dev mode the SDK sends sandbox calls to the dev server, which forwards them only after `inngest login`.
  if (process.env.INNGEST_DEV) throw new Error('sandbox "inngest" needs Inngest Cloud: run the cloud worker (npm run worker:cloud), or use sandbox: docker');
  return new InngestBackend();
}

let docker: boolean | undefined;
/** Whether a Docker daemon answers (checked once; a hosted worker has none). */
function hasDocker(): boolean {
  docker ??= spawnSync("docker", ["info", "--format", "{{.ID}}"], { stdio: "ignore", timeout: 5000 }).status === 0;
  return docker;
}

/** The backends this worker can reach: Docker when a daemon answers, Inngest in cloud mode. Sweeps try each. */
export function reachableBackends(): SandboxBackend[] {
  const cloud = !process.env.INNGEST_DEV && !!process.env.INNGEST_SIGNING_KEY;
  return [...(hasDocker() ? [new DockerBackend()] : []), ...(cloud ? [new InngestBackend()] : [])];
}
