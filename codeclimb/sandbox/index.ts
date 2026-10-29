import { DockerBackend } from "./docker";
import { InngestBackend } from "./inngest";
import type { SandboxBackend } from "./types";

export function sandboxBackend(kind: "docker" | "inngest"): SandboxBackend {
  if (kind === "docker") return new DockerBackend();
  // In dev mode the SDK sends sandbox calls to the dev server, which forwards them only after `inngest login`.
  if (process.env.INNGEST_DEV) throw new Error('sandbox "inngest" needs Inngest Cloud: run the cloud worker (npm run worker:cloud), or use sandbox: docker');
  return new InngestBackend();
}

/** The backends this worker can reach, for sweeps that must not miss a sandbox: Docker always, Inngest in cloud mode. */
export function reachableBackends(): SandboxBackend[] {
  return process.env.INNGEST_DEV || !process.env.INNGEST_SIGNING_KEY ? [new DockerBackend()] : [new DockerBackend(), new InngestBackend()];
}
