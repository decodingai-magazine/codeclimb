// One experiment's coding phase: Pi works in a fresh sandbox (baseline +
// parent commit) until it says done, hits `timeouts.experiment_min` or
// `budget_usd.experiment` (→ abort()). Then the orchestrator commits /repo and
// pulls the commit back as a bundle before destroying the sandbox.
//
// With `allowed_models`, the coder's runs of the program may call those models
// as they will during evaluation: the sandbox joins the metering network and
// the shell gets a token for this experiment's own ledger, capped at
// `budget_usd.dev`. That spend is `dev_usd`, never the program's cost metrics.
//
// Crash mid-prompt: the retried step reopens the session JSONL and continues
// on the same sandbox if it is alive; a dead sandbox gets one fresh restart
// from the parent commit, then the experiment is an infra error.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { registerLive } from "./aborts";
import { efficiencyMetrics, type NightConfig } from "./config";
import { type CreditStop, isCreditError } from "./credits";
import { ExperimentRepo, expRef } from "./git";
import { isMetered, METER_NETWORK, meter, meterBaseUrl, meterEnv } from "./meter";
import { nightPaths, sandboxName } from "./paths";
import { createIsolatedSession, sessionManagerFor } from "./pi/session";
import { sandboxTools } from "./pi/tools";
import { sandboxBackend } from "./sandbox";
import { commitAndExport } from "./sandbox/repo";
import type { Sandbox } from "./sandbox/types";
import { traceSession } from "./tracing";
import type { RepoCheck } from "./scenario";

export type EvalFailure = { expId: string; errors: string[] };

export type ExperimentInput = {
  nightId: string;
  expId: string;
  parentExpId: string;
  round: number;
  model: string;
  /** Reviewer feedback from earlier rounds; empty in round 1. */
  feedback: string;
  /** The last round's experiment if it was never scored, with its errors, held-out names masked. */
  failures?: EvalFailure[];
  /** This attempt fixes the failed commit it starts from (`parentExpId`), named in `failures`. */
  repair?: boolean;
  /** One line per earlier round, held-out names masked: what was tried, what moved, why it went. */
  history?: string[];
  /** The operator's direction for every round of a continued night, held-out names masked. */
  direction?: string;
  /** Reviewer's hypothesis for this experiment; null in round 1 (the agent picks and reports its own). */
  hypothesis: string | null;
  config: NightConfig;
  /** Go on after a pause for credits from the commit `expId` holds, in the same Pi session. */
  resume?: boolean;
};

export type StopReason = "done" | "timeout" | "budget" | "agent_error" | "cancelled" | "credits";

export interface CodeResult {
  ok: boolean;
  error?: string;
  sha: string | null;
  hypothesis: string;
  stop: StopReason;
  coder_usd: number;
  /** The program's model calls during development (metered); 0 without `allowed_models`. */
  dev_usd: number;
  tokens: number;
  t_provision: number;
  t_code: number;
  t_teardown: number;
  infra_errors: number;
  resumed: boolean;
  /** The scenario's `check` of the commit; with errors the branch is not evaluated. */
  check?: RepoCheck;
  /** The commit's files equal its parent's: the coder's closing message, why. Nothing to evaluate. */
  unchanged?: string;
  /** The models ran out of credits: `sha` is the work so far, for `resume` to go on from. */
  credits?: CreditStop;
}

interface CodeState {
  startedAt: number;
  sandbox: string;
  freshRestarts: number;
  infraErrors: number;
  coderUsd: number;
  /** Absent in state files written before dev metering. */
  devUsd?: number;
  tokens: number;
  tCode: number;
  tProvision: number;
  /** Set when Pi stops (the app's live view: coding vs waiting for the evaluator). */
  finishedAt?: number;
  stop?: StopReason;
}

const secs = (ms: number) => Math.round(ms / 10) / 100;

