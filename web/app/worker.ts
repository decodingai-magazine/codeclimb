// Browser-side helpers for the worker API, reached through /api/worker (see its route), and the shapes it answers with.
import type { ResultRow } from "../../src/results.ts";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/worker/${path}`, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

export type NightStatus = "running" | "paused" | "finished" | "stopped" | "stale";

export type NightSummary = {
  id: string;
  scenario: string;
  mock: boolean;
  status: NightStatus;
  stop_reason: string | null;
  /** Set while the night is paused: the pause number, since when, and the steps that ran out of credits. */
  pause: { pause: number; at: string; round: number; stops: { where: string; who: string; model: string; message: string }[] } | null;
  round: number;
  max_rounds: number;
  primary_metric: string;
  best: number | null;
  best_exp: string | null;
  threshold: number | null;
  spend_usd: number;
  budget_usd: number;
  started_at: string;
  deadline_at: string;
  finished_at: string | null;
  variation: number;
};

/** The current round's experiment while the night runs or is paused. */
export type Current = {
  exp_id: string;
  model: string;
  phase: string;
  elapsed_s: number;
  coder_usd: number;
  dev_usd: number;
  tokens: number;
};

export type Live = NightSummary & {
  current: Current | null;
  /** The night's result rows so far: a change refetches the report. */
  rows: number;
  experiments: { exp_id: string; round: number; decision: string; score: number | null; hypothesis: string | null }[];
};

export type ReportConfig = {
  scenario: string;
  model: string;
  reviewer_model: string;
  primary_metric: string;
  thresholds: Record<string, number>;
  weights: Record<string, number>;
  gates: Record<string, unknown>;
  max_rounds: number;
  budget_usd: { night: number; experiment: number };
  headline: string[];
  stages: string[];
};

export type Report = {
  night: NightSummary;
  config: ReportConfig;
  done: { stop_reason: string; rounds: number; kept: { exp_id: string; commit: string; dev_score: number }; spend_usd: number; finished_at: string } | null;
  rows: ResultRow[];
  reviews: { round: number; feedback: string; hypothesis: string; verdict: string }[];
  diffs: Record<string, string>;
};

export const usd = (v: number | null | undefined) => (v == null ? "–" : `$${v.toFixed(v < 1 ? 4 : 2)}`);
export const f3 = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "–" : v.toFixed(3));
/** Small values (a fast program's seconds, a cost per item) keep three significant digits. */
export const fnum = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? "–" : Number.isInteger(v) ? String(v) : Math.abs(v) < 0.01 && v !== 0 ? v.toPrecision(3) : v.toFixed(3);
export const signed = (v: number | null | undefined) => (v == null ? "–" : (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(3));
export function duration(s: number): string {
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}
