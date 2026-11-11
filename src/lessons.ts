// Lessons across nights. A night's notes and reviews die with its bundle: the next night exports a new
// one from the scenario's spec. The scenario's lessons.md, which ships in every bundle, is the memory
// between nights. After each night a model reads what the night left (the coders' notes and the
// reviewer's verdicts, never anything from test) and edits it: adds a lesson, edits or moves one the
// night refined, drops one the night showed wrong. It is a scratchpad kept current, not a log: a night
// that repeats a lesson changes nothing, and two lessons that say one thing become one.
//
// The model returns operations on the numbered bullets, not a new file, so an unchanged lesson stays
// byte for byte and none is lost by omission. What a coder reads is gated: no held-out name (the
// scenario's `scan`), no decimal or percentage (every dev metric is one), a length and a size cap, no
// near-duplicate of a lesson already there. The file holds at most LINE_CAP lines: when a night's ops
// pass it, the model prunes the lessons of least value. The reasons stay in the proposal, which no coder
// reads.
//
// No LangGraph here: the `lessons` graph and the CLI call these (spec: Lessons across nights).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { NightConfig, Thinking } from "./config.ts";
import { nightPaths } from "./night/files.ts";
import { isCreditMessage } from "./night/pause.ts";
import { mask } from "./night/scan.ts";
import { sessionModel } from "./pi/models.ts";
import { openSession } from "./pi/session.ts";

export interface LessonSection {
	heading: string;
	bullets: string[];
}

/** lessons.md: a `# ` title, preamble paragraphs, then `## ` sections of `- ` bullets. */
export interface LessonsDoc {
	title: string;
	preamble: string[];
	sections: LessonSection[];
}

/** `id` is a bullet's number in the prompt's listing of the file, counted from 1 across sections. */
export type LessonOp =
	| { op: "add"; section: string; text: string; reason: string; new_section?: boolean; distinct?: boolean }
	| { op: "edit"; id: number; text?: string; section?: string; reason: string; new_section?: boolean }
	| { op: "drop"; id: number; reason: string };

export interface Rejected {
	op: LessonOp;
	problem: string;
}

/** Lessons at most: past it, an `add` must come with a merge or a drop. */
export const LESSON_CAP = 30;
/** lessons.md lines at most: past it, the model drops or shortens the lessons of least value. */
export const LINE_CAP = 200;
/** Prune rounds before a proposal is left over LINE_CAP, which is never applied. */
const PRUNE_ROUNDS = 2;
export const LESSON_MAX_CHARS = 500;
const HEADING_MAX_CHARS = 80;
/** An `add` sharing this share of its content words with a lesson is a near-duplicate of it. */
export const DUPLICATE_OVERLAP = 0.5;
const WIDTH = 100;
/** A decimal or a percentage: the shape of every metric value, which a coder must not read. A version in a name (`jev-1.14`) is neither. */
const METRIC_VALUE = /(?<![\w.-])\d+\.\d+(?![\w-]|\.\w)|\d+\s*%/;

// ---------- the file

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
export const lineCount = (md: string): number => md.split("\n").length - (md.endsWith("\n") ? 1 : 0);

/** `text` wrapped at WIDTH, the first line after `first`, the rest after `rest`. */
export function wrap(text: string, first = "", rest = first): string {
	const lines: string[] = [];
	let line = first;
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const prefix = lines.length ? rest : first;
		if (line.length > prefix.length && line.length + 1 + word.length > WIDTH) {
			lines.push(line);
			line = rest + word;
		} else line = line.length > prefix.length ? `${line} ${word}` : line + word;
	}
	lines.push(line);
	return lines.join("\n");
}

export function parseLessons(md: string): LessonsDoc {
	const lines = md.replace(/\r\n/g, "\n").split("\n");
	if (!lines[0]?.startsWith("# ")) throw new Error("lessons.md: the first line must be the `# ` title");
	const doc: LessonsDoc = { title: lines[0].slice(2).trim(), preamble: [], sections: [] };
	let paragraph: string[] = [];
	let section: LessonSection | undefined;
	const flush = () => {
		if (paragraph.length) doc.preamble.push(paragraph.join(" "));
		paragraph = [];
	};
	lines.slice(1).forEach((line, i) => {
		if (line.startsWith("## ")) {
			flush();
			section = { heading: line.slice(3).trim(), bullets: [] };
			doc.sections.push(section);
		} else if (!line.trim()) {
			if (!section) flush();
		} else if (!section) paragraph.push(line.trim());
		else if (line.startsWith("- ")) section.bullets.push(line.slice(2).trim());
		else if (line.startsWith("  ") && section.bullets.length) section.bullets[section.bullets.length - 1] += ` ${line.trim()}`;
		else throw new Error(`lessons.md line ${i + 2}: under a "## " heading, only "- " bullets and their two-space continuations`);
	});
	flush();
	return doc;
}

