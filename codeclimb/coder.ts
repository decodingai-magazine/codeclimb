// One experiment's coding phase: Pi works in a fresh sandbox (baseline +
// parent commit) until it says done, hits `timeouts.experiment_min` or
// `budget_usd.experiment` (→ abort()). Then the orchestrator commits /repo and
// pulls the commit back as a bundle before destroying the sandbox.
//
// Crash mid-prompt: the retried step reopens the session JSONL and continues
// on the same sandbox if it is alive; a dead sandbox gets one fresh restart
// from the parent commit, then the experiment is an infra error.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { registerLive } from "./aborts";
import type { NightConfig } from "./config";
import { ExperimentRepo, expRef } from "./git";
import { nightPaths, sandboxName } from "./paths";
import { createIsolatedSession, sessionManagerFor } from "./pi/session";
import { sandboxTools } from "./pi/tools";
import { sandboxBackend } from "./sandbox";
import { commitAndExport } from "./sandbox/repo";
import type { Sandbox } from "./sandbox/types";
import { traceSession } from "./tracing";

export type ExperimentInput = {
  nightId: string;
  expId: string;
  parentExpId: string;
  round: number;
  branch: number;
  model: string;
  /** Reviewer feedback (and validation gap) from earlier rounds; empty in round 1. */
  feedback: string;
  /** Reviewer's hypothesis for this branch; null in round 1 (the agent picks and reports its own). */
  hypothesis: string | null;
  config: NightConfig;
};

export type StopReason = "done" | "timeout" | "budget" | "agent_error" | "cancelled";

export interface CodeResult {
  ok: boolean;
  error?: string;
  sha: string | null;
  hypothesis: string;
  stop: StopReason;
  coder_usd: number;
  tokens: number;
  t_provision: number;
  t_code: number;
  t_teardown: number;
  infra_errors: number;
  resumed: boolean;
}

interface CodeState {
  startedAt: number;
  sandbox: string;
  freshRestarts: number;
  infraErrors: number;
  coderUsd: number;
  tokens: number;
  tCode: number;
  tProvision: number;
}

const secs = (ms: number) => Math.round(ms / 10) / 100;

export function readSpecText(specDir: string): string {
  return readdirSync(specDir)
    .filter((f) => f.endsWith(".md"))
    // The implementation spec first, then the rest (metric definitions, ...).
    .sort((a, b) => Number(b === "SPEC.md") - Number(a === "SPEC.md") || a.localeCompare(b))
    .map((f) => readFileSync(join(specDir, f), "utf8").trim())
    .join("\n\n---\n\n");
}

export function coderPrompt(spec: string, feedback: string, hypothesis: string | null, minutes: number): string {
  const parts = [
    "You are improving the program in /repo (a git checkout). Its specification follows; a copy is in /spec.",
    `<spec>\n${spec}\n</spec>`,
  ];
  if (feedback.trim()) parts.push(`<feedback>\nReviewer feedback on earlier attempts (aggregate metrics only):\n${feedback.trim()}\n</feedback>`);
  if (hypothesis) parts.push(`<hypothesis>\nTest this hypothesis in this attempt:\n${hypothesis}\n</hypothesis>`);
  parts.push(
    [
      "How to work:",
      "- Edit the code in /repo and test it yourself by running it on cases you write. You never get the evaluation data.",
      "- Where the spec leaves an interpretation open, choose one deliberately and say which in APPROACH: the per-family metrics of later rounds tell which reading the evaluation uses.",
      "- Do not commit: the harness commits everything in /repo when you finish.",
      `- You have about ${minutes} minutes. Stop when the change is implemented and tested.`,
      "- End your final message with one line: `APPROACH: <one-sentence summary of what you changed and why>`.",
    ].join("\n"),
  );
  return parts.join("\n\n");
}

const RESUME_PROMPT =
  "The harness restarted while you were working. /repo still has your changes. Continue the task where you left off; " +
  "when done, end with one line: `APPROACH: <one-sentence summary>`.";

