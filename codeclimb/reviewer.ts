// Reviewer LLM: the round's dev metrics, per-item dev errors where the scenario has
// them, the diff, the coder's notes, the loop's keep or revert and the hypothesis log →
// feedback, the next hypothesis and a verdict for the experiment's note. The weighted score decides the keep, not the reviewer. It reviews a
// reverted experiment too: its feedback is how the next round, restarting from the
// checkpoint, avoids that path. Never sees anything from test.
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
  /** What blocked a keep whatever the score: a failed gate, a stage gone empty, held-out names in the diff. */
  guardrails: string[];
  /** Why it was never scored: what the next coders read, with held-out names masked. */
  errors?: string[];
  /** The scenario's check of the branch: not failures, but what to weigh. */
  notes: string[];
  diff: string;
  /** The stage reports' per-item errors on dev, when the scenario gives them. */
  details: string;
  /** Its weighted score, the checkpoint's, and the noise margin it had to beat that by. */
  score: number;
  parentScore: number;
  margin: number;
  /** Why the loop kept or reverted it. */
  reason: string;
}

export interface HypothesisLogEntry {
  round: number;
  hypothesis: string;
  deltaPrimary: number;
  /** Change of the weighted score vs the checkpoint's; absent for rounds that weren't scored. */
  deltaScore?: number;
  /** Change of each headline and optimized standard metric vs the checkpoint's scores. */
  deltas?: Metrics;
  /** The same metrics as they stood, when the checkpoint had no scores to compare with. */
  scores?: Metrics;
  decision: string;
  /** Why it was kept or reverted. */
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
  weights: Record<string, number>;
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
  /** The scenario's headline metrics; when set, no single metric frames the prompt. */
  headline: string[];
  /** Regexes of the metrics that explain the headlines. */
  diagnostics: string[];
  /** The scenario's evaluation protocol, how to read its metrics. */
  protocol: string;
  /** The kept commit's source, which the diff applies to. */
  parentSource: string;
  /** What the coder wrote in /tmp/notes.md, before the evaluation; empty when it wrote nothing. */
  coderNotes?: string;
}

export interface ReviewOutput {
  feedback: string;
  hypothesis: string;
  /** The experiment's outcome for its note in the night's history, which every later coder reads. */
  verdict: string;
  reviewer_usd: number;
  t_review: number;
  tokens: number;
}

