// Browser-side helpers for the worker API, reached through /api/worker (see its route).

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/worker/${path}`, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

export type NightSummary = {
  id: string;
  scenario: string;
  sandbox: string;
  status: "running" | "paused" | "finished" | "stopped" | "stale";
  stop_reason: string | null;
  /** Set while the night waits for credits. */
  pause: { at: number; stops: { where: string; who: string; model: string; message: string }[] } | null;
  round: number;
  max_rounds: number;
  primary_metric: string;
  best: number | null;
  best_exp: string | null;
  threshold: number | null;
  spend_usd: number;
  budget_usd: number;
  started_at: number;
  deadline_at: number;
  finished_at: string | null;
};

export type Branch = {
  branch: number;
  exp_id: string;
  model: string;
  phase: string;
  elapsed_s: number;
  coder_usd: number;
  dev_usd: number;
  tokens: number;
  stop: string | null;
  score: number | null;
  decision: string | null;
};

export type Live = NightSummary & {
  branches: Branch[];
  rows: number;
  experiments: { exp_id: string; round: number; decision: string; score: number | null; hypothesis: string }[];
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
