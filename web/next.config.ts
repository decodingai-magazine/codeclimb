// The app: a Next.js project of its own, so Pi and the graphs stay out of its bundle (spec: App).
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The checkout root: node_modules and the shared types live there.
  turbopack: { root: dirname(dirname(fileURLToPath(import.meta.url))) },
  // The checkout's own AGENTS.md is the only one: no generated web/AGENTS.md.
  agentRules: false,
};

export default nextConfig;
