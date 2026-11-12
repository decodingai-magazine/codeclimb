// One experiment's coder: a Pi session whose tools act in a fresh sandbox from the checkpoint, then one squash
// commit into the experiment repository (spec: Coder; End of an experiment).
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { NightConfig } from "../config.ts";
import { ExperimentRepo } from "../experiments.ts";
import { readJson, writeJson } from "../night/files.ts";
import { type CreditStop, isCreditMessage } from "../night/pause.ts";
import { NonRetriableError } from "../runtime/step.ts";
import { sessionModel } from "../pi/models.ts";
import { openSession } from "../pi/session.ts";
import { originRepo } from "../pi/web.ts";
import { serverRoot } from "../night/types.ts";
import { traceSession, tracedSandbox } from "../spans.ts";
import type { Sandbox, SandboxBackend } from "../sandbox/types.ts";
import { PARENT_BUNDLE, pullCommit } from "../sandbox/transfer.ts";
import { coderPrompt, targetLines } from "./prompt.ts";
import type { Ledger } from "../meter/ledger.ts";
import { closeLedger, openLedger, proxyPort } from "../meter/proxy.ts";
import { ensureMeterPath, METER_NETWORK, meterEnv } from "../meter/relay.ts";
import { inReserve, MIN_MINUTES_LEFT, RESERVE_SHARE, sendBackMessage, WRAP_UP } from "./sendback.ts";

export type CoderStop = "done" | "timeout" | "idle" | "budget" | "agent_error" | "credits" | "cancelled";

export const IDLE_QUIET_MS = 10 * 60_000;
export const IDLE_TOOL_MS = 25 * 60_000;
const IDLE_CHECK_MS = 30_000;
export const NOTES_CHARS = 3000;
export const APPROACH_CHARS = 300;
export const CLOSING_CHARS = 1000;
export const MAX_FRESH_RESTARTS = 1;
export const RESTART_PROMPT = "The harness restarted while you worked. Your sandbox and its files are as you left them: continue where you left off.";

export interface CodeRequest {
	night: string;
	expId: string;
	round: number;
	parentSha: string;
	repoDir: string;
	bundleDir: string;
	/** nights/<id>/exps/<exp>, absolute. */
	expDir: string;
	config: NightConfig;
	mock: boolean;
	/** The reviewer's hypothesis for this round; none in round 1. */
	hypothesis: string | null;
	checkpointMetrics: Record<string, number>;
	/** The night so far, for the prompt's trajectory. */
	trajectory?: string;
	/** The last experiment's errors, when it was never scored. */
	failures?: string;
	/** The operator's direction on a continued night, masked. */
	direction?: string;
	/** A repair attempt: no send-backs, no wrap-up turn. */
	repair?: boolean;
	/** The commit the sandbox starts from when it is not the parent: a repair starts from the failed commit. */
	startSha?: string;
}

export interface CodeResult {
	commit: string;
	stop: Exclude<CoderStop, "cancelled">;
	coderUsd: number;
	/** The coder's dev ledger: its program runs through the proxy. */
	devUsd: number;
	tokens: number;
	tProvision: number;
	tCode: number;
	infraErrors: number;
	/** The closing message, cut to 1,000 characters; `(no closing message)` when empty. */
	closing: string;
	/** The hypothesis recorded: the reviewer's, else the APPROACH line. */
	hypothesis: string;
	notes: string;
	sendBacks: number;
	error?: string;
	/** Stop `credits`: the night pauses, then the coder carries on from this commit. */
	credit?: CreditStop;
}

interface CodeState {
	startedAt: string;
	sandbox: string;
	freshRestarts: number;
	infraErrors: number;
	coderUsd: number;
	devUsd: number;
	tokens: number;
	tCode: number;
	tProvision: number;
	finishedAt?: string;
	stop?: CoderStop;
	/** A credit stop committed this; the rerun after the pause carries on from it. */
	paused?: { commit: string };
}

/** The repository whose files hold the gold: the Agent Server checkout's GitHub `origin`, if it has one. */
const goldRepos = (): string[] => {
	const repo = originRepo(serverRoot());
	return repo ? [repo] : [];
};

