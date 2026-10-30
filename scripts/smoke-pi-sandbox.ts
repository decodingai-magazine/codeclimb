// Dev check: one Pi prompt whose tools run inside a Docker sandbox.
//   npx tsx scripts/smoke-pi-sandbox.ts [model]   e.g. anthropic/claude-haiku-5-5, opencode-go/kimi-k3
import "../codeclimb/env";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExperimentRepo } from "../codeclimb/git";
import { createIsolatedSession } from "../codeclimb/pi/session";
import { sandboxTools } from "../codeclimb/pi/tools";
import { commitAndExport } from "../codeclimb/sandbox/repo";
import { DockerBackend } from "../codeclimb/sandbox/docker";

const model = process.argv[2] ?? "github-copilot/claude-haiku-5.5";
const tmp = await mkdtemp(join(tmpdir(), "cc-smoke-"));
const repo = new ExperimentRepo(join(tmp, "experiments.git"));
await repo.ensure();
await repo.importDir("scenarios/datenorm/spec/starter", "smoke-r0");
const backend = new DockerBackend();
const sandbox = await backend.create({ name: "cc-smoke-pi", baseline: "autocode-base", commit: await repo.bundle("smoke-r0") });
try {
  const session = await createIsolatedSession({ model, tools: sandboxTools(sandbox), sessionManager: SessionManager.inMemory("/repo") });
  const used: string[] = [];
  session.subscribe((e) => {
    if (e.type === "tool_execution_start") used.push(e.toolName);
  });
  await session.prompt(
    "Run `pwd && ls -A && python3 --version`. Then create notes.txt containing 'hi', then use the edit tool to change it to 'hello', then read it back. Reply with the final file content only.",
  );
  console.log("tools:", used.join(", "));
  console.log("answer:", session.getLastAssistantText());
  const sp = session.systemPrompt;
  console.log("system prompt mentions /repo:", sp.includes("/repo"), "| host cwd leaked:", sp.includes(process.cwd()), "| AGENTS.md leaked:", sp.includes("Inngest debugging"));
  console.log("--- system prompt (head) ---\n" + sp.slice(0, 600));
  session.dispose();
  const out = await commitAndExport(sandbox, "refs/exp/smoke-r0", "smoke");
  const sha = await repo.importBundle(out.bundle, "smoke-r1");
  console.log("committed", out.sha, "imported", sha);
  console.log(await repo.diff("smoke-r0", "smoke-r1"));
} finally {
  await sandbox.destroy();
}
