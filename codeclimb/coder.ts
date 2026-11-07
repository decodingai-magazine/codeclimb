// One experiment's coding phase: Pi works in a fresh sandbox (baseline +
// parent commit) until it says done, hits `timeouts.experiment_min` or
// `budget_usd.experiment`, or goes quiet past the idle watchdog (→ abort()). A coder
// that stops with tasks still open in /tmp/tasks.json is sent back once. Then the
// orchestrator commits /repo and pulls the commit back as a bundle, with the coder's
// notes for later rounds, before destroying the sandbox.
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

export type StopReason = "done" | "timeout" | "idle" | "budget" | "agent_error" | "cancelled" | "credits";

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
  /** What the coder left in /tmp/notes.md for later rounds, cut to NOTE_CHARS. */
  notes?: string;
  /** Held-out names the diff's added lines contain (`diffLeaks`). */
  leaks?: string[];
}

/** One coder's notes, at most; the night keeps NIGHT_NOTE_CHARS of them, newest first. */
export const NOTE_CHARS = 3000;
/** No model token or tool event for this long while no tool runs: the session is stuck. */
const IDLE_MS = 10 * 60_000;
/** A tool running this long with no output: stuck too. A bash command defaults to a 10-minute cap. */
const TOOL_STALL_MS = 25 * 60_000;
/** Time a coder sent back to its open tasks needs left. */
const MIN_FOLLOW_UP_MS = 3 * 60_000;

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
  return readdirSync(dir).filter((f) => f.endsWith(".diff")).sort((a, b) => a.localeCompare(b, "en", { numeric: true })).map((f) => `/spec/history/${f}`);
}

/** The night's notes from earlier coders, in the bundle: /spec/history/notes.md in the sandbox. */
export const notesFile = (bundleDir: string) => join(bundleDir, "history", "notes.md");

export const readNotes = (bundleDir: string): string => (existsSync(notesFile(bundleDir)) ? readFileSync(notesFile(bundleDir), "utf8") : "");

/** One task of /tmp/tasks.json. */
export interface Task {
  task: string;
  check?: string;
  status: "todo" | "done" | "dropped";
  note?: string;
}

/** What is wrong with a coder's /tmp/tasks.json when it stops; empty when every task is closed. */
export function openTasks(text: string | null): string {
  if (text === null) return "You wrote no /tmp/tasks.json.";
  let tasks: unknown;
  try {
    tasks = JSON.parse(text);
  } catch {
    return "/tmp/tasks.json is not valid JSON.";
  }
  if (!Array.isArray(tasks)) return "/tmp/tasks.json is not a JSON list of tasks.";
  const open = (tasks as Partial<Task>[]).filter((t) => t.status !== "done" && !(t.status === "dropped" && t.note?.trim()));
  return open.length ? `These tasks in /tmp/tasks.json are not done, or were dropped without a note: ${open.map((t) => JSON.stringify(t.task ?? t)).join("; ")}.` : "";
}

const OBJECTIVE_NAMES: [RegExp, string][] = [[/^latency_/, "speed"], [/^cost_/, "model-call cost"]];

