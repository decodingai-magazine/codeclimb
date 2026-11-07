// Reviewer LLM: the round's dev metrics, per-item dev errors where the scenario has
// them, the diff and the hypothesis log → keep or revert, feedback, and the next
// hypothesis. It reviews a reverted experiment too: its feedback is how the next
// round, restarting from the checkpoint, avoids that path. Never sees anything from test.
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { isCreditError, OutOfCredits } from "./credits";
import type { ThinkingLevel } from "./config";
import { createIsolatedSession } from "./pi/session";
import { maskTerms } from "./scenario";
import type { Metrics } from "./stats";

export interface BranchSummary {
  /** The coder committed no change: its closing message. */
  unchanged?: string;
  expId: string;
  model: string;
  hypothesis: string;
  decision: string;
  primary: number;
  metrics: Metrics;
  /** Why it can't be kept: headline regressions, a stage gone empty. */
  guardrails: string[];
  /** Why it was never scored: what the next coders read, with held-out names masked. */
  errors?: string[];
  /** The scenario's check of the branch: not failures, but what to weigh. */
  notes: string[];
  diff: string;
  /** The stage reports' per-item errors on dev, when the scenario gives them. */
  details: string;
}

export interface HypothesisLogEntry {
  round: number;
  hypothesis: string;
  deltaPrimary: number;
  /** Change of each headline and optimized standard metric vs the checkpoint's scores. */
  deltas?: Metrics;
  /** The same metrics as they stood, when the checkpoint had no scores to compare with. */
  scores?: Metrics;
  decision: string;
  /** The guardrails it failed, else the reviewer's reason for the round. */
  reason?: string;
}

export interface ReviewInput {
  model: string;
  thinkingLevel: ThinkingLevel;
  mock?: boolean;
  spec: string;
  round: number;
  primaryMetric: string;
  thresholds: Record<string, number>;
  gates: Record<string, number>;
  parentScore: number;
  /** The checkpoint's dev scores from its own evaluation; null while it is the starter. */
  parentMetrics: Metrics | null;
  /** Optimized standard metrics (lower is better); the other standard metrics stay out of the prompt. */
  objectives: string[];
  minEfficiencyGain: number;
  result: BranchSummary;
  log: HypothesisLogEntry[];
  /** The operator's direction for every round of a continued night; empty without one. */
  direction?: string;
  /** Gates and guardrails passed, or `override`: it may be kept. */
  canKeep: boolean;
  /** It failed guardrails by a tiny margin: keeping it needs a reason. */
  override: boolean;
  /** The scenario's headline metrics; when set, these decide the keep and no single metric frames the prompt. */
  headline: string[];
  /** Regexes of the metrics that explain the headlines without deciding the keep. */
  diagnostics: string[];
  /** The scenario's evaluation protocol, how to read its metrics. */
  protocol: string;
  /** The kept commit's source, which the diff applies to. */
  parentSource: string;
}

export interface ReviewOutput {
  /** Keep the experiment as the new checkpoint; false reverts to the current one. */
  keep: boolean;
  keep_reason: string;
  feedback: string;
  hypothesis: string;
  reviewer_usd: number;
  t_review: number;
  tokens: number;
}

