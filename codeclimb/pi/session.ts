// Pi sessions isolated from the worker host: no AGENTS.md, skills, prompt
// templates, extensions or ~/.pi settings. Only Pi's base system prompt (with
// cwd = /repo) plus what we pass in the user prompt reaches the model.
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  type AgentSession,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { REPO_DIR } from "./tools";

let runtime: Promise<ModelRuntime> | undefined;

/**
 * One model runtime per worker. Credentials come from `auth.json` (`~/.pi/agent/auth.json`, or
 * CODECLIMB_PI_AUTH_PATH) or the provider's env var; see AUTH_HINTS.
 */
export function modelRuntime(): Promise<ModelRuntime> {
  runtime ??= ModelRuntime.create({ authPath: process.env.CODECLIMB_PI_AUTH_PATH });
  return runtime;
}

/** How to give Pi credentials, per provider. */
const AUTH_HINTS: Record<string, string> = {
  "github-copilot": "run `npx pi`, then `/login github-copilot`; or set COPILOT_GITHUB_TOKEN",
  anthropic: "set ANTHROPIC_API_KEY; or run `npx pi`, then `/login anthropic` and paste the key",
  opencode: "set OPENCODE_API_KEY (OpenCode Zen); or run `npx pi`, then `/login opencode`",
  "opencode-go": "set OPENCODE_API_KEY (OpenCode Go); or run `npx pi`, then `/login opencode-go`",
  openrouter: "set OPENROUTER_API_KEY",
};

export async function resolveModel(ref: string) {
  const slash = ref.indexOf("/");
  if (slash < 0) throw new Error(`model "${ref}" must be "<provider>/<id>", e.g. github-copilot/claude-haiku-5.5 or anthropic/claude-haiku-5-5`);
  const rt = await modelRuntime();
  const model = rt.getModel(ref.slice(0, slash), ref.slice(slash + 1));
  if (!model) throw new Error(`unknown model ${ref} (list ids with \`npx pi --list-models ${ref.slice(slash + 1)}\`)`);
  return model;
}

/**
 * Throws, listing every problem, unless each model exists, its provider has credentials and the
 * account may use it. Catches missing keys, not wrong ones: those fail on the first model call.
 */
export async function checkModels(refs: string[]): Promise<void> {
  const rt = await modelRuntime();
  const problems: string[] = [];
  for (const ref of new Set(refs)) {
    let model;
    try {
      model = await resolveModel(ref);
    } catch (e) {
      problems.push((e as Error).message);
      continue;
    }
    const hint = AUTH_HINTS[model.provider] ?? `run \`npx pi\`, then \`/login ${model.provider}\``;
    if (!(await rt.checkAuth(model.provider))) problems.push(`${ref}: no ${model.provider} credentials; ${hint}`);
    else if (!(await rt.getAvailable(model.provider)).some((m) => m.id === model.id)) {
      problems.push(`${ref}: not available to this ${model.provider} account`);
    }
  }
  if (problems.length) throw new Error(`models not ready:\n  - ${problems.join("\n  - ")}`);
}

function isolatedLoader(systemPrompt?: string): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    // undefined keeps Pi's default base prompt.
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

export interface IsolatedSessionOptions {
  model: string;
  /** Sandbox tools; omit for a tool-less session (the reviewer). */
  tools?: ToolDefinition[];
  /** Persisted (resumable) or in-memory session storage. */
  sessionManager: SessionManager;
  /** Replaces Pi's base prompt. Only the reviewer sets it. */
  systemPrompt?: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high";
}

export async function createIsolatedSession(opts: IsolatedSessionOptions): Promise<AgentSession> {
  // An empty agent dir: nothing from ~/.pi/agent is discovered.
  const agentDir = join(tmpdir(), "codeclimb-pi-agent");
  mkdirSync(agentDir, { recursive: true });
  const { session } = await createAgentSession({
    cwd: REPO_DIR,
    agentDir,
    modelRuntime: await modelRuntime(),
    model: await resolveModel(opts.model),
    thinkingLevel: opts.thinkingLevel ?? "medium",
    resourceLoader: isolatedLoader(opts.systemPrompt),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: true, maxRetries: 4 },
    }),
    sessionManager: opts.sessionManager,
    ...(opts.tools ? { customTools: opts.tools, tools: opts.tools.map((t) => t.name) } : { noTools: "all" as const }),
  });
  return session;
}

/** A persisted session in `dir` (new) or the existing one there (resume). */
export function sessionManagerFor(dir: string, existingFile?: string): SessionManager {
  return existingFile ? SessionManager.open(existingFile, dir, REPO_DIR) : SessionManager.create(REPO_DIR, dir);
}
