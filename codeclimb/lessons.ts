// Lessons across nights. A night's notes and reviews die with its bundle: the next night exports a new
// one from the scenario's spec. After each night a model reads what the night left (the coders' notes and
// the reviewer's verdicts, never anything from test) and proposes operations on the scenario's ledger of
// lessons: add one, support or contradict one, reword or retire one. Code applies them, and the
// scenario's lessons.md, which ships in every later bundle, is rendered from the ledger.
//
// What a coder reads is gated: no held-out name (the scenario's `scan`), no decimal or percentage (every
// dev metric is one), a length and a size cap. The evidence behind a lesson stays in the ledger, which no
// coder reads, with held-out names masked.
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { NightConfig, ThinkingLevel } from "./config";
import { isCreditError } from "./credits";
import { nightPaths } from "./paths";
import { createIsolatedSession } from "./pi/session";
import { maskTerms } from "./scenario";

export interface LessonSection {
  id: string;
  heading: string;
  /** Heading for this section's lessons that only one night supports: the main heading claims more. */
  once?: string;
}

export interface Evidence {
  night: string;
  round?: number;
  note: string;
}

export interface Lesson {
  id: string;
  section: string;
  text: string;
  status: "active" | "retired";
  support: Evidence[];
  contradict: Evidence[];
  /** Earlier wordings, oldest first. */
  history?: { night: string; text: string }[];
  retired?: Evidence;
}

export interface Ledger {
  title: string;
  preamble: string;
  sections: LessonSection[];
  lessons: Lesson[];
  /** Night id → the last round distilled from it: a continued night adds only its new rounds. */
  nights: Record<string, number>;
}

export type LessonOp =
  | { op: "add"; section: string; text: string; evidence: string; round?: number }
  | { op: "support" | "contradict" | "retire"; id: string; evidence: string; round?: number }
  | { op: "reword"; id: string; text: string; evidence: string; round?: number };

export interface Rejected {
  op: LessonOp;
  why: string;
}

/** Active lessons at most: past it, an `add` must come with a merge or a retirement. */
export const LESSON_CAP = 30;
export const LESSON_MAX_CHARS = 400;
const WIDTH = 100;
/** A decimal or a percentage: the shape of every metric value, which a coder must not read. A version in a name (`jev-1.14`) is neither. */
const METRIC_VALUE = /(?<![\w.-])\d+\.\d+(?![\w-]|\.\w)|\d+\s*%/;

// ---------- the ledger and its rendering

export function parseLedger(text: string): Ledger {
  const l = JSON.parse(text) as Ledger;
  if (typeof l.title !== "string" || !Array.isArray(l.sections) || !Array.isArray(l.lessons)) throw new Error("lessons ledger: needs title, sections and lessons");
  return { ...l, nights: l.nights ?? {} };
}

export const ledgerText = (l: Ledger): string => `${JSON.stringify(l, null, 2)}\n`;
export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

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

/** Tells whoever edits lessons.md by hand that the next night's distillation overwrites it. */
export const RENDERED = "<!-- Rendered from the lessons ledger (codeclimb/lessons.ts): edit the ledger, not this file. -->";

const nightsOf = (l: Lesson): number => new Set(l.support.map((e) => e.night)).size;

/** The coder's lessons.md: active lessons per section, those one night supports apart when the section says so. */
export function renderLessons(l: Ledger): string {
  const parts = [`# ${l.title}`, RENDERED, wrap(l.preamble)];
  const block = (heading: string, lessons: Lesson[]) => {
    if (lessons.length) parts.push(`## ${heading}`, lessons.map((x) => wrap(x.text, "- ", "  ")).join("\n"));
  };
  for (const s of l.sections) {
    const active = l.lessons.filter((x) => x.section === s.id && x.status === "active");
    block(s.heading, s.once ? active.filter((x) => nightsOf(x) > 1) : active);
    if (s.once) block(s.once, active.filter((x) => nightsOf(x) <= 1));
  }
  return `${parts.join("\n\n")}\n`;
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
    const evidence = str(raw?.evidence);
    const round = typeof raw?.round === "number" ? raw.round : undefined;
    const at = round === undefined ? {} : { round };
    if (!evidence) continue;
    if (raw.op === "add" && str(raw.section) && str(raw.text)) ops.push({ op: "add", section: str(raw.section)!, text: str(raw.text)!, evidence, ...at });
    else if (raw.op === "reword" && str(raw.id) && str(raw.text)) ops.push({ op: "reword", id: str(raw.id)!, text: str(raw.text)!, evidence, ...at });
    else if ((raw.op === "support" || raw.op === "contradict" || raw.op === "retire") && str(raw.id)) ops.push({ op: raw.op, id: str(raw.id)!, evidence, ...at });
  }
  return ops;
}