const SYSTEM_PROMPT = `You review experiments in an automated research loop. A coding agent changes a program to raise its metrics on hidden evaluation data. The loop is linear: each round starts from the kept commit (the checkpoint) and tests one hypothesis. If the experiment is kept it becomes the new checkpoint. If it is reverted its code is dropped, and the next round restarts from the same checkpoint with your feedback, the log of earlier rounds and read-only diffs of what was rejected.

You receive the program's specification, the checkpoint's source, the experiment's metrics on the dev split (with per-item errors when the scenario provides them), its diff, and the log of earlier hypotheses with their effect. Find why each metric falls short by reading the errors against the code. Write:
1. keep: true to keep the experiment, false to revert it. Weigh every metric, not one number, against the checkpoint's scores. Each run is one sample, so a small change may be noise: read it against the ci95 where one is given. An evaluation repeats an earlier one's model calls from a cache, so the prompt says how many it replayed: a call that was replayed adds no noise, and a small move where most calls replayed comes from the change. Before calling a move noise, check the diff: a change to a shared helper is a change to everything that calls it. A clear gain with the other metrics about level is worth keeping, whichever metric it is. A worse result, or a gain in one metric bought by a loss in another, is reverted. Failed guardrails forbid a keep, unless the prompt offers an override for a tiny regression: take it only for a clear gain elsewhere, and say why the regression is acceptable. A change that fits dev items by name is no gain, and a small gain with a simple diff beats the same gain with a fragile one. Simpler code is a gain in itself: keep a change that removes code or makes it simpler when no metric got worse beyond noise. While the kept commit is the empty starter no comparison exists: judge on the absolute scores, and keep unless the result looks broken or fitted to dev items, since it sets the bar for later rounds. Follow the evaluation protocol if one is given.
2. keep_reason: one or two sentences saying why.
3. feedback: concise guidance for the next round: what worked, what regressed, which metric families are weakest. When you revert, say why this attempt was worse and which path not to take again. Base it on the data; do not invent failures you cannot see. Coders also get a failed evaluation's error, so don't retype it.
4. hypothesis: one concrete, testable change for the next round, in one or two sentences, different from hypotheses that already failed. Coders start from the kept commit, but can read a rejected experiment's diff at /spec/history/r<round>.diff (round 6's is /spec/history/r6.diff), so a hypothesis that reuses rejected work can point at it. Aim it at the headline metric furthest below its threshold; metrics without a threshold come after those. Where the per-item errors start with a summary of error counts, aim at the largest group one change can reach, and don't propose work on a group those counts show is small. When the prompt gives a direction, every hypothesis follows it. After a revert or a round that barely moved its target, stop refining that path: move to the next headline furthest below its threshold, combine the parts of rejected attempts that helped a metric, or try a clearly different approach.

Coders must never see the evaluation data. Coders read keep_reason, feedback and the hypothesis: in all three describe categories of error (which kinds of items fail, and how), and never write a dev entity, document name, query id or query text. Names in a repository check are hints that the experiment's text matches a dev item, which general knowledge can explain, not proof of a leak.

The specification may leave interpretation choices open on purpose (which year a date without one means, which of two dates counts, how loose matching may be). A family stuck at partial accuracy often means the evaluation uses a different reading: test the alternative readings one round at a time, so the metrics tell which one is right.

Reply with only a JSON object: {"keep": true or false, "keep_reason": "...", "feedback": "...", "hypothesis": "..."}`;

const fmtNum = (v: number) => (Number.isInteger(v) ? String(v) : Math.abs(v) < 0.01 ? v.toPrecision(3) : v.toFixed(4));

/** Standard metrics a disabled objective covers are hidden unless a gate names them. */
function shownMetric(k: string, input: Pick<ReviewInput, "objectives" | "gates" | "headline" | "thresholds">): boolean {
  if (k in input.gates || k in input.thresholds || input.headline.includes(k)) return true;
  if (input.headline.length || /(^|\.)output_bytes$/.test(k)) return false;
  if (/^latency_/.test(k)) return input.objectives.some((o) => o.startsWith("latency_"));
  if (/^(cost_|model_calls$)/.test(k)) return input.objectives.some((o) => o.startsWith("cost_"));
  return true;
}

function fmtMetrics(m: Metrics | null, input: Pick<ReviewInput, "objectives" | "gates" | "headline" | "thresholds">): string {
  if (!m) return "(none)";
  return Object.entries(m)
    .filter(([k]) => shownMetric(k, input))
    .map(([k, v]) => `${k}=${fmtNum(v)}`)
    .join(", ");
}

/** The metrics that explain the shown ones, one line under them; none, no line. */
function fmtDiagnostics(m: Metrics | null, input: ReviewInput): string {
  const patterns = input.diagnostics.map((p) => new RegExp(p));
  const shown = Object.entries(m ?? {}).filter(([k]) => !shownMetric(k, input) && patterns.some((p) => p.test(k)));
  return shown.length ? `\nDiagnostics: ${shown.map(([k, v]) => `${k}=${fmtNum(v)}`).join(", ")}` : "";
}

/** The metrics that moved at all; the noise of that round is gone, so read small ones with care. */
function fmtDeltas(d: Metrics | undefined): string[] {
  return Object.entries(d ?? {}).flatMap(([k, v]) => (v ? [`Δ${k}=${v > 0 ? "+" : ""}${fmtNum(v)}`] : []));
}

/** How much of the evaluation repeated earlier calls and how much failed; nothing when neither. */
function fmtCalls(m: Metrics): string {
  const { model_calls: calls, model_calls_replayed: replayed, model_calls_failed: failed } = m;
  return (
    (replayed ? `\nModel calls: ${replayed} of ${calls} were replayed from an earlier evaluation of this night.` : "") +
    (failed ? `\nModel calls: ${failed} of ${calls} failed, so the program ran without those answers.` : "")
  );
}

