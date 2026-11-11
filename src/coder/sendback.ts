// Send-backs, the reserve and the wrap-up: pure rules over what the coder left (spec: Send-backs, reserve and wrap-up).

export const MAX_SEND_BACKS = 8;
/** No send-back and no wrap-up turn with less than this left. */
export const MIN_MINUTES_LEFT = 3;
/** The reserve is the last 20% of the time or of the budget. */
export const RESERVE_SHARE = 0.2;

export const WRAP_UP = [
	"Your time is nearly up: change no more code.",
	"If your last change did not win on train, restore the checkpoint.",
	"Close your tasks in /tmp/tasks.json, bring /tmp/train-score.json and /tmp/notes.md up to date, review your work again,",
	"and end your final message with `APPROACH: <one sentence>`.",
].join(" ");

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function parse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** `/tmp/tasks.json`: a list of `{task, check, status}`; every task `done`, or `dropped` with a note. */
export function tasksProblem(text: string | null): string | null {
	if (text === null) return "/tmp/tasks.json is missing: write your plan as a JSON list of {task, check, status}.";
	const v = parse(text);
	if (!Array.isArray(v) || v.some((t) => !isObj(t) || typeof t.task !== "string" || typeof t.status !== "string")) return "/tmp/tasks.json is not valid: it must be a JSON list of {task, check, status}.";
	const open = v.filter((t: Obj) => !(t.status === "done" || (t.status === "dropped" && typeof t.note === "string" && t.note.trim() !== "")));
	return open.length ? `/tmp/tasks.json has ${open.length} task${open.length > 1 ? "s" : ""} neither done nor dropped with a note: finish or drop ${open.length > 1 ? "them" : "it"}.` : null;
}

const numericValues = (o: unknown): Record<string, number> | null => {
	if (!isObj(o)) return null;
	const out = Object.fromEntries(Object.entries(o).filter(([, n]) => typeof n === "number" && Number.isFinite(n))) as Record<string, number>;
	return Object.keys(out).length ? out : null;
};

/** `/tmp/train-score.json`: `before` and `after` with a numeric value each; a metric that fell needs a `why`. */
export function trainProblem(text: string | null): string | null {
	if (text === null) return "/tmp/train-score.json is missing: measure the starting code and your change on train.";
	const v = parse(text);
	const before = isObj(v) ? numericValues(v.before) : null;
	const after = isObj(v) ? numericValues(v.after) : null;
	if (!before || !after) return "/tmp/train-score.json is not valid: `before` and `after` must be objects with at least one numeric score each.";
	const fell = Object.keys(before).filter((k) => typeof after[k] === "number" && (after[k] as number) < (before[k] as number));
	if (fell.length && !(isObj(v) && typeof v.why === "string" && v.why.trim())) return `/tmp/train-score.json: ${fell.join(", ")} fell with no \`why\`.`;
	return null;
}

export function inReserve(r: { elapsedMs: number; totalMs: number; usd: number; budgetUsd: number }): boolean {
	return r.elapsedMs >= r.totalMs * (1 - RESERVE_SHARE) || r.usd >= r.budgetUsd * (1 - RESERVE_SHARE);
}

export interface SendBackInput {
	tasks: string | null;
	train: string | null;
	/** The bundle has `train/`. */
	hasTrain: boolean;
	reserve: boolean;
	sendBacks: number;
	repair: boolean;
	/** Stopped by a cap: time, idle, budget, credits. */
	capStopped: boolean;
	minutesLeft: number;
	minutesTotal: number;
	usdLeft: number;
	usdTotal: number;
	/** The untested parts of the hypothesis, or the worst train items of the metric furthest below its threshold. */
	nextStep: string;
}

/** The send-back message, or null when the coder may stop. */
export function sendBackMessage(s: SendBackInput): string | null {
	if (s.repair || s.capStopped || s.sendBacks >= MAX_SEND_BACKS || s.minutesLeft < MIN_MINUTES_LEFT) return null;
	const problems = [tasksProblem(s.tasks), s.hasTrain ? trainProblem(s.train) : null].filter((p): p is string => p !== null);
	if (!problems.length && s.reserve) return null;
	const lines = [...problems, `You stopped with ${Math.floor(s.minutesLeft)} of ${Math.round(s.minutesTotal)} minutes and $${Math.max(s.usdLeft, 0).toFixed(2)} of $${s.usdTotal.toFixed(2)} left.`];
	if (!s.reserve) {
		lines.push(
			`Next step: ${s.nextStep}.`,
			"Make exactly one change: commit a checkpoint in the sandbox (git commit in /repo), build the change, measure it on train against the checkpoint, keep it only if it scores better, else restore the checkpoint.",
		);
	}
	return lines.join("\n");
}