/**
 * The ops that may be applied, and why the others may not. `scan` returns the held-out names in a text:
 * a lesson's text naming one is rejected (a coder reads it); its evidence is masked instead (no coder does).
 */
export async function checkOps(
  ledger: Ledger,
  ops: LessonOp[],
  scan: (text: string) => Promise<string[]>,
): Promise<{ ok: LessonOp[]; rejected: Rejected[] }> {
  const ok: LessonOp[] = [];
  const rejected: Rejected[] = [];
  const active = new Map(ledger.lessons.filter((x) => x.status === "active").map((x) => [x.id, x]));
  const sections = new Set(ledger.sections.map((s) => s.id));
  let count = active.size;
  for (const op of ops) {
    const why = await (async () => {
      if (op.op !== "add" && !active.has(op.id)) return `no active lesson ${op.id}`;
      if (op.op === "add" && !sections.has(op.section)) return `no section ${op.section}; sections: ${[...sections].join(", ")}`;
      if (op.op === "add" || op.op === "reword") {
        if (op.text.length > LESSON_MAX_CHARS) return `over ${LESSON_MAX_CHARS} characters: say it shorter`;
        if (METRIC_VALUE.test(op.text)) return "holds a decimal or a percentage: a lesson carries no metric value; say what the change did in words";
        const found = await scan(op.text);
        if (found.length) return `names evaluation items coders may not see: ${found.join(", ")}`;
      }
      if (op.op === "add" && count >= LESSON_CAP) return `the ledger holds ${LESSON_CAP} active lessons: merge (reword one, retire another) instead of adding`;
      return null;
    })();
    if (why) {
      rejected.push({ op, why });
      continue;
    }
    if (op.op === "add") count += 1;
    if (op.op === "retire") count -= 1;
    ok.push({ ...op, evidence: maskTerms(op.evidence, await scan(op.evidence)) });
  }
  return { ok, rejected };
}

/** The ledger after `ops`, which `checkOps` passed. One night supports or contradicts a lesson once. */
export function applyOps(ledger: Ledger, ops: LessonOp[], nightId: string, lastRound: number): Ledger {
  const lessons = ledger.lessons.map((x) => ({ ...x, support: [...x.support], contradict: [...x.contradict], ...(x.history ? { history: [...x.history] } : {}) }));
  const byId = new Map(lessons.map((x) => [x.id, x]));
  let next = Math.max(0, ...lessons.map((x) => Number(x.id.replace(/\D/g, "")) || 0)) + 1;
  for (const op of ops) {
    const ev: Evidence = { night: nightId, ...(op.round === undefined ? {} : { round: op.round }), note: op.evidence };
    if (op.op === "add") {
      const lesson: Lesson = { id: `L${String(next++).padStart(3, "0")}`, section: op.section, text: op.text, status: "active", support: [ev], contradict: [] };
      lessons.push(lesson);
      byId.set(lesson.id, lesson);
      continue;
    }
    const lesson = byId.get(op.id);
    if (!lesson) continue;
    if (op.op === "support" || op.op === "contradict") {
      const list = lesson[op.op];
      if (!list.some((e) => e.night === nightId)) list.push(ev);
    } else if (op.op === "reword") {
      lesson.history = [...(lesson.history ?? []), { night: nightId, text: lesson.text }];
      lesson.text = op.text;
      if (!lesson.support.some((e) => e.night === nightId)) lesson.support.push(ev);
    } else {
      lesson.status = "retired";
      lesson.retired = ev;
    }
  }
  return { ...ledger, lessons, nights: { ...ledger.nights, [nightId]: Math.max(lastRound, ledger.nights[nightId] ?? 0) } };
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
  const at = (n: number) => rounds.get(n) ?? rounds.set(n, { round: n, notes: [] }).get(n)!;
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

/** The spec the night's coders read, without the lessons file the ledger renders. */
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

const SYSTEM_PROMPT = `You keep a ledger of lessons for one scenario of an automated coding loop. Each night, coding agents get
a spec, a starter repository and train data, and try for several rounds to raise the scores of the system
they build; a reviewer reads each round's dev scores and errors and says what to try next. A night starts
from the spec again, so the ledger is how one night's experience reaches the next: every coder reads its
lessons before planning.

You read one night's rounds (the coders' notes and the reviewer's verdicts) and propose operations on the
ledger. A good lesson names a change (an algorithm, a prompt, a parameter, a way to measure on train) and
what it did, in words, so a later coder can skip a dead end or start from what worked.

Rules:
- A lesson carries no score, metric value, decimal or percentage, and no dev or test item: no document,
  query, entity or name that only dev or test holds. Describe kinds of error. Names the spec itself uses are fine.
- You never see test, and nothing you write may be about it.
- Prefer support or contradict on an existing lesson over adding a near-duplicate. Add only what neither the
  ledger nor the spec already says. Reword to merge two lessons into one, then retire the other.
- Retire a lesson only when the night's evidence shows it wrong, and say how.
- Record what the night showed, not what it guessed: a hypothesis nobody measured is not a lesson.
- A lesson is one or two plain sentences, under ${LESSON_MAX_CHARS} characters.
- Evidence is for the ledger's maintainers, never for coders: the round and what happened there. It may cite numbers.
- An empty list is a good answer for a night that taught nothing new.

Return only JSON: {"ops": [...]}, each op one of
{"op": "add", "section": "<section id>", "text": "...", "evidence": "...", "round": 3}
{"op": "support" | "contradict" | "retire", "id": "L004", "evidence": "...", "round": 3}
{"op": "reword", "id": "L004", "text": "...", "evidence": "...", "round": 3}`;

export interface DistillInput {
  model: string;
  thinkingLevel: ThinkingLevel;
  mock?: boolean;
  nightId: string;
  spec: string;
  ledger: Ledger;
  rounds: NightRound[];
}

export function distillPrompt(input: DistillInput): string {
  const sections = input.ledger.sections.map((s) => `- ${s.id}: "${s.heading}"`).join("\n");
  const lessons = input.ledger.lessons
    .filter((x) => x.status === "active")
    .map((x) => `- ${x.id} [${x.section}; ${nightsOf(x)} night(s) support, ${new Set(x.contradict.map((e) => e.night)).size} contradict] ${x.text}`)
    .join("\n");
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
    `## The spec the coders had (lessons excluded)\n\n${input.spec}`,
    `## Ledger sections\n${sections}`,
    `## Active lessons (${input.ledger.lessons.filter((x) => x.status === "active").length} of at most ${LESSON_CAP})\n${lessons || "(none)"}`,
    `## Night ${input.nightId}\n\n${rounds}`,
    'Return only the JSON object {"ops": [...]}.',
  ].join("\n\n");
}