/** How each metric that decides the keep changed from the checkpoint, with its sampling interval where it has one. */
function fmtChange(m: Metrics, parent: Metrics, input: ReviewInput): string {
  const changed = [...new Set([input.primaryMetric, ...input.headline])].flatMap((k) => {
    if (typeof m[k] !== "number" || typeof parent[k] !== "number" || m[k] === parent[k]) return [];
    const d = m[k] - parent[k];
    const ci = parent[k.replace(/\.mean$/, ".ci95_half")];
    return [`${k} ${d > 0 ? "+" : ""}${fmtNum(d)}${k.endsWith(".mean") && typeof ci === "number" ? ` (ci95 ±${fmtNum(ci)})` : ""}`];
  });
  return changed.length ? changed.join(", ") : "none";
}

/** One round of the log: what was tried, what moved and why it went. `primary` names the score; null with headline metrics. */
export function logLine(l: HypothesisLogEntry, primary: string | null): string {
  const scores = Object.entries(l.scores ?? {}).map(([k, v]) => `${k}=${fmtNum(v)}`);
  const moved = [...(primary ? [`Δ${primary}=${l.deltaPrimary.toFixed(4)}`] : []), ...fmtDeltas(l.deltas), ...scores];
  // An error's tail names the failure; its head is the command, and coders get it whole.
  const reason = l.decision === "error" ? l.reason?.slice(-300) : l.reason;
  return `- r${l.round}: ${l.hypothesis} → ${moved.join(", ") || (l.scores ? "not scored" : "no metric moved")} (${l.decision}${reason ? `: ${reason}` : ""})`;
}

export function reviewerPrompt(input: ReviewInput): string {
  const headlined = input.headline.length > 0;
  // With headline metrics no one metric frames the round: the primary only names the score in charts.
  const goal = headlined ? "the headline metrics" : input.primaryMetric;
  const score = (v: number) => (headlined ? "" : `${input.primaryMetric}=${v.toFixed(4)}; `);
  const lines = [
    `<spec>\n${input.spec}\n</spec>`,
    ...(input.protocol ? [`<protocol>\n${input.protocol}\n</protocol>`] : []),
    `Round ${input.round} finished. ${headlined ? `The headline metrics count equally: ${input.headline.join(", ")}.` : `Primary metric: ${input.primaryMetric}.`} Thresholds: ${JSON.stringify(input.thresholds)}. Gates (caps): ${JSON.stringify(input.gates)}.`,
  ];
  if (input.direction) lines.push(`The person running this loop set this direction for every round:\n${input.direction}`);
  if (input.diagnostics.length) lines.push("Diagnostics explain the metrics, by what a run returned and what the simplest baseline scores. They are never a gain by themselves.");
  if (input.objectives.length) {
    lines.push(
      `Also optimized, lower is better: ${input.objectives.join(", ")}. ` +
        `An experiment that keeps ${goal} and cuts one of these by more than ${Math.round(input.minEfficiencyGain * 100)}% is worth keeping. ` +
        `Correctness comes first: propose efficiency hypotheses when ${goal} stalled or alongside accuracy ones.`,
    );
  }
  lines.push(
    input.parentMetrics
      ? `Kept commit (the checkpoint), scores from its own evaluation: ${score(input.parentScore)}metrics: ${fmtMetrics(input.parentMetrics, input)}${fmtDiagnostics(input.parentMetrics, input)}`
      : "The kept commit is the empty starter and wasn't run: read the experiment's scores as they stand. The first experiment kept sets the bar for later rounds.",
  );
  if (input.parentSource) lines.push(`## Kept commit source\nThe diff applies to this.\n${input.parentSource}`);
  const b = input.result;
  lines.push(
    `## Experiment ${b.expId} (${b.model})\nHypothesis: ${b.hypothesis}\n${score(b.primary)}metrics: ${fmtMetrics(b.metrics, input)}` +
      fmtDiagnostics(b.metrics, input) +
      fmtCalls(b.metrics) +
      (input.parentMetrics ? `\nChange from the kept commit: ${fmtChange(b.metrics, input.parentMetrics, input)}` : "") +
      (b.unchanged === undefined ? "" : `\nThe coder committed no change, so nothing was evaluated: these are the checkpoint's scores, and the hypothesis above was not tested in this commit. Judge no result from them. What it reported:\n${b.unchanged}`) +
      (b.guardrails.length ? `\nFailed guardrails${input.override ? " by a tiny margin" : ", can't be kept"}: ${b.guardrails.join("; ")}` : "") +
      (b.notes.length ? `\nRepository check: ${b.notes.join("; ")}` : "") +
      (b.details ? `\nPer-item errors on dev (may be cut off):\n${b.details}` : "") +
      `\nDiff vs the kept commit:\n\`\`\`diff\n${b.diff}\n\`\`\``,
  );
  if (input.log.length) {
    lines.push(
      "## Hypothesis log (all rounds)\nEach Δ is against the checkpoint of that round; plain values had no scores to compare with. Coders start from the kept commit; a rejected experiment survives only as a read-only diff at /spec/history/r<round>.diff, so r6 here is /spec/history/r6.diff.\n" +
        input.log.map((l) => logLine(l, headlined ? null : input.primaryMetric)).join("\n"),
    );
  }
  lines.push(
    input.canKeep
      ? input.override
        ? "You may keep it only as an override: for a clear gain elsewhere, with keep_reason saying why the regression is acceptable."
        : "You may keep it."
      : "It can't be kept: keep must be false. Explain why it is worse so the next round avoids that path.",
  );
  lines.push("Return JSON with keep, keep_reason, feedback and hypothesis.");
  return lines.join("\n\n");
}