export function parseApproach(text: string): string {
  const matches = [...text.matchAll(/^\s*\**APPROACH(?::\**|\**:)\s*(.+)$/gim)];
  const line = matches.length ? matches[matches.length - 1][1] : text.trim().split("\n").filter(Boolean).pop() ?? "";
  return line.replace(/[`*]/g, "").trim().slice(0, 300) || "(no summary)";
}

function latestSessionFile(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
  return files.length ? join(dir, files[files.length - 1]) : undefined;
}

export async function runCoder(
  input: ExperimentInput,
  ctx: { attempt: number; runId: string },
): Promise<CodeResult> {
  const cfg = input.config;
  const paths = nightPaths(cfg, input.nightId);
  const dir = paths.expDir(input.expId);
  const sessionDir = join(dir, "session");
  const stateFile = join(dir, "code-state.json");
  mkdirSync(sessionDir, { recursive: true });
  const repo = new ExperimentRepo(paths.gitDir);
  const backend = sandboxBackend(cfg.sandbox);
  const name = sandboxName(input.expId);

  let state: CodeState | undefined = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : undefined;
  const save = () => writeFileSync(stateFile, JSON.stringify(state));

  let sandbox: Sandbox | null = null;
  let sessionFile: string | undefined;
  let resumed = false;
  if (state && ctx.attempt > 0) {
    sandbox = await backend.find(name);
    sessionFile = latestSessionFile(sessionDir);
    if (sandbox && sessionFile) {
      resumed = true;
    } else {
      // The sandbox died with the attempt: one fresh restart from the parent commit, then give up.
      state.infraErrors += 1;
      if (state.freshRestarts >= 1) {
        save();
        return {
          ok: false, error: "sandbox lost twice", sha: null, hypothesis: input.hypothesis || "(no summary)",
          stop: "agent_error", coder_usd: state.coderUsd, tokens: state.tokens, t_provision: state.tProvision,
          t_code: state.tCode, t_teardown: 0, infra_errors: state.infraErrors, resumed: false,
        };
      }
      state.freshRestarts += 1;
      state.startedAt = Date.now();
      sessionFile = undefined;
      sandbox = null;
    }
  }
  state ??= { startedAt: Date.now(), sandbox: name, freshRestarts: 0, infraErrors: 0, coderUsd: 0, tokens: 0, tCode: 0, tProvision: 0 };
  save();

  if (!sandbox) {
    const t0 = performance.now();
    sandbox = await backend.create({
      name,
      baseline: cfg.baseline,
      commit: await repo.bundle(input.parentExpId),
      labels: { "cc.night": input.nightId, "cc.run": ctx.runId },
    });
    state.tProvision += secs(performance.now() - t0);
    save();
  }

  const session: AgentSession = await createIsolatedSession({
    model: input.model,
    tools: sandboxTools(sandbox),
    sessionManager: sessionManagerFor(sessionDir, resumed ? sessionFile : undefined),
  });

  let stop: StopReason | undefined;
  let agentError: string | undefined;
  const abortWith = (reason: StopReason) => {
    stop ??= reason;
    void session.abort();
  };
  const remainingMs = cfg.timeouts.experiment_min * 60_000 - (Date.now() - state.startedAt);
  const timer = setTimeout(() => abortWith("timeout"), Math.max(remainingMs, 0));
  // t_code survives a killed attempt: persisted with every message, not only at the end.
  const tCodeBefore = state.tCode;
  const t0 = performance.now();
  const unsubscribe = session.subscribe((e) => {
    if (e.type === "message_end" && e.message.role === "assistant") {
      state!.coderUsd += e.message.usage.cost.total;
      state!.tokens += e.message.usage.totalTokens;
      state!.tCode = tCodeBefore + secs(performance.now() - t0);
      save();
      if (state!.coderUsd >= cfg.budget_usd.experiment) abortWith("budget");
    }
  });
  const untrace = traceSession(session, {
    "codeclimb.exp_id": input.expId,
    "codeclimb.model": input.model,
    "codeclimb.round": String(input.round),
  });
  const unregister = registerLive(ctx.runId, input.nightId, async () => abortWith("cancelled"));

  try {
    if (remainingMs > 0) {
      const minutes = Math.max(1, Math.round(remainingMs / 60_000));
      await session.prompt(
        resumed ? RESUME_PROMPT : coderPrompt(readSpecText(cfg.spec_dir), input.feedback, input.hypothesis, minutes),
      );
    } else {
      stop = "timeout";
    }
  } catch (e) {
    agentError = (e as Error).message;
  } finally {
    clearTimeout(timer);
    unsubscribe();
    untrace();
    unregister();
    state.tCode = tCodeBefore + secs(performance.now() - t0);
    save();
  }
  stop ??= agentError ? "agent_error" : "done";

  const hypothesis = input.hypothesis || parseApproach(session.getLastAssistantText() ?? "");
  session.dispose();

  if (stop === "cancelled") {
    await sandbox.destroy();
    throw new Error("experiment cancelled");
  }

  const exported = await commitAndExport(sandbox, expRef(input.parentExpId), `${input.expId}: ${hypothesis}\n`);
  const sha = await repo.importBundle(exported.bundle, input.expId);
  const tt = performance.now();
  await sandbox.destroy();
  const t_teardown = secs(performance.now() - tt);

  return {
    ok: true,
    error: agentError,
    sha,
    hypothesis,
    stop,
    coder_usd: state.coderUsd,
    tokens: state.tokens,
    t_provision: state.tProvision,
    t_code: state.tCode,
    t_teardown,
    infra_errors: state.infraErrors,
    resumed,
  };
}
