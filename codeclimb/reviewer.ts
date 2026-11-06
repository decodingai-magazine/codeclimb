// Reviewer LLM: dev metrics, per-item dev errors where the scenario has them, the
// branches' diffs and the hypothesis log → which branch to keep, feedback, and one
// distinct hypothesis per next branch. A fixed model that is none of the coders.
// Never sees anything from test.
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { isCreditError, OutOfCredits } from "./credits";
import type { ThinkingLevel } from "./config";
import { createIsolatedSession } from "./pi/session";
import { maskTerms } from "./scenario";
import type { Metrics } from "./stats";

export interface BranchSummary {
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
  /** Change of each headline and optimized standard metric vs the parent's run in the same evaluator. */
  deltas?: Metrics;
  /** The same metrics as they stood, when the parent had no run to compare with. */
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
  branches: number;
  primaryMetric: string;
  thresholds: Record<string, number>;
  gates: Record<string, number>;
  parentScore: number;
  parentMetrics: Metrics | null;
  /** Every dev run of the kept commit this night, oldest first: what the metrics do when nothing changed. */
  parentRuns: Metrics[];
  /** Optimized standard metrics (lower is better); the other standard metrics stay out of the prompt. */
  objectives: string[];
  minEfficiencyGain: number;
  results: BranchSummary[];
  log: HypothesisLogEntry[];
  /** The branches it may keep: gates and guardrails passed. */
  candidates: string[];
  /** What the mechanical rule would keep; a hint, not a verdict. */
  mechanicalKeep: string | null;
  /** The scenario's headline metrics; when set, these decide the keep and no single metric frames the prompt. */
  headline: string[];
  /** Regexes of the metrics that explain the headlines without deciding the keep. */
  diagnostics: string[];
  /** The scenario's evaluation protocol, how to read its metrics. */
  protocol: string;
  /** The kept commit's source, which the branches' diffs apply to. */
  parentSource: string;
}

export interface ReviewOutput {
  /** The branch to keep, or null to stay on the parent. */
  keep: string | null;
  keep_reason: string;
  feedback: string;
  hypotheses: string[];
  reviewer_usd: number;
  t_review: number;
  tokens: number;
}

const SYSTEM_PROMPT = `You review experiments in an automated research loop. Coding agents change a program to raise its metrics on hidden evaluation data. Each round, several branches start from the same kept commit, each testing one hypothesis.

You receive the program's specification, the kept commit's source, each branch's metrics on the dev split (with per-item errors when the scenario provides them), its diff, the candidates that may be kept, and the log of earlier hypotheses with their effect. Find why each metric falls short by reading the errors against the code. Write:
1. keep: the id of the one candidate to keep as the next round's parent, or null to stay on the parent. Weigh every metric, not one number, and read each against the kept commit's own repeated runs: a branch inside their range neither gained nor lost. A metric that clears that range by a wide margin, with the others inside it, is a gain, whichever metric it is. Each branch lists the metrics that moved past noise: with none listed there is no gain, and being the best branch doesn't make one, so keep null when no branch has one. While the kept commit is the empty starter nothing is listed and no such comparison exists: judge the candidates on their absolute scores, and keep the strongest unless it looks broken or fitted to dev items, since it sets the bar for later rounds. A gain in one metric bought by a loss in another is no gain, a change that fits dev items by name is no gain, and a small gain with a simple diff beats the same gain with a fragile one. Follow the evaluation protocol if one is given.
2. keep_reason: one or two sentences saying why.
3. feedback: concise guidance for the next round (what worked, what regressed, which metric families are weakest). Base it on the data; do not invent failures you cannot see. Coders also get each failed evaluation's error, so don't retype it.
4. hypotheses: exactly N distinct, concrete, testable hypotheses, one per branch. Each is one or two sentences naming the change to make. Make them different from each other and from hypotheses that already failed. Coders start from the kept commit and can't read a reverted branch's code, so a hypothesis that reuses reverted work must describe all of it.

Coders must never see the evaluation data. In feedback and hypotheses describe categories of error (which kinds of items fail, and how), and never write a dev entity, document name, query id or query text. Names in a repository check are hints that a branch's text matches a dev item, which general knowledge can explain, not proof of a leak.

The specification may leave interpretation choices open on purpose (which year a date without one means, which of two dates counts, how loose matching may be). A family stuck at partial accuracy often means the evaluation uses a different reading: propose the alternative readings as hypotheses on separate branches, so one round's metrics tell which one is right.

Reply with only a JSON object: {"keep": "<branch id>" or null, "keep_reason": "...", "feedback": "...", "hypotheses": ["...", ...]}`;

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