const SYSTEM_PROMPT = `You review experiments in an automated research loop. A coding agent changes a program to raise its metrics on hidden evaluation data. The loop is linear: each round starts from the kept commit (the checkpoint) and tests one hypothesis, which should raise every threshold metric still short of its threshold, since each round costs a full evaluation. The loop keeps or reverts each experiment by its score, not by your judgment: every threshold metric counts as its share of its threshold, capped at 1, and the weighted mean of those shares must beat the checkpoint's by more than the evaluation's measured noise. A failed gate, a stage with no output, or held-out names in the diff block a keep whatever the score. A kept experiment becomes the new checkpoint. A reverted one's code is dropped, and the next round restarts from the same checkpoint with your feedback, the log of earlier rounds and read-only diffs of what was rejected.

You receive the program's specification, the checkpoint's source, the experiment's metrics on the dev split (with per-item errors when the scenario provides them), its diff, the coder's notes, the loop's decision, and the log of earlier hypotheses with their effect. The experiment's hypothesis is the one the previous review proposed: judge it like any other, and when part of it caused a regression, name that part. Find why each metric falls short by reading the errors against the code. Each run is one sample, so a small move may be noise: read it against the ci95 where one is given. An evaluation repeats an earlier one's model calls from a cache, so the prompt says how many it replayed: a call that was replayed adds no noise, and a small move where most calls replayed comes from the change. Before calling a move noise, check the diff: a change to a shared helper is a change to everything that calls it. Write:
1. feedback: concise guidance for the next round: what worked, what regressed, which metric families are weakest. When it was reverted, say why it scored worse and which path not to take again. When it was kept, say what in it is fragile: a gain that rests on one metric at another's cost, code that fits dev items rather than the task, or complexity a simpler change would avoid, so the next round can fix it. Base it on the data; do not invent failures you cannot see. Coders also get a failed evaluation's error, so don't retype it.
2. hypothesis: the next round's plan: one concrete, testable change per threshold metric still below its threshold after this round, most weighted shortfall first, one or two sentences each, at most four changes; different from hypotheses that already failed. The coder makes each change a task of its own, so keep the changes to separate parts of the program where you can. Coders start from the kept commit, but can read a rejected experiment's diff at /spec/history/r<round>.diff (round 6's is /spec/history/r6.diff), so a hypothesis that reuses rejected work can point at it. Put first the change that raises the weighted score most: the threshold metric furthest below its threshold, times its weight; a metric past its threshold adds nothing more, so propose no change for it. Where the per-item errors start with a summary of error counts, aim at the largest group one change can reach, and don't propose work on a group those counts show is small. When the prompt gives a direction, every hypothesis follows it. After a revert or a round that barely moved a target, stop refining that path for it: try a clearly different change for that metric, combine the parts of rejected attempts that helped a metric, or try a clearly different approach.
3. verdict: the experiment's outcome for the night's history, at most 8 lines. Each experiment keeps one note there, the coder's notes followed by your verdict, and every later coder reads all of them, so write what stays true: which change moved which metric, in which direction and why, as kinds of error; which of the coder's notes the scores confirm, and which they contradict (a claim about dev the coder could not check, a train measurement dev did not bear out); what not to try again. No plan for the next round: that is the hypothesis.

Coders must never see the evaluation data. Coders read the feedback, the hypothesis and the verdict: in all three describe categories of error (which kinds of items fail, and how), and never write a dev entity, document name, query id or query text. Write no counts or sizes from dev either (how many errors of a kind, items per document, how dense the gold is): metric values and their changes are what you may quote. Names in a repository check are hints that the experiment's text matches a dev item, which general knowledge can explain, not proof of a leak.

The specification may leave interpretation choices open on purpose (which year a date without one means, which of two dates counts, how loose matching may be). A family stuck at partial accuracy often means the evaluation uses a different reading: test the alternative readings one round at a time, so the metrics tell which one is right.

Reply with only a JSON object: {"feedback": "...", "hypothesis": "...", "verdict": "..."}`;

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
  const moved = [
    ...(l.deltaScore === undefined ? [] : [`Δscore=${l.deltaScore > 0 ? "+" : ""}${l.deltaScore.toFixed(4)}`]),
    ...(primary ? [`Δ${primary}=${l.deltaPrimary.toFixed(4)}`] : []), ...fmtDeltas(l.deltas), ...scores,
  ];
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
    `Round ${input.round} finished. ${headlined ? `Headline metrics: ${input.headline.join(", ")}.` : `Primary metric: ${input.primaryMetric}.`} Thresholds: ${JSON.stringify(input.thresholds)}. ` +
      `Weights in the score: ${JSON.stringify(Object.fromEntries(Object.keys(input.thresholds).map((k) => [k, input.weights[k] ?? 1])))}. Gates (caps): ${JSON.stringify(input.gates)}.`,
  ];
  if (input.direction) lines.push(`The person running this loop set this direction for every round:\n${input.direction}`);
  if (input.diagnostics.length) lines.push("Diagnostics explain the metrics, by what a run returned and what the simplest baseline scores. They are never a gain by themselves.");
  if (input.objectives.length) {
    lines.push(
      `Also measured, lower is better, though not part of the score: ${input.objectives.join(", ")}. ` +
        `Mention a change of more than ${Math.round(input.minEfficiencyGain * 100)}% in one of these, and propose an efficiency hypothesis only when one blocks ${goal}, such as a run near its time limit.`,
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
      `\nThe loop's decision: ${b.decision} (${b.reason}).` +
      (input.coderNotes?.trim() ? `\nThe coder's notes, written before the evaluation:\n${input.coderNotes.trim()}` : "\nThe coder left no notes.") +
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
  lines.push("Return JSON with feedback, hypothesis and verdict.");
  return lines.join("\n\n");
}

type Reviewed = Pick<ReviewOutput, "feedback" | "hypothesis" | "verdict">;

export function parseReview(text: string): Reviewed | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as { feedback?: unknown; hypothesis?: unknown; verdict?: unknown };
    if (typeof obj.feedback !== "string" || typeof obj.hypothesis !== "string" || !obj.hypothesis.trim()) return null;
    // A missing verdict costs the note its second half, not the review.
    return { feedback: obj.feedback.trim(), hypothesis: obj.hypothesis.trim(), verdict: typeof obj.verdict === "string" ? obj.verdict.trim() : "" };
  } catch {
    return null;
  }
}

/**
 * `scan` returns the held-out names in a text. The whole review goes to coders, so the reviewer gets
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
    const parse = () => parseReview(session.getLastAssistantText() ?? "");
    let parsed = parse();
    if (!parsed) {
      await session.prompt("Reply again with only the JSON object, with feedback, a hypothesis and a verdict.");
      outOfCredits();
      parsed = parse();
    }
    if (!parsed) throw new Error("reviewer returned no parsable JSON twice");
    const forCoders = (r: Reviewed) => `${r.feedback}\n${r.hypothesis}\n${r.verdict}`;
    let found = await scan(forCoders(parsed));
    if (found.length) {
      await session.prompt(`Your feedback, hypothesis or verdict names evaluation items coders may not see: ${found.join(", ")}. Reply again with the same JSON, describing the error categories without them.`);
      outOfCredits();
      parsed = parse() ?? parsed;
      found = await scan(forCoders(parsed));
    }
    const masked = { feedback: maskTerms(parsed.feedback, found), hypothesis: maskTerms(parsed.hypothesis, found), verdict: maskTerms(parsed.verdict, found) };
    return { ...masked, reviewer_usd: usd, tokens, t_review: Math.round((performance.now() - t0) / 10) / 100 };
  } finally {
    session.dispose();
  }
}
