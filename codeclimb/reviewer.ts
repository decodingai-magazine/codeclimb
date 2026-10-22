// Reviewer LLM: aggregate optimization metrics + the branches' diffs + the
// hypothesis log → feedback + one distinct hypothesis per branch. A fixed model
// that is none of the coders. Never sees per-item results.
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
  diff: string;
}

export interface HypothesisLogEntry {
  round: number;
  hypothesis: string;
  deltaPrimary: number;
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
  results: BranchSummary[];
  log: HypothesisLogEntry[];
  /** Set after an overfit validation: only the gap value, never per-item results. */
  validationGap?: number;
}

export interface ReviewOutput {
  feedback: string;
  hypotheses: string[];
  reviewer_usd: number;
  t_review: number;
  tokens: number;
}

const SYSTEM_PROMPT = `You review experiments in an automated research loop. Coding agents change a program to raise a primary metric on hidden evaluation data. Each round, several branches start from the same kept commit, each testing one hypothesis.

You receive the program's specification, aggregate metrics per branch (never per-item results), each branch's diff, and the log of earlier hypotheses with their effect. Write:
1. feedback: concise guidance for the next round (what worked, what regressed, which metric families are weakest). Base it on the metrics; do not invent failures you cannot see.
2. hypotheses: exactly N distinct, concrete, testable hypotheses, one per branch. Each is one or two sentences naming the change to make. Make them different from each other and from hypotheses that already failed.

The specification may leave interpretation choices open on purpose (which year a date without one means, which of two dates counts, how loose matching may be). A family stuck at partial accuracy often means the evaluation uses a different reading: propose the alternative readings as hypotheses on separate branches, so one round's metrics tell which one is right.

Reply with only a JSON object: {"feedback": "...", "hypotheses": ["...", ...]}`;

function fmtMetrics(m: Metrics | null): string {
  if (!m) return "(none)";
  return Object.entries(m)
    .map(([k, v]) => `${k}=${Number.isInteger(v) ? v : v.toFixed(4)}`)
    .join(", ");
}

export function reviewerPrompt(input: ReviewInput): string {
  const lines = [
    `<spec>\n${input.spec}\n</spec>`,
    `Round ${input.round} finished. Primary metric: ${input.primaryMetric}. Thresholds: ${JSON.stringify(input.thresholds)}. Gates (caps): ${JSON.stringify(input.gates)}.`,
    `Kept commit (parent of the next round): ${input.primaryMetric}=${input.parentScore.toFixed(4)}; metrics: ${fmtMetrics(input.parentMetrics)}`,
  ];
  if (input.validationGap !== undefined) {
    lines.push(
      `Validation on a held-out fold found overfitting: optimization − validation ${input.primaryMetric} gap = ${input.validationGap.toFixed(4)}. Steer toward changes that generalize.`,
    );
  }
  for (const b of input.results) {
    lines.push(
      `## Branch ${b.expId} (${b.model}) → ${b.decision}\nHypothesis: ${b.hypothesis}\n${input.primaryMetric}=${b.primary.toFixed(4)}; metrics: ${fmtMetrics(b.metrics)}\nDiff vs parent:\n\`\`\`diff\n${b.diff}\n\`\`\``,
    );
  }
  if (input.log.length) {
    lines.push(
      "## Hypothesis log (all rounds)\n" +
        input.log.map((l) => `- r${l.round}: ${l.hypothesis} → Δ${input.primaryMetric}=${l.deltaPrimary.toFixed(4)} (${l.decision})`).join("\n"),
    );
  }
  lines.push(`Return JSON with feedback and exactly ${input.branches} hypotheses.`);
  return lines.join("\n\n");
}

export function parseReview(text: string, n: number): { feedback: string; hypotheses: string[] } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as { feedback?: unknown; hypotheses?: unknown };
    if (typeof obj.feedback !== "string" || !Array.isArray(obj.hypotheses)) return null;
    const hyps = [...new Set(obj.hypotheses.filter((h): h is string => typeof h === "string" && h.trim() !== "").map((h) => h.trim()))];
    if (hyps.length < n) return null;
    return { feedback: obj.feedback.trim(), hypotheses: hyps.slice(0, n) };
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
    let parsed = parseReview(session.getLastAssistantText() ?? "", input.branches);
    if (!parsed) {
      await session.prompt(`Reply again with only the JSON object and exactly ${input.branches} distinct hypotheses.`);
      parsed = parseReview(session.getLastAssistantText() ?? "", input.branches);
    }
    if (!parsed) throw new Error("reviewer returned no parsable JSON twice");
    return { ...parsed, reviewer_usd: usd, tokens, t_review: Math.round((performance.now() - t0) / 10) / 100 };
  } finally {
    session.dispose();
  }
}
