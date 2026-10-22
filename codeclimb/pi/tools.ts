// Pi's 4 tools (read, write, edit, bash) with their operations routed into a
// sandbox. Same names as the built-ins, so they replace them; grep/find/ls stay off.
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Sandbox } from "../sandbox/types";
import { sandboxSpan } from "../tracing";

export const REPO_DIR = "/repo";
export const CODER_TOOLS = ["read", "write", "edit", "bash"];

/** Per-command cap when the model gives none; the experiment timeout still applies on top. */
const DEFAULT_BASH_TIMEOUT_MS = 10 * 60_000;

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

async function access(sandbox: Sandbox, path: string, flags: string): Promise<void> {
  const r = await sandbox.exec(`test ${flags} ${quote(path)}`, { cwd: "/" });
  if (r.exitCode !== 0) throw new Error(`ENOENT: no such file or not accessible: ${path}`);
}

export function sandboxTools(sandbox: Sandbox): ToolDefinition[] {
  const attrs = { "codeclimb.sandbox": sandbox.name };
  const timed = <T>(name: string, fn: () => Promise<T>): Promise<T> => sandboxSpan(name, attrs, fn);
  const readFile = (p: string) => timed("sandbox.readFile", () => sandbox.readFile(p));
  const writeFile = (p: string, c: string) => timed("sandbox.writeFile", () => sandbox.writeFile(p, c));

  return [
    createReadToolDefinition(REPO_DIR, {
      autoResizeImages: false,
      operations: { readFile, access: (p) => access(sandbox, p, "-r") },
    }),
    createWriteToolDefinition(REPO_DIR, {
      operations: {
        writeFile,
        mkdir: async (dir) => {
          await sandbox.exec(`mkdir -p ${quote(dir)}`, { cwd: "/" });
        },
      },
    }),
    createEditToolDefinition(REPO_DIR, {
      operations: { readFile, writeFile, access: (p) => access(sandbox, p, "-r -a -w") },
    }),
    createBashToolDefinition(REPO_DIR, {
      // Never forward the host environment (PI_* vars, keys) into the sandbox.
      exposeSessionEnvironment: false,
      operations: {
        exec: (command, cwd, { onData, signal, timeout }) =>
          timed("sandbox.exec", async () => {
            const r = await sandbox.exec(command, {
              cwd,
              signal,
              onData,
              timeoutMs: timeout ? timeout * 1000 : DEFAULT_BASH_TIMEOUT_MS,
            });
            if (r.aborted) throw new Error("aborted");
            if (r.timedOut) throw new Error(`timeout:${timeout ?? DEFAULT_BASH_TIMEOUT_MS / 1000}`);
            return { exitCode: r.exitCode };
          }),
      },
    }),
  ] as ToolDefinition[];
}