/** The agent's spec: every markdown file in the bundle's `spec/`, the task (SPEC.md or task.md) first. */
export function readSpecText(bundleDir: string): string {
  const dir = join(bundleDir, "spec");
  const first = (f: string) => Number(f === "SPEC.md" || f === "task.md");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort((a, b) => first(b) - first(a) || a.localeCompare(b))
    .map((f) => readFileSync(join(dir, f), "utf8").trim())
    .join("\n\n---\n\n");
}

/** The rejected diffs in the bundle, oldest first, as the sandbox sees them. */
export function rejectedDiffs(bundleDir: string): string[] {
  const dir = join(bundleDir, "history");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort((a, b) => a.localeCompare(b, "en", { numeric: true })).map((f) => `/spec/history/${f}`);
}

const OBJECTIVE_NAMES: [RegExp, string][] = [[/^latency_/, "speed"], [/^cost_/, "model-call cost"]];

export function coderPrompt(
  spec: string,
  feedback: string,
  hypothesis: string | null,
  minutes: number,
  objectives: { primary: string; metrics: string[] } = { primary: "", metrics: [] },
  dev?: { models: string[]; budgetUsd: number; evalBudgetUsd?: number },
  evalMin?: number,
  failures: EvalFailure[] = [],
  history: string[] = [],
  rejectedDiffs: string[] = [],
  repair = false,
  direction = "",
): string {
  const parts = [
    "You are improving the program in /repo (a git checkout). Its specification follows; a copy is in /spec/spec. " +
      "If /spec/train exists, it holds the train items with their answers: the only labeled data you may read, and the only source for few-shot examples.",
    `<spec>\n${spec}\n</spec>`,
  ];
  if (direction) parts.push(`<direction>\nThe person running this loop set this direction for every round. Follow it:\n${direction}\n</direction>`);
  if (feedback.trim()) parts.push(`<feedback>\nReviewer feedback on earlier attempts:\n${feedback.trim()}\n</feedback>`);
  if (failures.length) {
    const intro = repair
      ? "Your last attempt, now in /repo, failed before it was scored. Fix this failure and nothing else, then test the fix: there is no second repair."
      : "The last attempt failed before it was scored. Its code is gone, but your code can fail the same way.";
    parts.push(`<failures>\n${intro} The errors:\n${failures.map((f) => `- ${f.expId}: ${f.errors.join("\n")}`).join("\n")}\n</failures>`);
  }
  if (history.length) {
    const diffs = rejectedDiffs.length
      ? `\nThe diffs of the rejected attempts, each against its own parent and possibly cut off, are read-only history: ${rejectedDiffs.join(", ")}. Read one only when you want to reuse or avoid that work: reading costs tokens.`
      : "";
    parts.push(`<history>\nEvery earlier round. Don't repeat what failed. Each Δ is against the kept commit of that round; only kept rounds are in your /repo.\n${history.join("\n")}${diffs}\n</history>`);
  }
  if (hypothesis) parts.push(`<hypothesis>\nTest this hypothesis in this attempt:\n${hypothesis}\n</hypothesis>`);
  parts.push(
    [
      "How to work:",
      "- Edit the code in /repo and test it yourself by running it on cases you write. You never get the evaluation data.",
      "- Where the spec leaves an interpretation open, choose one deliberately and say which in APPROACH: the per-family metrics of later rounds tell which reading the evaluation uses.",
      ...(objectives.metrics.length
        ? [
            `- The evaluation also measures the program's ${objectives.metrics.map((m) => `${OBJECTIVE_NAMES.find(([re]) => re.test(m))?.[1] ?? m} (${m})`).join(" and ")}, lower is better. ` +
              `Correctness comes first; a change that keeps ${objectives.primary} and makes the program clearly faster or cheaper also counts.`,
          ]
        : []),
      ...(dev
        ? [
            "- The program can call a model while you develop, as it will during the evaluation: your shell has OPENAI_BASE_URL and " +
              `OPENAI_API_KEY for an OpenAI-compatible endpoint ($OPENAI_BASE_URL/chat/completions). Models: ${dev.models.join(", ")}. ` +
              `Every call costs money: you have $${dev.budgetUsd} for them in total, and the endpoint answers 402 once it is spent. ` +
              (dev.evalBudgetUsd === undefined ? "" : `The evaluation has its own cap of $${dev.evalBudgetUsd} for one run of every stage. `) +
              "A call repeated more than 30 seconds later gets the same answer for free, so a rerun differs only where your change reached. " +
              "Start with a few cases you write; call models only through this endpoint.",
          ]
        : []),
      ...(evalMin
        ? [`- The evaluation gives each run of the program ${evalMin} minutes, and one that runs longer scores nothing. Time it on a sample and run slow work, such as model calls, concurrently.`]
        : []),
      "- The evaluation's inputs can be much longer than the ones you test on: leave room in token limits and timeouts.",
      "- The sandbox has internet access and uv. For a package the image lacks, run `uv venv --system-site-packages` and `uv add <package>` in /repo (`uv init --bare` first if there is no pyproject.toml), and commit pyproject.toml and uv.lock: the evaluation builds that environment from uv.lock. Run the program with .venv/bin/python.",
      "- Before you stop, run every stage from start to finish on all of /spec/train if it exists and the model budget allows, else on your own cases, and read the output. An item that came back empty is a failure, not a result: when the program catches a failed item and goes on, it must report it on stderr. Fix what you find.",
      "- Simpler is better: remove what your change makes unnecessary, and don't add code for a gain too small to measure.",
      "- Send a long run's output to a file and read it with grep or tail: everything your shell prints costs tokens.",
      "- Do not commit: the harness commits everything in /repo when you finish.",
      `- You have about ${minutes} minutes: use them. Once the change works, score it on train if you can, read the worst items, the longest and the empty ones first, and fix what you find within this hypothesis. If it shows no clear gain over the code you started from and time and budget remain, try another way to test the hypothesis. Stop when that finds nothing more, and say in APPROACH if the change still shows no gain.`,
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
  if (state && input.resume) {
    // After a pause: the sandbox is gone, and its work is the commit made when the credits ran out.
    sandbox = await backend.find(name);
    sessionFile = latestSessionFile(sessionDir);
    resumed = sessionFile !== undefined;
    if (ctx.attempt === 0) {
      state.startedAt = Date.now() - state.tCode * 1000; // the pause doesn't count against experiment_min
      state.finishedAt = undefined;
      state.stop = undefined;
    }
  } else if (state && ctx.attempt > 0) {
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
          stop: "agent_error", coder_usd: state.coderUsd, dev_usd: state.devUsd ?? 0, tokens: state.tokens, t_provision: state.tProvision,
          t_code: state.tCode, t_teardown: 0, infra_errors: state.infraErrors, resumed: false,
        };
      }
      state.freshRestarts += 1;
      state.startedAt = Date.now();
      sessionFile = undefined;
      sandbox = null;
    }
  }
  state ??= { startedAt: Date.now(), sandbox: name, freshRestarts: 0, infraErrors: 0, coderUsd: 0, devUsd: 0, tokens: 0, tCode: 0, tProvision: 0 };
  state.devUsd ??= 0;
  save();

  // Every attempt makes sure of the relay (the worker's proxy port may have changed) and opens its own token.
  const metered = isMetered(cfg);
  const proxy = metered ? await meter() : null;
  const meterUrl = proxy ? await meterBaseUrl(cfg) : "";

  if (!sandbox) {
    const t0 = performance.now();
    sandbox = await backend.create({
      name,
      baseline: cfg.scenario.image,
      inngestImage: cfg.scenario.inngest_image,
      // Both refs: the clone is the work so far, and `commitAndExport` still squashes onto the parent.
      commit: input.resume ? await repo.bundle(input.expId, input.parentExpId) : await repo.bundle(input.parentExpId),
      specDir: paths.bundleDir,
      labels: { "cc.night": input.nightId, "cc.run": ctx.runId },
      network: metered ? METER_NETWORK : "bridge",
    });
    state.tProvision += secs(performance.now() - t0);
    save();
  }

  const devBefore = state.devUsd;
  let credits: CreditStop | undefined;
  const outOfCredits = (stop: CreditStop) => {
    credits ??= stop;
    abortWith("credits");
  };
  const token = proxy?.open({
    evalId: `${input.expId}-dev`, allowedModels: cfg.allowed_models, capUsd: Math.max(cfg.budget_usd.dev - devBefore, 0),
    attrs: { "codeclimb.exp_id": input.expId, "codeclimb.ledger": "dev" },
    mock: cfg.mock,
    onCreditStop: outOfCredits,
    replayScope: input.nightId,
    repeatRuns: true,
  });
  const closeDev = () => {
    if (!token) return;
    const calls = proxy!.close(token);
    state!.devUsd = devBefore + calls.reduce((a, c) => a + c.cost_usd, 0);
    if (calls.length) appendFileSync(join(dir, "meter-dev.jsonl"), calls.map((c) => JSON.stringify(c)).join("\n") + "\n");
    save();
  };

  const session: AgentSession = await createIsolatedSession({
    model: input.model,
    mock: cfg.mock ? "coder" : undefined,
    thinkingLevel: cfg.coder_thinking,
    tools: sandboxTools(sandbox, token ? { env: meterEnv(token, meterUrl) } : {}),
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
      if (e.message.stopReason === "error" && isCreditError(e.message.errorMessage ?? "")) {
        outOfCredits({ who: "coder", model: input.model, message: e.message.errorMessage ?? "" });
      }
      state!.coderUsd += e.message.usage.cost.total;
      state!.tokens += e.message.usage.totalTokens;
      state!.tCode = tCodeBefore + secs(performance.now() - t0);
      if (token) state!.devUsd = devBefore + proxy!.spent(token);
      save();
      if (state!.coderUsd + state!.devUsd! >= cfg.budget_usd.experiment) abortWith("budget");
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
        resumed
          ? RESUME_PROMPT
          : coderPrompt(readSpecText(paths.bundleDir), input.feedback, input.hypothesis, minutes, {
              primary: cfg.primary_metric,
              metrics: efficiencyMetrics(cfg),
            }, metered ? { models: cfg.allowed_models, budgetUsd: cfg.budget_usd.dev, evalBudgetUsd: cfg.budget_usd.eval } : undefined, cfg.timeouts.eval_min, input.failures, input.history, rejectedDiffs(paths.bundleDir), input.repair, input.direction),
      );
    } else {
      stop = "timeout";
    }
  } catch (e) {
    agentError = (e as Error).message;
    if (isCreditError(agentError)) outOfCredits({ who: "coder", model: input.model, message: agentError });
  } finally {
    clearTimeout(timer);
    closeDev();
    unsubscribe();
    untrace();
    unregister();
    state.tCode = tCodeBefore + secs(performance.now() - t0);
    save();
  }
  stop ??= agentError ? "agent_error" : "done";
  state.finishedAt = Date.now();
  state.stop = stop;
  save();

  const closing = session.getLastAssistantText() ?? "";
  const hypothesis = input.hypothesis || parseApproach(closing);
  session.dispose();

  if (stop === "cancelled") {
    await sandbox.destroy();
    throw new Error("experiment cancelled");
  }

  const exported = await commitAndExport(sandbox, expRef(input.parentExpId), `${input.expId}: ${hypothesis}\n`);
  const sha = await repo.importBundle(exported.bundle, input.expId);
  const unchanged = (await repo.sameTree(input.parentExpId, input.expId)) ? { unchanged: closing.trim().slice(0, 1000) || "(no closing message)" } : {};
  const tt = performance.now();
  await sandbox.destroy();
  const t_teardown = secs(performance.now() - tt);

  return {
    ok: true,
    error: agentError,
    sha,
    hypothesis,
    ...unchanged,
    stop,
    coder_usd: state.coderUsd,
    dev_usd: state.devUsd,
    tokens: state.tokens,
    t_provision: state.tProvision,
    t_code: state.tCode,
    t_teardown,
    infra_errors: state.infraErrors,
    resumed,
    ...(credits ? { credits } : {}),
  };
}