/** The file in its one layout: wrapped at WIDTH, a section without bullets left out. */
export function serializeLessons(doc: LessonsDoc): string {
	const parts = [`# ${doc.title}`, ...doc.preamble.map((p) => wrap(p))];
	for (const s of doc.sections) if (s.bullets.length) parts.push(`## ${s.heading}`, s.bullets.map((b) => wrap(b, "- ", "  ")).join("\n"));
	return `${parts.join("\n\n")}\n`;
}

interface Numbered {
	id: number;
	section: string;
	text: string;
}

const numbered = (doc: LessonsDoc): Numbered[] =>
	doc.sections.flatMap((s) => s.bullets.map((text) => ({ section: s.heading, text }))).map((b, i) => ({ id: i + 1, ...b }));

/** The headings the rest of the spec cites as (`lessons.md`, Heading): they must keep a lesson. */
export const citedHeadings = (spec: string, doc: LessonsDoc): string[] => {
	const cited = new Set([...spec.matchAll(/`lessons\.md`, ([^)]+)\)/g)].map((m) => (m[1] ?? "").trim()));
	return doc.sections.map((s) => s.heading).filter((h) => cited.has(h));
};

const STOP = new Set(
	"that this with from than then them they what when which were have each every into only more most also does their there about over after before where your until".split(" "),
);