/** The last `APPROACH:` line, backticks and asterisks stripped; else the last non-empty line; else `(no summary)`. */
export function approachOf(closing: string): string {
	const lines = closing.split("\n").map((l) => l.trim()).filter(Boolean);
	const tagged = lines.filter((l) => /APPROACH:/.test(l)).pop();
	const pick = tagged ? tagged.slice(tagged.indexOf("APPROACH:") + "APPROACH:".length) : lines.pop();
	const clean = (pick ?? "").replace(/[`*]/g, "").trim();
	return clean ? clean.slice(0, APPROACH_CHARS) : "(no summary)";
}

/** The rejected diffs in the bundle's history, as the coder sees them under /spec. */
const rejectedDiffs = (bundleDir: string) => {
	const dir = join(bundleDir, "history");
	return existsSync(dir) ? readdirSync(dir).filter((n) => /^r\d+\.diff$/.test(n)).sort().map((n) => `/spec/history/${n}`) : [];
};

async function readOptional(sb: Sandbox, path: string): Promise<string | null> {
	const r = await sb.exec(`test -f ${path} && cat ${path}`, { cwd: "/" });
	return r.exitCode === 0 ? r.stdout : null;
}

/** Replace /repo/.git with one commit of the tree on the parent, as `codeclimb`, then import it as refs/exp/<id>. */
async function squashCommit(sb: Sandbox, repo: ExperimentRepo, parentSha: string, expId: string, message: string): Promise<string> {
	await sb.writeFile("/cc/commit-msg.txt", message);
	const script = [
		"set -e",
		"cd /repo",
		"rm -rf .git",
		"git init -q -b main",
		`git fetch -q ${PARENT_BUNDLE} 'refs/*:refs/cc-parent/*'`,
		`git reset -q --soft ${parentSha}`,
		"git for-each-ref --format='%(refname)' refs/cc-parent | xargs -r -n1 git update-ref -d",
		"git add -A",
		"git -c user.name=codeclimb -c user.email=codeclimb@localhost -c commit.gpgsign=false commit -q --allow-empty -F /cc/commit-msg.txt",
	].join("\n");
	const r = await sb.exec(script, { cwd: "/", timeoutMs: 120_000 });
	if (r.exitCode !== 0) throw new Error(`commit in ${sb.name} failed: ${(r.stderr || r.stdout).trim().slice(-2000)}`);
	return pullCommit(sb, repo, expId);
}

export async function runCoder(backend: SandboxBackend, req: CodeRequest, signal: AbortSignal): Promise<CodeResult> {
	let t0 = Date.now();
	const { config } = req;
	const sandboxName = `cc-${req.expId}`;
	const stateFile = join(req.expDir, "code-state.json");
	const resultFile = join(req.expDir, "code-result.json");
	const sessionDir = join(req.expDir, "session");
	mkdirSync(sessionDir, { recursive: true });

	// A rerun is decided by the state file, not by the attempt number (a step rerun after a restart starts at attempt 1).
	const prior = readJson<CodeState>(stateFile);
	const finished = prior?.finishedAt ? readJson<CodeResult>(resultFile) : null;
	if (finished) return finished;
	const pausedAt = prior?.paused;
	const rerun = prior !== null && !prior.finishedAt && !pausedAt;
	const state: CodeState = prior && !prior.finishedAt
		? { ...prior }
		: { startedAt: new Date(t0).toISOString(), sandbox: sandboxName, freshRestarts: 0, infraErrors: 0, coderUsd: 0, devUsd: 0, tokens: 0, tCode: 0, tProvision: 0 };
	const save = () => {
		state.tCode = Math.max(0, (Date.now() - t0) / 1000 - state.tProvision);
		writeJson(stateFile, state);
	};
	let live: Sandbox | null = null;
	let reopen: string | undefined;
	/** The commit the sandbox starts from: the parent, or the paused commit after a pause. */
	let startSha = req.startSha ?? req.parentSha;
	const sessionFile = () => readdirSync(sessionDir).filter((n) => n.endsWith(".jsonl")).sort().pop();
	if (pausedAt) {
		// After a pause, once: a new sandbox from the paused commit, the same session, the clock set so the pause doesn't count.
		startSha = pausedAt.commit;
		const file = sessionFile();
		if (file) reopen = join(sessionDir, file);
		t0 = Date.now() - (state.tCode + state.tProvision) * 1000;
		state.startedAt = new Date(t0).toISOString();
		delete state.paused;
		delete state.stop;
	} else if (rerun) {
		live = await backend.find(sandboxName);
		const file = sessionFile();
		if (live && file) {
			// Alive, with a session file: a session resume on the same clock.
			reopen = join(sessionDir, file);
			t0 = Date.parse(state.startedAt);
		} else {
			// Dead: one fresh restart from the parent commit; the clock and the session start again.
			if (state.freshRestarts >= MAX_FRESH_RESTARTS) throw new NonRetriableError(`experiment ${req.expId}: sandbox lost twice`);
			live = null;
			state.freshRestarts++;
			state.infraErrors++;
			state.startedAt = new Date(t0).toISOString();
			state.tProvision = 0;
		}
	}
	save();

	signal.throwIfAborted();
	const repo = await ExperimentRepo.open(req.repoDir);
	// Metered: the coder's dev ledger, a new token per attempt, capped at what is left of the experiment's budget.
	let ledger: Ledger | undefined;
	if (config.allowed_models.length) {
		const port = await proxyPort();
		await ensureMeterPath(config.scenario_spec.image, port);
		ledger = openLedger(req.night, {
			id: `${req.expId}-dev`,
			allowedModels: config.allowed_models,
			capUsd: config.budget_usd.experiment - state.coderUsd,
			coder: true,
			mock: req.mock,
			spentUsd: state.devUsd,
			onCreditStop: (s) => creditStop(s),
		});
	}
	const closeDev = () => {
		if (!ledger) return;
		const rows = closeLedger(ledger);
		state.devUsd = ledger.spentUsd;
		if (rows.length) writeFileSync(join(req.expDir, "meter-dev.jsonl"), `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
	};
	let sb: Sandbox;
	try {
		sb = live ?? await backend.create({
			name: sandboxName,
			image: config.scenario_spec.image,
			labels: { night: req.night, run: req.expId },
			commit: { repo, sha: startSha },
			specDir: req.bundleDir,
			...(ledger ? { network: METER_NETWORK } : {}),
		});
	} catch (e) {
		closeDev();
		throw e;
	}
	if (!reopen) state.tProvision = (Date.now() - t0) / 1000;
	save();

	let stop: CoderStop | undefined;
	let error: string | undefined;
	let session: AgentSession | undefined;
	let sendBacks = 0;
	const end = (why: CoderStop) => {
		stop ??= why;
		void session?.abort();
	};
	let credit: CreditStop | undefined;
	function creditStop(c: CreditStop): void {
		credit ??= c;
		end("credits");
	}
	const onAbort = () => end("cancelled");
	signal.addEventListener("abort", onAbort, { once: true });
	const totalMs = config.timeouts.experiment_min * 60_000;
	const deadline = t0 + totalMs;
	const timer = setTimeout(() => end("timeout"), Math.max(0, deadline - Date.now()));
	let wrapUpSent = false;
	/** The reserve started while the coder works: the wrap-up as a steering message, once. */
	const steerWrapUp = () => {
		if (wrapUpSent || stop || !session?.isStreaming) return;
		wrapUpSent = true;
		void session.steer(WRAP_UP).catch(() => {});
	};
	const reserveTimer = setTimeout(steerWrapUp, Math.max(0, t0 + totalMs * (1 - RESERVE_SHARE) - Date.now()));
	let lastEvent = Date.now();
	let toolsRunning = 0;
	const idle = setInterval(() => {
		const quiet = Date.now() - lastEvent;
		if (quiet >= (toolsRunning > 0 ? IDLE_TOOL_MS : IDLE_QUIET_MS)) end("idle");
	}, IDLE_CHECK_MS);
	let untrace: (() => void) | undefined;
	try {
		session = await openSession({
			model: await sessionModel(config.model, "coder", req.mock),
			thinking: config.coder_thinking,
			cwd: "/repo",
			sandbox: tracedSandbox(sb),
			...(ledger ? { env: meterEnv(ledger.token) } : {}),
			storage: { dir: sessionDir, ...(reopen ? { reopen } : {}) },
			// Web research reaches the real web: off in mock mode.
			...(req.mock ? {} : { web: { repos: goldRepos() } }),
		});
		untrace = traceSession(session);
		session.subscribe((e) => {
			lastEvent = Date.now();
			if (e.type === "tool_execution_start") toolsRunning++;
			if (e.type === "tool_execution_end") toolsRunning = Math.max(0, toolsRunning - 1);
			if (e.type === "message_end" && e.message.role === "assistant") {
				// Pi reports a failed model call as a message, not a throw: test every one for a credit error.
				if (e.message.stopReason === "error" && isCreditMessage(e.message.errorMessage ?? "")) creditStop({ who: "coder", model: config.model, message: e.message.errorMessage ?? "" });
				state.coderUsd += e.message.usage?.cost?.total ?? 0;
				state.tokens += e.message.usage?.totalTokens ?? 0;
				if (ledger) state.devUsd = ledger.spentUsd;
				save();
				if (state.coderUsd + state.devUsd >= config.budget_usd.experiment) end("budget");
				else if (state.coderUsd + state.devUsd >= config.budget_usd.experiment * (1 - RESERVE_SHARE)) steerWrapUp();
			}
		});
		const prompt = coderPrompt({
			config,
			bundleDir: req.bundleDir,
			checkpoint: req.checkpointMetrics,
			hypothesis: req.hypothesis,
			minutes: config.timeouts.experiment_min,
			endsAt: new Date(deadline),
			hasTrain: existsSync(join(req.bundleDir, "train")),
			trajectory: req.trajectory ?? "",
			rejectedDiffs: rejectedDiffs(req.bundleDir),
			...(req.failures ? { failures: req.failures } : {}),
			...(req.repair ? { repair: true } : {}),
			...(req.direction ? { direction: req.direction } : {}),
		});
		if (!signal.aborted) await session.prompt(reopen ? RESTART_PROMPT : prompt);
		const hasTrain = existsSync(join(req.bundleDir, "train"));
		const target = targetLines(config, req.checkpointMetrics).targets[0]?.split(":")[0];
		const nextStep = req.hypothesis
			? `test the parts of the hypothesis you have not tested yet (${req.hypothesis})`
			: target
				? `look at the worst train items of ${target}, the threshold metric furthest below its target`
				: "look at the worst train items and fix the most common failure";
		const minutesLeft = () => (deadline - Date.now()) / 60_000;
		for (;;) {
			if (stop || signal.aborted) break;
			const usd = state.coderUsd + state.devUsd;
			const message = sendBackMessage({
				tasks: await readOptional(sb, "/tmp/tasks.json"),
				train: await readOptional(sb, "/tmp/train-score.json"),
				hasTrain,
				reserve: inReserve({ elapsedMs: Date.now() - t0, totalMs, usd, budgetUsd: config.budget_usd.experiment }),
				sendBacks,
				repair: req.repair === true,
				capStopped: stop !== undefined,
				minutesLeft: minutesLeft(),
				minutesTotal: config.timeouts.experiment_min,
				usdLeft: config.budget_usd.experiment - usd,
				usdTotal: config.budget_usd.experiment,
				nextStep,
			});
			if (!message) break;
			sendBacks++;
			await session.prompt(message);
		}
		// One wrap-up turn for a coder that was sent back before its reserve.
		if (!stop && !signal.aborted && sendBacks > 0 && !wrapUpSent && minutesLeft() >= MIN_MINUTES_LEFT) {
			wrapUpSent = true;
			await session.prompt(WRAP_UP);
		}
	} catch (e) {
		if (!stop) {
			const message = e instanceof Error ? e.message : String(e);
			if (!signal.aborted && isCreditMessage(message)) creditStop({ who: "coder", model: config.model, message });
			else {
				stop = signal.aborted ? "cancelled" : "agent_error";
				error = message;
			}
		}
	} finally {
		untrace?.();
		clearTimeout(timer);
		clearTimeout(reserveTimer);
		clearInterval(idle);
		signal.removeEventListener("abort", onAbort);
		closeDev();
	}
	stop ??= signal.aborted ? "cancelled" : "done";
	const closingRaw = session?.getLastAssistantText()?.trim() ?? "";
	session?.dispose();

	if (stop === "cancelled") {
		state.stop = stop;
		state.finishedAt = new Date().toISOString();
		save();
		await sb.destroy();
		throw signal.reason ?? new Error(`experiment ${req.expId} was cancelled`);
	}

	const notes = ((await readOptional(sb, "/tmp/notes.md")) ?? "").slice(0, NOTES_CHARS);
	for (const [file, name] of [["/tmp/tasks.json", "tasks.json"], ["/tmp/train-score.json", "train-score.json"]] as const) {
		const text = await readOptional(sb, file);
		if (text !== null) writeFileSync(join(req.expDir, name), text);
	}
	const hypothesis = req.hypothesis ?? approachOf(closingRaw);
	const commit = await squashCommit(sb, repo, req.parentSha, req.expId, `${req.expId}: ${hypothesis}`);
	state.stop = stop;
	state.tCode = Math.max(0, (Date.now() - t0) / 1000 - state.tProvision);
	const paused = stop === "credits";
	if (paused) state.paused = { commit };
	else state.finishedAt = new Date().toISOString();
	const result: CodeResult = {
		commit,
		stop,
		coderUsd: state.coderUsd,
		devUsd: state.devUsd,
		tokens: state.tokens,
		tProvision: state.tProvision,
		tCode: state.tCode,
		infraErrors: state.infraErrors,
		closing: closingRaw ? closingRaw.slice(0, CLOSING_CHARS) : "(no closing message)",
		hypothesis,
		notes,
		sendBacks,
		...(error ? { error } : {}),
		...(paused && credit ? { credit } : {}),
	};
	if (paused) {
		// No result file and no finishedAt: the rerun after the pause must code again.
		writeJson(stateFile, state);
		return result;
	}
	// The result first, then the finished state: a rerun that finds both returns the result without coding again.
	writeJson(resultFile, result);
	writeJson(stateFile, state);
	return result;
}