/** Each metric that decides the keep, across the kept commit's runs, with its sampling interval where it has one. */
function fmtNoise(input: ReviewInput): string {
  const lines = [...new Set([input.primaryMetric, ...input.headline])].flatMap((k) => {
    const values = input.parentRuns.flatMap((r) => (typeof r[k] === "number" ? [r[k]] : []));
    if (!values.length) return [];
    const ci = input.parentRuns.at(-1)?.[k.replace(/\.mean$/, ".ci95_half")];
    const range = values.length > 1 ? ` (spread ${fmtNum(Math.max(...values) - Math.min(...values))})` : "";
    return [`- ${k}: ${values.map(fmtNum).join(", ")}${range}${k.endsWith(".mean") && typeof ci === "number" ? `, ci95 ±${fmtNum(ci)}` : ""}`];
  });
  return lines.length
    ? `## Noise\nThe kept commit's own dev runs this night, unchanged code, oldest first. A difference inside this spread is noise; a ci95 is the metric's sampling interval over the dev items.\n${lines.join("\n")}`
    : "";
}

/** The deciding metrics of a branch past the kept commit's range, widened by its spread on both sides. */
function fmtMoved(m: Metrics, input: ReviewInput): string {
  const moved = [...new Set([input.primaryMetric, ...input.headline])].flatMap((k) => {
    const values = input.parentRuns.flatMap((r) => (typeof r[k] === "number" ? [r[k]] : []));
    if (!values.length || typeof m[k] !== "number") return [];
    const [lo, hi] = [Math.min(...values), Math.max(...values)];
    const spread = hi - lo;
    return m[k] > hi + spread || m[k] < lo - spread ? [`${k}=${fmtNum(m[k])} (${m[k] > hi ? "above" : "below"} ${fmtNum(lo)}–${fmtNum(hi)})`] : [];
  });
  return moved.length ? moved.join(", ") : "none";
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
  if (input.diagnostics.length) lines.push("Diagnostics explain the metrics, by what a run returned and what the simplest baseline scores. They are never a gain by themselves.");
  if (input.objectives.length) {
    lines.push(
      `Also optimized, lower is better: ${input.objectives.join(", ")}. Of branches tied on ${goal}, prefer the cheaper, then faster one; ` +
        `when no branch raises ${goal}, a branch that keeps ${goal} and cuts one of these by more than ${Math.round(input.minEfficiencyGain * 100)}% is worth keeping. ` +
        `Correctness comes first: propose efficiency hypotheses when ${goal} stalled or alongside accuracy ones.`,
    );
  }
  lines.push(
    input.parentRuns.length
      ? `Kept commit (parent of the next round), this round's run: ${score(input.parentScore)}metrics: ${fmtMetrics(input.parentMetrics, input)}${fmtDiagnostics(input.parentMetrics, input)}`
      : "The kept commit is the empty starter and wasn't run: read each branch's scores as they stand. The first branch kept sets the bar for later rounds.",
  );
  const noise = fmtNoise(input);
  if (noise) lines.push(noise);
  if (input.parentSource) lines.push(`## Kept commit source\nEvery branch's diff applies to this.\n${input.parentSource}`);
  for (const b of input.results) {
    lines.push(
      `## Branch ${b.expId} (${b.model}) → ${b.decision}\nHypothesis: ${b.hypothesis}\n${score(b.primary)}metrics: ${fmtMetrics(b.metrics, input)}` +
        fmtDiagnostics(b.metrics, input) +
        (input.parentRuns.length ? `\nMoved past noise: ${fmtMoved(b.metrics, input)}` : "") +
        (b.guardrails.length ? `\nFailed guardrails, can't be kept: ${b.guardrails.join("; ")}` : "") +
        (b.notes.length ? `\nRepository check: ${b.notes.join("; ")}` : "") +
        (b.details ? `\nPer-item errors on dev (may be cut off):\n${b.details}` : "") +
        `\nDiff vs parent:\n\`\`\`diff\n${b.diff}\n\`\`\``,
    );
  }
  if (input.log.length) {
    const logged = (l: HypothesisLogEntry) => {
      const scores = Object.entries(l.scores ?? {}).map(([k, v]) => `${k}=${fmtNum(v)}`);
      const moved = [...(headlined ? [] : [`Δ${input.primaryMetric}=${l.deltaPrimary.toFixed(4)}`]), ...fmtDeltas(l.deltas), ...scores];
      return `- r${l.round}: ${l.hypothesis} → ${moved.join(", ") || (l.scores ? "not scored" : "no metric moved")} (${l.decision}${l.reason ? `: ${l.reason}` : ""})`;
    };
    lines.push(
      "## Hypothesis log (all rounds)\nEach Δ is against the kept commit's run in that round; plain values had no run to compare with. A reverted branch's code is gone: coders start from the kept commit and can't read it.\n" +
        input.log.map(logged).join("\n"),
    );
  }
  lines.push(
    input.candidates.length
      ? `Candidates you may keep: ${input.candidates.join(", ")}.${headlined ? "" : ` The mechanical rule, which reads ${input.primaryMetric} alone, would keep: ${input.mechanicalKeep ?? "nothing"}.`}`
      : `No branch can be kept this round: keep must be null.`,
  );
  lines.push(`Return JSON with keep, keep_reason, feedback and exactly ${input.branches} hypotheses.`);
  return lines.join("\n\n");
}

