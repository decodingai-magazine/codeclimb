// Isolated Pi sessions: an empty agent directory, a hand-built resource loader, in-memory settings, and the four
// sandbox tools routed to the sandbox interface (spec: Coder; Pi facts found while building).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type CreateAgentSessionOptions,
	createAgentSession,
	createBashToolDefinition,
	createEditToolDefinition,
	createExtensionRuntime,
	createReadToolDefinition,
	createWriteToolDefinition,
	defineTool,
	type LoadExtensionsResult,
	type ResourceLoader,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { Thinking } from "../config.ts";
import type { Sandbox } from "../sandbox/types.ts";
import { modelRuntime } from "./models.ts";
import { loadWeb, WEB_TOOLS } from "./web.ts";

export const SANDBOX_TOOLS = ["read", "write", "edit", "bash"] as const;
/** A bash command with no timeout of its own. */
export const DEFAULT_BASH_TIMEOUT_S = 600;
export const PI_RETRIES = 4;

let agentDir: string | undefined;
/** An empty agent directory: nothing from the host's ~/.pi reaches a session. */
const emptyAgentDir = () => (agentDir ??= mkdtempSync(join(tmpdir(), "cc-pi-agent-")));

/** No skills, prompts, themes, AGENTS files or appended prompts, and only the given extensions; the system prompt is Pi's base unless given. */
export function isolatedLoader(systemPrompt?: string, extensions?: LoadExtensionsResult): ResourceLoader {
	const loaded = extensions ?? { extensions: [], errors: [], runtime: createExtensionRuntime() };
	return {
		getExtensions: () => loaded,
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => systemPrompt,
		getSystemPromptSource: () => undefined,
		getAppendSystemPrompt: () => [],
		getAppendSystemPromptSources: () => [],
		extendResources: () => {},
		reload: async () => {},
	};
}

const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

async function testAll(sb: Sandbox, path: string, flags: string[]): Promise<void> {
	// One `test` per flag: the sandbox's sh rejects a combined test.
	const r = await sb.exec(flags.map((f) => `test ${f} ${q(path)}`).join(" && "), { cwd: "/" });
	if (r.exitCode !== 0) throw new Error(`${path}: not found or not accessible`);
}

/** Pi's own read, write, edit and bash definitions, their operations routed to `sb`. */
export function sandboxTools(sb: Sandbox, cwd: string, env?: Record<string, string>) {
	const readFile = (p: string) => sb.readFile(p);
	const writeFile = (p: string, content: string) => sb.writeFile(p, content);
	return [
		defineTool(createReadToolDefinition(cwd, { operations: { readFile, access: (p) => testAll(sb, p, ["-r"]) } })),
		defineTool(createWriteToolDefinition(cwd, {
			operations: {
				writeFile,
				mkdir: async (dir) => {
					const r = await sb.exec(`mkdir -p ${q(dir)}`, { cwd: "/" });
					if (r.exitCode !== 0) throw new Error(`mkdir ${dir} failed: ${r.stderr.trim()}`);
				},
			},
		})),
		defineTool(createEditToolDefinition(cwd, { operations: { readFile, writeFile, access: (p) => testAll(sb, p, ["-r", "-w"]) } })),
		defineTool(createBashToolDefinition(cwd, {
			exposeSessionEnvironment: false,
			operations: {
				exec: async (command, dir, { onData, signal, timeout }) => {
					const seconds = timeout ?? DEFAULT_BASH_TIMEOUT_S;
					const r = await sb.exec(command, {
						cwd: dir,
						timeoutMs: seconds * 1000,
						...(signal ? { signal } : {}),
						...(env ? { env } : {}),
						onOutput: (chunk) => onData(Buffer.from(chunk)),
					});
					if (r.aborted) throw new Error("aborted");
					if (r.timedOut) throw new Error(`timeout:${seconds}`);
					return { exitCode: r.exitCode };
				},
			},
		})),
	];
}

export interface SessionSpec {
	model: Model<Api>;
	thinking: Thinking;
	cwd: string;
	/** With tools: the sandbox they act in. Without: a session with no tools. */
	sandbox?: Sandbox;
	env?: Record<string, string>;
	systemPrompt?: string;
	/** A session directory (file-backed), with an optional session file to reopen; omitted: in memory. */
	storage?: { dir: string; reopen?: string };
	/** Web research behind its guard (the coder outside mock mode); `repos` are the `owner/repo` slugs it never reads. */
	web?: { repos: string[] };
}

export async function openSession(spec: SessionSpec): Promise<AgentSession> {
	const sessionManager = !spec.storage
		? SessionManager.inMemory(spec.cwd)
		: spec.storage.reopen
			? SessionManager.open(spec.storage.reopen, spec.storage.dir, spec.cwd)
			: SessionManager.create(spec.cwd, spec.storage.dir);
	const names = [...(spec.sandbox ? SANDBOX_TOOLS : []), ...(spec.web ? WEB_TOOLS : [])];
	const extensions = spec.web ? await loadWeb(spec.cwd, emptyAgentDir(), spec.web.repos, names) : undefined;
	const options: CreateAgentSessionOptions = {
		cwd: spec.cwd,
		agentDir: emptyAgentDir(),
		modelRuntime: await modelRuntime(),
		model: spec.model,
		thinkingLevel: spec.thinking,
		resourceLoader: isolatedLoader(spec.systemPrompt, extensions),
		sessionManager,
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: true, maxRetries: PI_RETRIES } }),
		...(names.length ? { tools: names, customTools: spec.sandbox ? sandboxTools(spec.sandbox, spec.cwd, spec.env) : [] } : { noTools: "all" }),
	};
	const { session } = await createAgentSession(options);
	return session;
}