export function coderPrompt(
  spec: string,
  feedback: string,
  hypothesis: string | null,
  minutes: number,
  objectives: { primary: string; metrics: string[]; thresholds?: Record<string, number>; weights?: Record<string, number> } = { primary: "", metrics: [] },
  dev?: { models: string[]; budgetUsd: number; evalBudgetUsd?: number },
  evalMin?: number,
  failures: EvalFailure[] = [],
  history: string[] = [],
  rejectedDiffs: string[] = [],
  repair = false,
  direction = "",
  notes = "",
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
  if (notes.trim()) {
    parts.push(
      `<notes>\nNotes earlier coders of this night left for you, newest first, kept whether or not their round was (/spec/history/notes.md). Trust them less than what you check yourself.\n${notes.trim()}\n</notes>`,
    );
  }
  if (hypothesis) parts.push(`<hypothesis>\nTest this hypothesis in this attempt:\n${hypothesis}\n</hypothesis>`);
  // A repair has one known failure to fix: research and a plan would only spend its time. Both review.
  parts.push(repair ? `Before you stop, review:\n${CODER_REVIEW}` : `${WORKFLOW}\n4. Review. ${CODER_REVIEW}`);
  parts.push(
    [
      "How to work:",
      "- Edit the code in /repo and test it yourself by running it on cases you write. You never get the evaluation data.",
      "- Where the spec leaves an interpretation open, choose one deliberately and say which in APPROACH: the per-family metrics of later rounds tell which reading the evaluation uses.",
      ...(objectives.thresholds && Object.keys(objectives.thresholds).length
        ? [
            "- The round is kept only if its weighted score on the hidden dev split beats the kept commit's by more than the evaluation's noise. " +
              `Each of these metrics counts as its share of its threshold, capped at 1: ${Object.entries(objectives.thresholds).map(([k, v]) => `${k} ${v}${objectives.weights?.[k] ? ` (weight ${objectives.weights[k]})` : ""}`).join(", ")}. ` +
              "A metric past its threshold adds nothing more, and one that falls costs as much as another gains.",
          ]
        : []),
      ...(objectives.metrics.length
        ? [`- The evaluation also measures the program's ${objectives.metrics.map((m) => `${OBJECTIVE_NAMES.find(([re]) => re.test(m))?.[1] ?? m} (${m})`).join(" and ")}, lower is better, for the report: they don't count toward the keep.`]
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
      "- Simpler is better: remove what your change makes unnecessary, and don't add code for a gain too small to measure.",
      "- Before you stop, write to /tmp/notes.md what the next coder should know, kept even if this round is reverted: facts you checked, such as how a library or model endpoint behaves, limits you hit, and what failed and why. At most 20 lines, no plan and no summary of your diff. It stays outside /repo.",
      "- Send a long run's output to a file and read it with grep or tail: everything your shell prints costs tokens.",
      "- Do not commit: the harness commits everything in /repo when you finish.",
      `- You have about ${minutes} minutes: use them. Once the change works, score it on train if you can, read the worst items, the longest and the empty ones first, and fix what you find within this hypothesis. If it shows no clear gain over the code you started from and time and budget remain, try another way to test the hypothesis. Stop when that finds nothing more, and say in APPROACH if the change still shows no gain.`,
      "- End your final message with one line: `APPROACH: <one-sentence summary of what you changed and why>`.",
    ].join("\n"),
  );
  return parts.join("\n\n");
}

export const WORKFLOW = [
  "Work in four steps:",
  "1. Research. First run the program in /repo on two or three train items, or cases you write, so you know it runs and where it stands. " +
    "Then, before you write code, find out what you need to do this attempt well: the parts of the spec it touches, the code in /repo, and outside sources. " +
    "The sandbox has internet access but no browser or curl: fetch pages with python3 (urllib), such as a package's docs, its README on GitHub, PyPI, or a paper on the method. " +
    "Spend at most a fifth of your time here, and stop once you know how you will build it.",
  '2. Plan. Write your plan of attack to /tmp/tasks.json, a JSON list in the order you will do the tasks: one task per change, as {"task": "...", "check": "how you will check it", "status": "todo"}. ' +
    "It stays outside /repo, so it isn't committed.",
  '3. Implement. Work through the tasks in order and test each one. Change only a task\'s status, to "done" once its check passes, or to "dropped" with a "note" saying why; add a task at the end when you find one. ' +
    "Keep going until every task is done or dropped. If time runs short, finish the task at hand so the program still works, drop the rest with a note, and say in APPROACH what is left.",
].join("\n");

/** The last step: the coder checks its own work before the evaluator does. */
export const CODER_REVIEW =
  "When you think you are done, check that the code is ready for the evaluator, which runs it next on data you never see. " +
  "A commit that crashes, overruns its time or writes a row the spec doesn't allow scores nothing, and the round has to be run again. " +
  "Keep the last few minutes for this. " +
  "Read your whole diff (`git diff`) as a reviewer would: bugs, leftover debug code, dead code, paths into /spec, and packages missing from pyproject.toml and uv.lock. " +
  "The evaluator gets only what is in /repo and not ignored by git. " +
  "Then run every stage from start to finish on all of /spec/train if it exists and the model budget allows, else on your own cases, and read the output. " +
  "An item that came back empty is a failure, not a result: when the program catches a failed item and goes on, it must report it on stderr. " +
  "Fix what you find and review again. Stop only when you would hand the code to the evaluator as it is.";

const RESUME_PROMPT =
  "The harness restarted while you were working. /repo still has your changes, /tmp/tasks.json your plan and /tmp/notes.md your notes if you wrote them. Continue the task where you left off; " +
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
  const deadline = state.startedAt + cfg.timeouts.experiment_min * 60_000;
  const remainingMs = deadline - Date.now();
  const timer = setTimeout(() => abortWith("timeout"), Math.max(remainingMs, 0));
  // Model tokens and tool output both count as life; a provider stream that hangs gives neither.
  let lastEventAt = Date.now();
  let toolsRunning = 0;
  const watchdog = setInterval(() => {
    if (Date.now() - lastEventAt > (toolsRunning ? TOOL_STALL_MS : IDLE_MS)) abortWith("idle");
  }, 30_000);
  // t_code survives a killed attempt: persisted with every message, not only at the end.
  const tCodeBefore = state.tCode;
  const t0 = performance.now();
  const unsubscribe = session.subscribe((e) => {
    lastEventAt = Date.now();
    if (e.type === "tool_execution_start") toolsRunning += 1;
    if (e.type === "tool_execution_end") toolsRunning = Math.max(0, toolsRunning - 1);
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
  const readSandbox = (path: string) => sandbox!.readFile(path).then((b) => b.toString("utf8"), () => null);

  try {
    if (remainingMs > 0) {
      const minutes = Math.max(1, Math.round(remainingMs / 60_000));
      await session.prompt(
        resumed
          ? RESUME_PROMPT
          : coderPrompt(readSpecText(paths.bundleDir), input.feedback, input.hypothesis, minutes, {
              primary: cfg.primary_metric,
              metrics: efficiencyMetrics(cfg),
              thresholds: cfg.thresholds,
              weights: cfg.weights,
            }, metered ? { models: cfg.allowed_models, budgetUsd: cfg.budget_usd.dev, evalBudgetUsd: cfg.budget_usd.eval } : undefined, cfg.timeouts.eval_min, input.failures, input.history, rejectedDiffs(paths.bundleDir), input.repair, input.direction, readNotes(paths.bundleDir)),
      );
      // A plan with open tasks is not done: one more turn to finish or drop them. A repair writes no plan.
      const open = input.repair || stop || deadline - Date.now() < MIN_FOLLOW_UP_MS ? "" : openTasks(await readSandbox("/tmp/tasks.json"));
      if (open) {
        await session.prompt(
          `${open} Every task must end "done", or "dropped" with a note saying why. Finish the open ones or drop them, do step 4 (Review) again, and end with the APPROACH line.`,
        );
      }
    } else {
      stop = "timeout";
    }
  } catch (e) {
    agentError = (e as Error).message;
    if (isCreditError(agentError)) outOfCredits({ who: "coder", model: input.model, message: agentError });
  } finally {
    clearTimeout(timer);
    clearInterval(watchdog);
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

  const notes = (await readSandbox("/tmp/notes.md"))?.trim().slice(0, NOTE_CHARS) ?? "";
  const tasks = await readSandbox("/tmp/tasks.json");
  if (tasks !== null) writeFileSync(join(dir, "tasks.json"), tasks);
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
    ...(notes ? { notes } : {}),
  };
}
