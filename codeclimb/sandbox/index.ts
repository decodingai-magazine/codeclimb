import { DockerBackend } from "./docker";
import type { SandboxBackend } from "./types";

export function sandboxBackend(kind: "docker" | "inngest"): SandboxBackend {
  if (kind === "docker") return new DockerBackend();
  // Inngest Sandboxes are Cloud-only (Pro+); this iteration runs on the local dev server.
  throw new Error('sandbox "inngest" is not implemented in this iteration (local dev server only); use sandbox: docker');
}