export interface DistillOutput {
  ops: LessonOp[];
  rejected: Rejected[];
  usd: number;
  tokens: number;
}

/** One distillation: ops for the night, gated; one rewrite of the ops the gates rejected. */
export async function runDistill(input: DistillInput, scan: (text: string) => Promise<string[]> = async () => []): Promise<DistillOutput> {
  const session = await createIsolatedSession({
    model: input.model,
    mock: input.mock ? "lessons" : undefined,
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
  const ask = async (text: string) => {
    await session.prompt(text);
    // No pause after a night: the function fails, and Inngest retries it.
    if (creditError) throw new Error(`out of credits on ${input.model}: ${creditError}`);
    return parseOps(session.getLastAssistantText() ?? "");
  };
  try {
    let ops = await ask(distillPrompt(input));
    if (!ops) ops = await ask('Reply again with only the JSON object {"ops": [...]}.');
    if (!ops) throw new Error("the lessons model returned no parsable JSON twice");
    let checked = await checkOps(input.ledger, ops, scan);
    if (checked.rejected.length) {
      const why = checked.rejected.map((r) => `- ${JSON.stringify(r.op)}: ${r.why}`).join("\n");
      const again = await ask(`These ops were rejected:\n${why}\nReply with the whole corrected JSON object {"ops": [...]}: fix or drop each rejected op, keep the others.`);
      if (again) checked = await checkOps(input.ledger, again, scan);
    }
    return { ops: checked.ok, rejected: checked.rejected, usd, tokens };
  } finally {
    session.dispose();
  }
}

// ---------- proposals

export interface Proposal {
  nightId: string;
  fromRound: number;
  lastRound: number;
  /** The scenario ledger the ops were computed against: applying over a newer one is refused. */
  base_sha256: string;
  ops: LessonOp[];
  rejected: Rejected[];
  usd: number;
  tokens: number;
  ledger: Ledger;
}

export function lessonPaths(cfg: NightConfig) {
  const l = cfg.scenario.lessons;
  if (!l) throw new Error(`scenario ${cfg.scenario.name} declares no lessons`);
  return { file: join(cfg.scenario_dir, l.file), ledger: join(cfg.scenario_dir, l.ledger) };
}

export const proposalDir = (cfg: NightConfig, nightId: string, lastRound: number): string =>
  join(nightPaths(cfg, nightId).root, "lessons", `${nightId}-r${lastRound}`);

/** Whether a night distills lessons when it ends. A night saved before lessons existed has no mode. */
export const lessonsOn = (cfg: NightConfig): boolean => (cfg.lessons === "propose" || cfg.lessons === "apply") && !!cfg.scenario.lessons;

/** The sha256 of the lessons.md in a night's bundle: which lessons its coders read. */
export function bundleLessonsSha(cfg: NightConfig, bundleDir: string): string | null {
  const file = cfg.scenario.lessons && join(bundleDir, "spec", basename(cfg.scenario.lessons.file));
  return file && existsSync(file) ? sha256(readFileSync(file, "utf8")) : null;
}

/**
 * The config of a night that stopped before it finished, from its night.json, or null when it finished
 * (its finish sent the lessons event) or isn't on this worker's disk. Found the way `markStopped` finds it.
 */
export function stoppedNight(nightId: string): NightConfig | null {
  const runs = join(process.env.CODECLIMB_ROOT ?? process.cwd(), "runs");
  if (!existsSync(runs)) return null;
  for (const scenario of readdirSync(runs)) {
    const dir = join(runs, scenario, "nights", nightId);
    if (existsSync(join(dir, "night.json")) && !existsSync(join(dir, "done.json"))) {
      return (JSON.parse(readFileSync(join(dir, "night.json"), "utf8")) as { config: NightConfig }).config;
    }
  }
  return null;
}

export const readLedger = (cfg: NightConfig): Ledger => parseLedger(readFileSync(lessonPaths(cfg).ledger, "utf8"));

/**
 * A night's proposal, or null when nothing is new: no round past what the ledger already holds from it,
 * or a proposal for these rounds already written.
 */
export async function proposeLessons(cfg: NightConfig, nightId: string, scan: (text: string) => Promise<string[]>): Promise<Proposal | null> {
  const paths = lessonPaths(cfg);
  const baseText = readFileSync(paths.ledger, "utf8");
  const ledger = parseLedger(baseText);
  const fromRound = ledger.nights[nightId] ?? 0;
  const night = nightPaths(cfg, nightId);
  const rounds = gatherNight(night.nightDir, fromRound);
  if (!rounds.length) return null;
  const lastRound = rounds.at(-1)!.round;
  if (existsSync(join(proposalDir(cfg, nightId, lastRound), "proposal.json"))) return null;
  const out = await runDistill(
    { model: cfg.reviewer_model, thinkingLevel: cfg.reviewer_thinking, mock: cfg.mock, nightId, spec: specWithoutLessons(night.bundleDir, paths.file), ledger, rounds },
    scan,
  );
  return { nightId, fromRound, lastRound, base_sha256: sha256(baseText), ...out, ledger: applyOps(ledger, out.ops, nightId, lastRound) };
}

/** Writes the proposal beside the night's runs; with `apply`, the scenario's ledger and lessons.md too, never from a mock night. */
export function writeProposal(cfg: NightConfig, p: Proposal, apply: boolean): { dir: string; applied: boolean } {
  const dir = proposalDir(cfg, p.nightId, p.lastRound);
  mkdirSync(dir, { recursive: true });
  const { ledger, ...meta } = p;
  writeFileSync(join(dir, "lessons.json"), ledgerText(ledger));
  writeFileSync(join(dir, "lessons.md"), renderLessons(ledger));
  writeFileSync(join(dir, "proposal.json"), `${JSON.stringify(meta, null, 2)}\n`);
  if (!apply || cfg.mock) return { dir, applied: false };
  applyProposal(cfg, dir);
  return { dir, applied: true };
}

/** Writes a proposal's ledger and lessons.md into the scenario, unless its ledger moved since. */
export function applyProposal(cfg: NightConfig, dir: string): void {
  const paths = lessonPaths(cfg);
  const meta = JSON.parse(readFileSync(join(dir, "proposal.json"), "utf8")) as Omit<Proposal, "ledger">;
  const now = sha256(readFileSync(paths.ledger, "utf8"));
  if (now !== meta.base_sha256) throw new Error(`${paths.ledger} changed since ${dir} was proposed: distill the night again`);
  const ledger = parseLedger(readFileSync(join(dir, "lessons.json"), "utf8"));
  writeFileSync(paths.ledger, ledgerText(ledger));
  writeFileSync(paths.file, renderLessons(ledger));
}
