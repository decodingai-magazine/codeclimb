// Reviewer LLM: dev metrics, per-item dev errors where the scenario has them, the
// branches' diffs and the hypothesis log → which branch to keep, feedback, and one
// distinct hypothesis per next branch. A fixed model that is none of the coders.
// Never sees anything from test.
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createIsolatedSession } from "./pi/session";
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
  diff: string;
  /** The stage reports' per-item errors on dev, when the scenario gives them. */
  details: string;
}

export interface HypothesisLogEntry {
  round: number;
  hypothesis: string;
  deltaPrimary: number;
  /** Change of each optimized standard metric vs the parent's run in the same evaluator. */
  deltas?: Metrics;
  decision: string;
}

export interface ReviewInput {
  model: string;
  spec: string;
  round: number;
  branches: number;
  primaryMetric: string;
  thresholds: Record<string, number>;
  gates: Record<string, number>;
  parentScore: number;
  parentMetrics: Metrics | null;
  /** Optimized standard metrics (lower is better); the other standard metrics stay out of the prompt. */
  objectives: string[];
  minEfficiencyGain: number;
  results: BranchSummary[];
  log: HypothesisLogEntry[];
  /** The branches it may keep: gates and guardrails passed. */
  candidates: string[];
  /** What the mechanical rule would keep; a hint, not a verdict. */
  mechanicalKeep: string | null;
  /** The scenario's headline metrics; when set, the prompt shows only these, the thresholds and the gates. */
  headline: string[];
  /** The scenario's evaluation protocol, how to read its metrics. */
  protocol: string;
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

const SYSTEM_PROMPT = `You review experiments in an automated research loop. Coding agents change a program to raise a primary metric on hidden evaluation data. Each round, several branches start from the same kept commit, each testing one hypothesis.

You receive the program's specification, each branch's metrics on the dev split (with per-item errors when the scenario provides them), its diff, the candidates that may be kept, and the log of earlier hypotheses with their effect. Write:
1. keep: the id of the one candidate to keep as the next round's parent, or null to stay on the parent. Weigh every metric, not one number: a gain in one metric bought by a loss in another is no gain, a change that fits dev items by name is no gain, and a small gain with a simple diff beats the same gain with a fragile one. Follow the evaluation protocol if one is given.
2. keep_reason: one or two sentences saying why.
3. feedback: concise guidance for the next round (what worked, what regressed, which metric families are weakest). Base it on the data; do not invent failures you cannot see.
4. hypotheses: exactly N distinct, concrete, testable hypotheses, one per branch. Each is one or two sentences naming the change to make. Make them different from each other and from hypotheses that already failed.

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

function fmtDeltas(d: Metrics | undefined): string {
  const parts = Object.entries(d ?? {}).map(([k, v]) => `Δ${k}=${v > 0 ? "+" : ""}${fmtNum(v)}`);
  return parts.length ? `, ${parts.join(", ")}` : "";
}

export function reviewerPrompt(input: ReviewInput): string {
  const lines = [
    `<spec>\n${input.spec}\n</spec>`,
    ...(input.protocol ? [`<protocol>\n${input.protocol}\n</protocol>`] : []),
    `Round ${input.round} finished. Primary metric: ${input.primaryMetric}. Thresholds: ${JSON.stringify(input.thresholds)}. Gates (caps): ${JSON.stringify(input.gates)}.`,
  ];
  if (input.objectives.length) {
    lines.push(
      `Also optimized, lower is better: ${input.objectives.join(", ")}. Of branches tied on ${input.primaryMetric}, prefer the cheaper, then faster one; ` +
        `when no branch raises ${input.primaryMetric}, a branch that keeps it and cuts one of these by more than ${Math.round(input.minEfficiencyGain * 100)}% is worth keeping. ` +
        `Correctness comes first: propose efficiency hypotheses when ${input.primaryMetric} has stalled or alongside accuracy ones.`,
    );
  }
  lines.push(`Kept commit (parent of the next round): ${input.primaryMetric}=${input.parentScore.toFixed(4)}; metrics: ${fmtMetrics(input.parentMetrics, input)}`);
  for (const b of input.results) {
    lines.push(
      `## Branch ${b.expId} (${b.model}) → ${b.decision}\nHypothesis: ${b.hypothesis}\n${input.primaryMetric}=${b.primary.toFixed(4)}; metrics: ${fmtMetrics(b.metrics, input)}` +
        (b.guardrails.length ? `\nFailed guardrails, can't be kept: ${b.guardrails.join("; ")}` : "") +
        (b.details ? `\nPer-item errors on dev (may be cut off):\n${b.details}` : "") +
        `\nDiff vs parent:\n\`\`\`diff\n${b.diff}\n\`\`\``,
    );
  }
  if (input.log.length) {
    lines.push(
      "## Hypothesis log (all rounds)\n" +
        input.log.map((l) => `- r${l.round}: ${l.hypothesis} → Δ${input.primaryMetric}=${l.deltaPrimary.toFixed(4)}${fmtDeltas(l.deltas)} (${l.decision})`).join("\n"),
    );
  }
  lines.push(
    input.candidates.length
      ? `Candidates you may keep: ${input.candidates.join(", ")}. The mechanical rule would keep: ${input.mechanicalKeep ?? "nothing"}.`
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

export async function runReview(input: ReviewInput): Promise<ReviewOutput> {
  const t0 = performance.now();
  const session = await createIsolatedSession({
    model: input.model,
    sessionManager: SessionManager.inMemory("/repo"),
    systemPrompt: SYSTEM_PROMPT,
    thinkingLevel: "low",
  });
  let usd = 0;
  let tokens = 0;
  session.subscribe((e) => {
    if (e.type === "message_end" && e.message.role === "assistant") {
      usd += e.message.usage.cost.total;
      tokens += e.message.usage.totalTokens;
    }
  });
  try {
    await session.prompt(reviewerPrompt(input));
    let parsed = parseReview(session.getLastAssistantText() ?? "", input.branches, input.candidates);
    if (!parsed) {
      await session.prompt(`Reply again with only the JSON object: keep must be null or one of [${input.candidates.join(", ")}], with exactly ${input.branches} distinct hypotheses.`);
      parsed = parseReview(session.getLastAssistantText() ?? "", input.branches, input.candidates);
    }
    if (!parsed) throw new Error("reviewer returned no parsable JSON twice");
    return { ...parsed, reviewer_usd: usd, tokens, t_review: Math.round((performance.now() - t0) / 10) / 100 };
  } finally {
    session.dispose();
  }
}