export function parseReview(text: string, canKeep: boolean, override = false): Pick<ReviewOutput, "keep" | "keep_reason" | "feedback" | "hypothesis"> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as { keep?: unknown; keep_reason?: unknown; feedback?: unknown; hypothesis?: unknown };
    if (typeof obj.keep !== "boolean" || typeof obj.feedback !== "string" || typeof obj.hypothesis !== "string" || !obj.hypothesis.trim()) return null;
    if (obj.keep && !canKeep) return null;
    const reason = typeof obj.keep_reason === "string" ? obj.keep_reason.trim() : "";
    if (obj.keep && override && !reason) return null; // an override states why
    return { keep: obj.keep, keep_reason: reason, feedback: obj.feedback.trim(), hypothesis: obj.hypothesis.trim() };
  } catch {
    return null;
  }
}

/**
 * `scan` returns the held-out names in a text. All but `keep` goes to coders, so the reviewer gets
 * one rewrite of any it wrote, and what survives that is masked.
 */
export async function runReview(input: ReviewInput, scan: (text: string) => Promise<string[]> = async () => []): Promise<ReviewOutput> {
  const t0 = performance.now();
  const session = await createIsolatedSession({
    model: input.model,
    mock: input.mock ? "reviewer" : undefined,
    sessionManager: SessionManager.inMemory("/repo"),
    systemPrompt: SYSTEM_PROMPT,
    thinkingLevel: input.thinkingLevel,
  });
  let usd = 0;
  let tokens = 0;
  let creditError: string | undefined;
  session.subscribe((e) => {
    if (e.type === "message_end" && e.message.role === "assistant") {
      usd += e.message.usage.cost.total;
      tokens += e.message.usage.totalTokens;
      const error = e.message.errorMessage;
      if (e.message.stopReason === "error" && error && isCreditError(error)) creditError = error;
    }
  });
  const outOfCredits = () => {
    if (creditError) throw new OutOfCredits({ who: "reviewer", model: input.model, message: creditError });
  };
  try {
    await session.prompt(reviewerPrompt(input));
    outOfCredits();
    const parse = () => parseReview(session.getLastAssistantText() ?? "", input.canKeep, input.override);
    let parsed = parse();
    if (!parsed) {
      await session.prompt(`Reply again with only the JSON object, with a hypothesis: keep must be ${input.canKeep ? "true or false" : "false"}${input.override ? ", and keeping needs a keep_reason" : ""}.`);
      outOfCredits();
      parsed = parse();
    }
    if (!parsed) throw new Error("reviewer returned no parsable JSON twice");
    const forCoders = (r: Pick<ReviewOutput, "keep_reason" | "feedback" | "hypothesis">) => `${r.keep_reason}\n${r.feedback}\n${r.hypothesis}`;
    let found = await scan(forCoders(parsed));
    if (found.length) {
      await session.prompt(`Your keep_reason, feedback or hypothesis names evaluation items coders may not see: ${found.join(", ")}. Reply again with the same JSON, describing the error categories without them.`);
      outOfCredits();
      parsed = parse() ?? parsed;
      found = await scan(forCoders(parsed));
    }
    const masked = { ...parsed, keep_reason: maskTerms(parsed.keep_reason, found), feedback: maskTerms(parsed.feedback, found), hypothesis: maskTerms(parsed.hypothesis, found) };
    return { ...masked, reviewer_usd: usd, tokens, t_review: Math.round((performance.now() - t0) / 10) / 100 };
  } finally {
    session.dispose();
  }
}
