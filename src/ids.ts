// Ids of nights, experiments, evaluations, sandboxes and threads (spec: Ids; Durable runtime on LangGraph, Threads).
import { createHash } from "node:crypto";

const NIGHT_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,47}$/;

export function isValidNightId(id: string): boolean {
	return NIGHT_ID.test(id);
}

/** `n<YYYYMMDD>-<HHMMSS>` from local time. */
export function defaultNightId(now: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `n${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

export const starterId = (night: string) => `${night}-r0-starter`;
export const seedId = (night: string) => `${night}-r0-seed`;
/** `e0`, or `e1` for the round's repair. */
export const experimentId = (night: string, round: number, repair = false) => `${night}-r${round}-e${repair ? 1 : 0}`;
export const devEvalId = (exp: string) => `${exp}-eval`;
export const noiseEvalId = (exp: string, round: number) => `${exp}-noise-r${round}`;
export const testEvalId = (night: string, lastRound: number) => `${night}-test-r${lastRound}`;
export const sandboxPrefix = (night: string) => `cc-${night}`;

/** The UUID v5 namespace of every thread id CodeClimb derives. One constant of the build. */
const THREAD_NAMESPACE = "6f1d6c2e-7b0a-4c4e-9a43-2d7e0c1b9a55";

export function uuidV5(name: string, namespace: string = THREAD_NAMESPACE): string {
	const ns = Buffer.from(namespace.replaceAll("-", ""), "hex");
	const hash = createHash("sha1").update(ns).update(name, "utf8").digest();
	hash[6] = (hash[6]! & 0x0f) | 0x50;
	hash[8] = (hash[8]! & 0x3f) | 0x80;
	const hex = hash.subarray(0, 16).toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const nightThreadId = (night: string) => uuidV5(`night/${night}`);
export const stopThreadId = (night: string) => uuidV5(`stop/${night}`);
export const timerThreadId = (night: string) => uuidV5(`timer/${night}`);
export const lessonsThreadId = (scenario: string) => uuidV5(`lessons/${scenario}`);