export function parseReview(text: string, n: number, candidates: string[]): Pick<ReviewOutput, "keep" | "keep_reason" | "feedback" | "hypotheses"> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as { keep?: unknown; keep_reason?: unknown; feedback?: unknown; hypotheses?: unknown };
    if (typeof obj.feedback !== "string" || !Array.isArray(obj.hypotheses)) return null;
    if (obj.keep !== null && !(typeof obj.keep === "string" && candidates.includes(obj.keep))) return null;
    const hyps = [...new Set(obj.hypotheses.filter((h): h is string => typeof h === "string" && h.trim() !== "").map((h) => h.trim()))];
    if (hyps.length < n) return null;
    return { keep: obj.keep, keep_reason: typeof obj.keep_reason === "string" ? obj.keep_reason.trim() : "", feedback: obj.feedback.trim(), hypotheses: hyps.slice(0, n) };
  } catch {
    return null;
  }
}

/**
 * `scan` returns the held-out names in a text. Feedback and hypotheses go to coders, so the reviewer gets
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
    let parsed = parseReview(session.getLastAssistantText() ?? "", input.branches, input.candidates);
    if (!parsed) {
      await session.prompt(`Reply again with only the JSON object: keep must be null or one of [${input.candidates.join(", ")}], with exactly ${input.branches} distinct hypotheses.`);
      outOfCredits();
      parsed = parseReview(session.getLastAssistantText() ?? "", input.branches, input.candidates);
    }
    if (!parsed) throw new Error("reviewer returned no parsable JSON twice");
    const forCoders = (r: Pick<ReviewOutput, "feedback" | "hypotheses">) => [r.feedback, ...r.hypotheses].join("\n");
    let found = await scan(forCoders(parsed));
    if (found.length) {
      await session.prompt(`Your feedback or hypotheses name evaluation items coders may not see: ${found.join(", ")}. Reply again with the same JSON, describing the error categories without them.`);
      outOfCredits();
      parsed = parseReview(session.getLastAssistantText() ?? "", input.branches, input.candidates) ?? parsed;
      found = await scan(forCoders(parsed));
    }
    const masked = { ...parsed, feedback: maskTerms(parsed.feedback, found), hypotheses: parsed.hypotheses.map((h) => maskTerms(h, found)) };
    return { ...masked, reviewer_usd: usd, tokens, t_review: Math.round((performance.now() - t0) / 10) / 100 };
  } finally {
    session.dispose();
  }
}