/** A text's content words, a plural folded into its singular. */
function words(text: string): Set<string> {
	const out = new Set<string>();
	for (const w of text.toLowerCase().split(/[^a-z]+/)) {
		if (w.length < 4 || STOP.has(w)) continue;
		out.add(w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
	}
	return out;
}

/** The share of the shorter text's content words the other one also has. */
export function overlap(a: string, b: string): number {
	const x = words(a);
	const y = words(b);
	if (!x.size || !y.size) return 0;
	let both = 0;
	for (const w of x) if (y.has(w)) both += 1;
	return both / Math.min(x.size, y.size);
}

// ---------- operations

function str(v: unknown): string | null {
	return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** The ops in a reply, or null when it holds no `{"ops": [...]}`. Malformed ops are left out. */
export function parseOps(text: string): LessonOp[] | null {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	let obj: { ops?: unknown };
	try {
		obj = JSON.parse(text.slice(start, end + 1)) as { ops?: unknown };
	} catch {
		return null;
	}
	if (!Array.isArray(obj.ops)) return null;
	const ops: LessonOp[] = [];
	for (const raw of obj.ops as Record<string, unknown>[]) {
		const reason = str(raw?.reason);
		if (!reason) continue;
		const id = typeof raw.id === "number" && Number.isInteger(raw.id) ? raw.id : undefined;
		const text = str(raw.text);
		const section = str(raw.section);
		const fresh = raw.new_section === true ? { new_section: true } : {};
		if (raw.op === "add" && section && text) ops.push({ op: "add", section, text, reason, ...fresh, ...(raw.distinct === true ? { distinct: true } : {}) });
		else if (raw.op === "edit" && id !== undefined && (text || section)) {
			ops.push({ op: "edit", id, ...(text ? { text } : {}), ...(section ? { section } : {}), reason, ...fresh });
		} else if (raw.op === "drop" && id !== undefined) ops.push({ op: "drop", id, reason });
	}
	return ops;
}

/**
 * The ops that may be applied, and why the others may not. `scan` returns the held-out names in a text:
 * a lesson or heading naming one is rejected (a coder reads it); a reason is masked instead (no coder
 * does). `cited` are the headings the spec cites, which must keep at least one lesson.
 */
export async function checkOps(
	doc: LessonsDoc,
	ops: LessonOp[],
	scan: (text: string) => Promise<string[]>,
	cited: string[] = [],
): Promise<{ ok: LessonOp[]; rejected: Rejected[] }> {
	const ok: LessonOp[] = [];
	const rejected: Rejected[] = [];
	const bullets = numbered(doc);
	const byId = new Map(bullets.map((b) => [b.id, b]));
	const headings = new Set(doc.sections.map((s) => s.heading));
	const left = new Map(doc.sections.map((s) => [s.heading, s.bullets.length]));
	const touched = new Set<number>();
	const dropped = new Set<number>();
	let count = bullets.length;
	const textProblem = async (text: string, what: string, max: number): Promise<string | null> => {
		if (text.length > max) return `the ${what} is over ${max} characters: say it shorter`;
		if (METRIC_VALUE.test(text)) return `the ${what} holds a decimal or a percentage: a lesson carries no metric value; say what the change did in words`;
		const found = await scan(text);
		return found.length ? `the ${what} names evaluation items coders may not see: ${found.join(", ")}` : null;
	};
	// Adds last: a drop or a merge in the same reply makes room for them and stops matching as a duplicate.
	for (const op of [...ops.filter((o) => o.op !== "add"), ...ops.filter((o) => o.op === "add")]) {
		const problem = await (async () => {
			const from = op.op === "add" ? undefined : byId.get(op.id);
			if (op.op !== "add" && !from) return `no lesson [${op.id}]: ids run from 1 to ${bullets.length}`;
			if (op.op !== "add" && touched.has(op.id)) return `[${op.id}] already has an op: one op per lesson`;
			const section = op.op === "drop" ? undefined : op.section;
			if (section && !headings.has(section)) {
				if (!(op.op !== "drop" && op.new_section)) return `no section "${section}"; sections: ${[...headings].map((h) => `"${h}"`).join(", ")}. A new one needs "new_section": true`;
				const bad = await textProblem(section, "heading", HEADING_MAX_CHARS);
				if (bad) return bad;
			}
			const text = op.op === "drop" ? undefined : op.text;
			if (text) {
				const bad = await textProblem(text, "lesson", LESSON_MAX_CHARS);
				if (bad) return bad;
			}
			if (op.op !== "add" && from && (op.op === "drop" || (section && section !== from.section)) && cited.includes(from.section) && left.get(from.section) === 1) {
				return `[${op.id}] is the last lesson under "${from.section}", which the spec cites: edit it instead`;
			}
			if (op.op === "add" && !op.distinct) {
				const close = bullets.filter((b) => !dropped.has(b.id)).map((b) => ({ b, o: overlap(op.text, b.text) })).sort((x, y) => y.o - x.o)[0];
				if (close && close.o >= DUPLICATE_OVERLAP) {
					return `close to [${close.b.id}] ("${close.b.text.slice(0, 80)}..."): edit [${close.b.id}] to hold both, or add again with "distinct": true if it says what [${close.b.id}] does not`;
				}
			}
			if (op.op === "add" && count >= LESSON_CAP) return `lessons.md holds ${LESSON_CAP} lessons: merge two (edit one, drop the other) instead of adding`;
			return null;
		})();
		if (problem) {
			rejected.push({ op, problem });
			continue;
		}
		if (op.op === "add") count += 1;
		else {
			touched.add(op.id);
			const from = byId.get(op.id) as Numbered;
			if (op.op === "drop") {
				count -= 1;
				dropped.add(op.id);
				left.set(from.section, (left.get(from.section) ?? 0) - 1);
			} else if (op.section && op.section !== from.section) left.set(from.section, (left.get(from.section) ?? 0) - 1);
		}
		if (op.op !== "drop" && op.section && !headings.has(op.section)) headings.add(op.section);
		ok.push({ ...op, reason: mask(op.reason, await scan(op.reason)) });
	}
	return { ok, rejected };
}

/** The ops of a prune round: drops, and edits that shorten their lesson; then the usual gates. */
export async function checkPrune(
	doc: LessonsDoc,
	ops: LessonOp[],
	scan: (text: string) => Promise<string[]>,
	cited: string[] = [],
): Promise<{ ok: LessonOp[]; rejected: Rejected[] }> {
	const byId = new Map(numbered(doc).map((b) => [b.id, b]));
	const rejected: Rejected[] = [];
	const kept = ops.filter((op) => {
		const problem =
			op.op === "add" ? "a prune adds nothing: drop or shorten"
			: op.op === "edit" && op.text && byId.has(op.id) && op.text.length >= (byId.get(op.id)?.text.length ?? 0) ? `the edit of [${op.id}] is not shorter`
			: null;
		if (problem) rejected.push({ op, problem });
		return !problem;
	});
	const checked = await checkOps(doc, kept, scan, cited);
	return { ok: checked.ok, rejected: [...rejected, ...checked.rejected] };
}

/**
 * lessons.md after `ops`, which `checkOps` passed. Ids name the bullets as numbered before any op, so a
 * drop never shifts another op's target. A moved bullet goes to the end of its new section, an added
 * one too. A new section goes right after the section its first moved bullet left, else after the others.
 */
export function applyOps(doc: LessonsDoc, ops: LessonOp[]): LessonsDoc {
	const sections: LessonSection[] = doc.sections.map((s) => ({ heading: s.heading, bullets: [] }));
	const at = (heading: string, after?: string): LessonSection => {
		const found = sections.find((s) => s.heading === heading);
		if (found) return found;
		const fresh = { heading, bullets: [] };
		const i = after === undefined ? -1 : sections.findIndex((s) => s.heading === after);
		sections.splice(i < 0 ? sections.length : i + 1, 0, fresh);
		return fresh;
	};
	const byId = new Map(ops.flatMap((o) => (o.op === "add" ? [] : [[o.id, o] as const])));
	const moved: { section: string; from: string; text: string }[] = [];
	for (const b of numbered(doc)) {
		const op = byId.get(b.id);
		if (op?.op === "drop") continue;
		const text = (op?.op === "edit" && op.text) || b.text;
		const section = (op?.op === "edit" && op.section) || b.section;
		if (section === b.section) at(section).bullets.push(text);
		else moved.push({ section, from: b.section, text });
	}
	for (const m of moved) at(m.section, m.from).bullets.push(m.text);
	for (const op of ops) if (op.op === "add") at(op.section).bullets.push(op.text);
	return { ...doc, sections };
}

// ---------- what a night left

export interface NightRound {
	round: number;
	/** The experiments' notes: the loop's outcome, the coder's notes, the reviewer's verdict. */
	notes: string[];
	review?: { feedback: string; hypothesis: string };
}

const roundOf = (file: string): number => Number(/^r(\d+)/.exec(file)?.[1] ?? NaN);

/**
 * The rounds past `fromRound` of a night, from its notes and reviews only. Never `done.json`, a test
 * evaluation or the review prompts (diffs and per-item errors): nothing about test reaches a lesson.
 */
export function gatherNight(nightDir: string, fromRound = 0): NightRound[] {
	const rounds = new Map<number, NightRound>();
	const at = (n: number) => rounds.get(n) ?? (rounds.set(n, { round: n, notes: [] }).get(n) as NightRound);
	const notes = join(nightDir, "bundle", "history", "notes");
	if (existsSync(notes)) {
		for (const f of readdirSync(notes).filter((f) => f.endsWith(".md")).sort((a, b) => a.localeCompare(b, "en", { numeric: true }))) {
			const n = roundOf(f);
			if (n > fromRound) at(n).notes.push(readFileSync(join(notes, f), "utf8").trim());
		}
	}
	const reviews = join(nightDir, "reviews");
	if (existsSync(reviews)) {
		for (const f of readdirSync(reviews).filter((f) => /^r\d+\.json$/.test(f))) {
			const n = roundOf(f);
			if (!(n > fromRound)) continue;
			const r = JSON.parse(readFileSync(join(reviews, f), "utf8")) as { feedback?: string; hypothesis?: string };
			at(n).review = { feedback: r.feedback ?? "", hypothesis: r.hypothesis ?? "" };
		}
	}
	return [...rounds.values()].sort((a, b) => a.round - b.round);
}

/** The spec the night's coders read, without lessons.md, which the prompt shows apart. */
export function specWithoutLessons(bundleDir: string, lessonsFile: string): string {
	const dir = join(bundleDir, "spec");
	const skip = basename(lessonsFile);
	const first = (f: string) => Number(f === "task.md");
	return readdirSync(dir)
		.filter((f) => f.endsWith(".md") && f !== skip)
		.sort((a, b) => first(b) - first(a) || a.localeCompare(b))
		.map((f) => readFileSync(join(dir, f), "utf8").trim())
		.join("\n\n---\n\n");
}

// ---------- the model call

const SYSTEM_PROMPT = `You keep lessons.md for one scenario of an automated coding loop. Each night, coding agents get a spec,
a starter repository and train data, and try for several rounds to raise the scores of the system they
build; a reviewer reads each round's dev scores and errors and says what to try next. A night starts from
the spec again, so lessons.md is the only memory between nights: every coder reads it before planning.

It is a scratchpad kept current, not a log. You read one night's rounds (the coders' notes and the
reviewer's verdicts) and edit lessons.md so it says what all nights so far have shown, as briefly as that
can be said:
- A lesson the night only repeats needs no op. Never add what a lesson already says.
- A lesson the night refines, narrows or extends: edit it.
- Two lessons that say one thing: edit one to say both, drop the other.
- A lesson the night shows wrong: drop it, or edit it to what holds now. Never leave a lesson standing
	beside one that says the opposite: resolve the conflict in one lesson.
- Add only what neither lessons.md nor the spec already says.
- lessons.md holds at most ${LINE_CAP} lines. When your ops would pass that, you are asked to cut it:
	drop the lessons a later coder gains least from, or shorten long ones.
- A failure only one night showed goes under a heading that says so, such as "Failed once, not yet
	confirmed"; when a later night repeats it, move it (edit with a section) to the main heading.

What a lesson says:
- A change (an algorithm, a prompt, a parameter, a way to measure on train) and what it did, in words, so
	a later coder can skip a dead end or start from what worked.
- What the night measured, not what it guessed: a hypothesis nobody tested is not a lesson.
- No score, metric value, decimal or percentage, and no dev or test item: no document, query, entity or
	name that only dev or test holds. Describe kinds of error. Names the spec itself uses are fine.
- You never see test, and nothing you write may be about it.
- One to three plain sentences, under ${LESSON_MAX_CHARS} characters.

The reason on each op is for the people who review your edit, never for coders: the round and what
happened there. It may cite numbers. An empty list is a good answer for a night that taught nothing new.

Return only JSON: {"ops": [...]}, each op one of
{"op": "add", "section": "<heading>", "text": "...", "reason": "..."}
{"op": "edit", "id": 4, "text": "...", "section": "<heading, to move it>", "reason": "..."}  (text, section or both)
{"op": "drop", "id": 4, "reason": "..."}
Ids are the bracketed numbers in the listing. At most one op per id. Use a heading lessons.md has; a new
one needs "new_section": true on its op.`;

export interface DistillInput {
	model: string;
	thinking: Thinking;
	mock: boolean;
	signal?: AbortSignal;
	nightId: string;
	spec: string;
	doc: LessonsDoc;
	rounds: NightRound[];
}

/** lessons.md with its bullets numbered for ops. */
function listing(doc: LessonsDoc): string {
	const ids = numbered(doc);
	return [
		`# ${doc.title}`,
		...doc.preamble,
		...doc.sections
			.filter((s) => s.bullets.length)
			.map((s) => [`## ${s.heading}`, ...ids.filter((b) => b.section === s.heading).map((b) => `[${b.id}] ${b.text}`)].join("\n")),
	].join("\n\n");
}

export function distillPrompt(input: Pick<DistillInput, "nightId" | "spec" | "doc" | "rounds">): string {
	const lessons = numbered(input.doc).length;
	const lines = lineCount(serializeLessons(input.doc));
	const rounds = input.rounds
		.map((r) =>
			[
				`### Round ${r.round}`,
				...r.notes,
				...(r.review ? [`Reviewer's feedback after the round:\n${r.review.feedback}`, `Reviewer's next hypothesis:\n${r.review.hypothesis}`] : []),
			].join("\n\n"),
		)
		.join("\n\n");
	return [
		`## The spec the coders had (lessons.md apart)\n\n${input.spec}`,
		`## lessons.md now (${lessons} of at most ${LESSON_CAP} lessons, ${lines} of at most ${LINE_CAP} lines; numbered for your ops)\n\n${listing(input.doc)}`,
		`## Night ${input.nightId}\n\n${rounds}`,
		'Return only the JSON object {"ops": [...]}.',
	].join("\n\n");
}

/** A prune round's prompt: lessons.md after the night's ops, numbered afresh. */
export const prunePrompt = (doc: LessonsDoc): string =>
	`lessons.md after your ops is ${lineCount(serializeLessons(doc))} lines; it may hold at most ${LINE_CAP}. Cut it to fit: drop the ` +
	"lessons a later coder gains least from (narrow, rarely relevant, implied by the spec or by another lesson), or shorten long ones. " +
	`The bullets are numbered afresh below. Reply with only the JSON object {"ops": [...]}: drop ops, and edit ops whose text is shorter.\n\n${listing(doc)}`;

export interface DistillOutput {
	ops: LessonOp[];
	rejected: Rejected[];
	/** Prune rounds' ops, in order; each round's ids number the file after the ops before it. */
	prune: LessonOp[][];
	pruneRejected: Rejected[];
	/** Lines of lessons.md after every op: over LINE_CAP, the proposal is never applied. */
	lines: number;
	usd: number;
	tokens: number;
}

/** lessons.md after a distillation's ops and its prune rounds. */
export const afterOps = (doc: LessonsDoc, out: Pick<DistillOutput, "ops" | "prune">): LessonsDoc =>
	out.prune.reduce((d, ops) => applyOps(d, ops), applyOps(doc, out.ops));

/**
 * The distillation's conversation over `ask` (one model turn → the ops it parsed, or null): ops for the night,
 * gated; one rewrite of the ops the gates rejected; then, while the file is over LINE_CAP, up to PRUNE_ROUNDS
 * rounds of drops and shortening edits.
 */
export async function distillWith(
	ask: (text: string) => Promise<LessonOp[] | null>,
	input: Pick<DistillInput, "nightId" | "spec" | "doc" | "rounds">,
	scan: (text: string) => Promise<string[]>,
): Promise<Omit<DistillOutput, "usd" | "tokens">> {
	const cited = citedHeadings(input.spec, input.doc);
	let ops = await ask(distillPrompt(input));
	if (!ops) ops = await ask('Reply again with only the JSON object {"ops": [...]}.');
	if (!ops) throw new Error("the lessons model returned no parsable JSON twice");
	let checked = await checkOps(input.doc, ops, scan, cited);
	if (checked.rejected.length) {
		const why = checked.rejected.map((r) => `- ${JSON.stringify(r.op)}: ${r.problem}`).join("\n");
		const again = await ask(`These ops were rejected:\n${why}\nReply with the whole corrected JSON object {"ops": [...]}: fix or drop each rejected op, keep the others.`);
		if (again) checked = await checkOps(input.doc, again, scan, cited);
	}
	const prune: LessonOp[][] = [];
	const pruneRejected: Rejected[] = [];
	let doc = applyOps(input.doc, checked.ok);
	for (let round = 0; round < PRUNE_ROUNDS && lineCount(serializeLessons(doc)) > LINE_CAP; round += 1) {
		const ops = (await ask(prunePrompt(doc))) ?? [];
		const pruned = await checkPrune(doc, ops, scan, citedHeadings(input.spec, doc));
		pruneRejected.push(...pruned.rejected);
		if (!pruned.ok.length) continue;
		prune.push(pruned.ok);
		doc = applyOps(doc, pruned.ok);
	}
	return { ops: checked.ok, rejected: checked.rejected, prune, pruneRejected, lines: lineCount(serializeLessons(doc)) };
}

/** One distillation on the reviewer's model, in an in-memory session with no tools. */
export async function runDistill(input: DistillInput, scan: (text: string) => Promise<string[]> = async () => []): Promise<DistillOutput> {
	const session = await openSession({ model: await sessionModel(input.model, "lessons", input.mock), thinking: input.thinking, cwd: "/", systemPrompt: SYSTEM_PROMPT });
	let usd = 0;
	let tokens = 0;
	let creditError: string | undefined;
	session.subscribe((e) => {
		if (e.type === "message_end" && e.message.role === "assistant") {
			usd += e.message.usage?.cost?.total ?? 0;
			tokens += e.message.usage?.totalTokens ?? 0;
			const error = e.message.errorMessage;
			if (e.message.stopReason === "error" && error && isCreditMessage(error)) creditError = error;
		}
	});
	const onAbort = () => void session.abort();
	input.signal?.addEventListener("abort", onAbort, { once: true });
	const ask = async (text: string) => {
		input.signal?.throwIfAborted();
		await session.prompt(text);
		// No pause after a night: the distillation fails, and the step's retries run it again.
		if (creditError) throw new Error(`out of credits on ${input.model}: ${creditError}`);
		return parseOps(session.getLastAssistantText() ?? "");
	};
	try {
		return { ...(await distillWith(ask, input, scan)), usd, tokens };
	} finally {
		input.signal?.removeEventListener("abort", onAbort);
		session.dispose();
	}
}

// ---------- proposals

export interface Proposal extends DistillOutput {
	nightId: string;
	fromRound: number;
	lastRound: number;
	/** The lessons.md the ops were computed against: applying over a newer one is refused. */
	base_sha256: string;
	/** The new lessons.md. */
	lessons: string;
	/** The ops for a reviewer, each with the lesson it changes. */
	changes: string;
}

/** A mock night's results sit under runs/mock/: its proposals are never applied. */
export const isMockConfig = (cfg: NightConfig) => cfg.results_path.startsWith("runs/mock/");

export function lessonsFile(root: string, cfg: NightConfig): string {
	if (!cfg.scenario_spec.lessons) throw new Error(`scenario ${cfg.scenario_spec.name} declares no lessons`);
	return join(root, cfg.scenario, cfg.scenario_spec.lessons);
}

const proposalsRoot = (root: string, cfg: NightConfig): string => join(nightPaths(root, cfg.results_path, "_").resultsDir, "lessons");

export const proposalDir = (root: string, cfg: NightConfig, nightId: string, lastRound: number): string => join(proposalsRoot(root, cfg), `${nightId}-r${lastRound}`);

/** A night's proposals, oldest first, with the last round each covers. */
export function proposalsOf(root: string, cfg: NightConfig, nightId: string): { dir: string; lastRound: number; applied: boolean }[] {
	const base = proposalsRoot(root, cfg);
	if (!existsSync(base)) return [];
	const name = new RegExp(`^${nightId.replace(/\W/g, "\\$&")}-r(\\d+)$`);
	return readdirSync(base)
		.flatMap((d) => {
			const m = name.exec(d);
			const meta = join(base, d, "proposal.json");
			if (!m || !existsSync(meta)) return [];
			return [{ dir: join(base, d), lastRound: Number(m[1]), applied: (JSON.parse(readFileSync(meta, "utf8")) as { applied?: boolean }).applied === true }];
		})
		.sort((a, b) => a.lastRound - b.lastRound);
}

/** The last round of a night whose lessons are in lessons.md: the newest applied proposal's; 0 for none. */
export const distilledThrough = (root: string, cfg: NightConfig, nightId: string): number =>
	Math.max(0, ...proposalsOf(root, cfg, nightId).filter((p) => p.applied).map((p) => p.lastRound));

/** How many of a night's rounds hold notes or reviews that no applied proposal covers yet. */
export const pendingRounds = (root: string, cfg: NightConfig, nightId: string): number =>
	gatherNight(nightPaths(root, cfg.results_path, nightId).nightDir, distilledThrough(root, cfg, nightId)).length;

/** Whether a night distills lessons when it ends: the mode is not `off` and the scenario declares lessons. */
export const lessonsOn = (cfg: NightConfig): boolean => cfg.lessons !== "off" && !!cfg.scenario_spec.lessons;

/** The ops for a reviewer, each edit and drop with the lesson as it was. */
function describeOps(doc: LessonsDoc, ops: LessonOp[]): string {
	const byId = new Map(numbered(doc).map((b) => [b.id, b]));
	const was = (id: number) => `[${id}] under "${byId.get(id)?.section}": ${byId.get(id)?.text}`;
	const lines = ops.map((op) => {
		if (op.op === "add") return `- add under "${op.section}": ${op.text}\n  reason: ${op.reason}`;
		if (op.op === "drop") return `- drop ${was(op.id)}\n  reason: ${op.reason}`;
		const to = [op.section ? `move to "${op.section}"` : "", op.text ? `now: ${op.text}` : ""].filter(Boolean).join("; ");
		return `- edit ${was(op.id)}\n  ${to}\n  reason: ${op.reason}`;
	});
	return lines.join("\n") || "(none)";
}

const describeRejected = (rejected: Rejected[]): string => rejected.map((r) => `- ${JSON.stringify(r.op)}\n  ${r.problem}`).join("\n");

function describe(doc: LessonsDoc, out: DistillOutput): string {
	const parts = [`## Changes\n\n${describeOps(doc, out.ops)}`];
	if (out.rejected.length) parts.push(`## Rejected twice\n\n${describeRejected(out.rejected)}`);
	let at = applyOps(doc, out.ops);
	out.prune.forEach((ops, i) => {
		parts.push(`## Pruned to fit ${LINE_CAP} lines, round ${i + 1}\n\n${describeOps(at, ops)}`);
		at = applyOps(at, ops);
	});
	if (out.pruneRejected.length) parts.push(`## Prune ops rejected\n\n${describeRejected(out.pruneRejected)}`);
	if (out.lines > LINE_CAP) parts.push(`## Over the cap\n\nlessons.md would be ${out.lines} lines, over ${LINE_CAP}: this proposal is never applied. Prune lessons.md by hand and distill again.`);
	return `${parts.join("\n\n")}\n`;
}

/**
 * A night's proposal, or null when nothing is new: no round past the last applied proposal from it, or a
 * proposal folder for its last such round already there, applied or not. An unapplied proposal's rounds are
 * distilled again once a later round adds to them.
 */
export async function proposeLessons(root: string, cfg: NightConfig, nightId: string, scan: (text: string) => Promise<string[]>, signal?: AbortSignal): Promise<Proposal | null> {
	const file = lessonsFile(root, cfg);
	const baseText = readFileSync(file, "utf8");
	const doc = parseLessons(baseText);
	const fromRound = distilledThrough(root, cfg, nightId);
	const night = nightPaths(root, cfg.results_path, nightId);
	const rounds = gatherNight(night.nightDir, fromRound);
	const last = rounds.at(-1);
	if (!last) return null;
	const lastRound = last.round;
	if (existsSync(proposalDir(root, cfg, nightId, lastRound))) return null;
	const out = await runDistill(
		{ model: cfg.reviewer_model, thinking: cfg.reviewer_thinking, mock: isMockConfig(cfg), ...(signal ? { signal } : {}), nightId, spec: specWithoutLessons(night.bundle, file), doc, rounds },
		scan,
	);
	return { nightId, fromRound, lastRound, base_sha256: sha256(baseText), ...out, lessons: serializeLessons(afterOps(doc, out)), changes: describe(doc, out) };
}

/** Writes the proposal under the results directory; with `apply`, the scenario's lessons.md too, never from a mock night. */
export function writeProposal(root: string, cfg: NightConfig, p: Proposal, apply: boolean): { dir: string; applied: boolean } {
	const dir = proposalDir(root, cfg, p.nightId, p.lastRound);
	mkdirSync(dir, { recursive: true });
	const { lessons, changes, ...meta } = p;
	writeFileSync(join(dir, "lessons.md"), lessons);
	writeFileSync(join(dir, "changes.md"), `# Lessons from ${p.nightId}, rounds ${p.fromRound + 1}-${p.lastRound}\n\n${changes}`);
	writeFileSync(join(dir, "proposal.json"), `${JSON.stringify({ ...meta, applied: false }, null, 2)}\n`);
	if (!apply || isMockConfig(cfg) || p.lines > LINE_CAP) return { dir, applied: false };
	applyProposal(root, cfg, dir);
	return { dir, applied: true };
}

/** Writes a proposal's lessons.md into the scenario; refused for a mock night, when the scenario's file moved since, or over LINE_CAP. Never commits. */
export function applyProposal(root: string, cfg: NightConfig, dir: string): void {
	if (isMockConfig(cfg)) throw new Error(`${dir} comes from a mock night: its lessons are never applied`);
	const file = lessonsFile(root, cfg);
	const metaFile = join(dir, "proposal.json");
	const meta = JSON.parse(readFileSync(metaFile, "utf8")) as Omit<Proposal, "lessons" | "changes"> & { applied?: boolean };
	if (sha256(readFileSync(file, "utf8")) !== meta.base_sha256) throw new Error(`${file} changed since ${dir} was proposed: distill the night again`);
	const next = readFileSync(join(dir, "lessons.md"), "utf8");
	if (lineCount(next) > LINE_CAP) throw new Error(`${dir}/lessons.md is ${lineCount(next)} lines, over ${LINE_CAP}: prune lessons.md by hand and distill again`);
	writeFileSync(file, next);
	writeFileSync(metaFile, `${JSON.stringify({ ...meta, applied: true }, null, 2)}\n`);
}
