// The reviewer's evidence caps, its reply parsing and the trajectory: pure functions (spec: Reviewer; Notes, trajectory and rejected diffs).

export const DETAILS_CHARS = 70_000;
export const RUN_LOG_CHARS = 4_000;
export const DIFF_CHARS = 60_000;
export const SOURCE_CHARS = 60_000;
export const CODER_PART_CHARS = 4_000;
export const TRAJECTORY_CHARS = 48_000;

export interface Review {
	feedback: string;
	hypothesis: string;
	verdict: string;
}

/** The JSON object from the reply's first `{` to its last `}`: a string `feedback` and a non-empty `hypothesis`. */
export function parseReply(text: string): Review | null {
	const a = text.indexOf("{");
	const b = text.lastIndexOf("}");
	if (a < 0 || b <= a) return null;
	let v: unknown;
	try {
		v = JSON.parse(text.slice(a, b + 1));
	} catch {
		return null;
	}
	if (typeof v !== "object" || v === null) return null;
	const o = v as Record<string, unknown>;
	if (typeof o.feedback !== "string" || typeof o.hypothesis !== "string" || !o.hypothesis.trim()) return null;
	return { feedback: o.feedback.trim(), hypothesis: o.hypothesis.trim(), verdict: typeof o.verdict === "string" ? o.verdict.trim() : "" };
}

export const JSON_ONLY = 'Reply with JSON only, one object: {"feedback": "...", "hypothesis": "...", "verdict": "..."}.';

/** Ask, and once more for JSON only; null when neither reply parses. */
export async function askForReview(ask: (prompt: string) => Promise<string>, prompt: string): Promise<Review | null> {
	return parseReply(await ask(prompt)) ?? parseReply(await ask(JSON_ONLY));
}

/** Items shorter than an equal share of `cap` stay whole; the longer ones split what is left equally. */
export function capItems(items: string[], cap = DETAILS_CHARS): string[] {
	const total = items.reduce((n, s) => n + s.length, 0);
	if (total <= cap || items.length === 0) return items;
	const share = cap / items.length;
	const short = items.filter((s) => s.length <= share);
	const each = Math.max(0, Math.floor((cap - short.reduce((n, s) => n + s.length, 0)) / (items.length - short.length)));
	return items.map((s) => (s.length <= share ? s : s.slice(0, each)));
}

const FLAGGED = /\b(warn|warning|error|critical|exception|traceback|failed)\b/i;

/** Drop `HTTP Request:` and blank lines; if still over: flagged lines first (distinct, counted, half the room at most), then the tail, whole lines. */
export function capRunLog(log: string, cap = RUN_LOG_CHARS): string {
	const lines = log.split("\n").filter((l) => l.trim() !== "" && !l.includes("HTTP Request:"));
	const kept = lines.join("\n");
	if (kept.length <= cap) return kept;
	const counts = new Map<string, number>();
	for (const l of lines) if (FLAGGED.test(l)) counts.set(l, (counts.get(l) ?? 0) + 1);
	const head: string[] = [];
	let used = 0;
	for (const [l, n] of counts) {
		const s = `${l} (${n}×)`;
		if (used + s.length + 1 > cap / 2) break;
		head.push(s);
		used += s.length + 1;
	}
	const tail: string[] = [];
	for (let i = lines.length - 1; i >= 0; i--) {
		const l = lines[i] as string;
		if (used + l.length + 1 > cap) break;
		tail.unshift(l);
		used += l.length + 1;
	}
	return [...head, ...tail].join("\n");
}

export function capText(text: string, cap: number, what: string): string {
	return text.length <= cap ? text : `${text.slice(0, cap)}\n[cut: the ${what} is ${text.length} characters in full]`;
}

export interface TrajectoryRound {
	round: number;
	line: string;
	coder?: string;
	verdict?: string;
	feedback?: string;
}

function renderRound(r: TrajectoryRound, latest: boolean): string {
	const parts = [`### r${r.round}${latest ? " (latest)" : ""}`, r.line];
	if (r.coder) parts.push(`Coder notes:\n${r.coder}`);
	if (r.verdict) parts.push(`Reviewer verdict:\n${r.verdict}`);
	if (r.feedback) parts.push(`Reviewer feedback:\n${r.feedback}`);
	return parts.join("\n");
}

/** Rounds oldest first, the latest marked. Past the budget the oldest lose feedback, then coder parts, then all but the line. */
export function trajectory(rounds: TrajectoryRound[], budget = TRAJECTORY_CHARS): string {
	const rs = rounds.map((r) => ({ ...r }));
	const render = () => rs.map((r, i) => renderRound(r, i === rs.length - 1)).join("\n\n");
	let out = render();
	for (const strip of [["feedback"], ["coder"], ["verdict"]] as const) {
		for (let i = 0; i < rs.length - 1 && out.length > budget; i++) {
			const r = rs[i] as TrajectoryRound;
			for (const k of strip) delete r[k];
			out = render();
		}
	}
	return out;
}
