// The Agent Server process's one Pi model runtime, and the mock provider on it (spec: Coder; Mock mode).
import { homedir } from "node:os";
import { join } from "node:path";
import { type Api, type AssistantMessage, type FauxProviderHandle, type FauxResponseFactory, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type Model } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export type Role = "coder" | "reviewer" | "lessons";

let runtime: Promise<ModelRuntime> | undefined;
let faux: FauxProviderHandle | undefined;

export const piAuthPath = () => process.env.CODECLIMB_PI_AUTH_PATH ?? join(homedir(), ".pi", "agent", "auth.json");

export function modelRuntime(): Promise<ModelRuntime> {
	runtime ??= ModelRuntime.create({ authPath: piAuthPath() });
	return runtime;
}

/** The coder's bash call in mock mode: every turn changes the tree, and the files the harness reads are there. */
export const MOCK_CODER_COMMAND = [
	'echo "mock change $(date -u +%Y-%m-%dT%H:%M:%S.%NZ)" >> /repo/MOCK.md',
	`echo '[{"task":"mock change","check":"MOCK.md grows","status":"done"}]' > /tmp/tasks.json`,
	"echo 'mock note' > /tmp/notes.md",
	`echo '{"before":{"score":0},"after":{"score":0},"command":"true"}' > /tmp/train-score.json`,
].join(" && ");

export const MOCK_APPROACH = "APPROACH: mock change, no real work";

/** Coder calls that answer as a lost connection: `--mock-offline N` makes calls 2 to N+1 of the night's first experiment fail. */
const offline = { first: 0, last: -1, seen: 0 };

export function mockOffline(n: number): void {
	Object.assign(offline, { first: 2, last: n + 1, seen: 0 });
}

/** A scripted credit error for tests (start input `mock_credit`, no CLI flag): that role's call number `call` of the night fails once. */
export interface MockCredit {
	who: "coder" | "reviewer" | "program";
	call: number;
}
export const MOCK_CREDIT_MESSAGE = "402 Payment Required: insufficient credits";
const credit: { who: MockCredit["who"] | null; call: number; seen: number } = { who: null, call: 0, seen: 0 };

export function mockCredit(c: MockCredit): void {
	Object.assign(credit, { who: c.who, call: c.call, seen: 0 });
}

/** Count a mock call of `who`; true for the one that answers as a credit error. */
export function mockCreditDue(who: MockCredit["who"]): boolean {
	if (credit.who !== who) return false;
	credit.seen++;
	return credit.seen === credit.call;
}

const reply: FauxResponseFactory = (context, _options, _state, model): AssistantMessage => {
	// Put the factory back first: the queue gives up one entry per call, and an empty queue answers with an error.
	faux?.appendResponses([reply]);
	if ((model.id === "coder" || model.id === "reviewer") && mockCreditDue(model.id)) return fauxAssistantMessage([], { stopReason: "error", errorMessage: MOCK_CREDIT_MESSAGE });
	if (model.id === "reviewer") return fauxAssistantMessage(fauxText(JSON.stringify({ feedback: "mock feedback", hypothesis: "mock hypothesis", verdict: "mock verdict" })));
	if (model.id === "lessons") return fauxAssistantMessage(fauxText(JSON.stringify({ ops: [] })));
	if (offline.last >= offline.first) {
		offline.seen++;
		if (offline.seen >= offline.first && offline.seen <= offline.last) return fauxAssistantMessage([], { stopReason: "error", errorMessage: "fetch failed" });
	}
	const last = context.messages[context.messages.length - 1];
	if (last?.role === "toolResult") return fauxAssistantMessage(fauxText(MOCK_APPROACH));
	return fauxAssistantMessage(fauxToolCall("bash", { command: MOCK_CODER_COMMAND }), { stopReason: "toolUse" });
};

/** Register the faux provider `mock` on the runtime once, with one model per role. */
async function mockProvider(): Promise<FauxProviderHandle> {
	if (faux) return faux;
	const rt = await modelRuntime();
	const handle = fauxProvider({ provider: "mock", models: [{ id: "coder" }, { id: "reviewer" }, { id: "lessons" }] });
	rt.registerNativeProvider(handle.provider);
	faux = handle;
	// A head start for concurrent sessions: each call takes one entry and puts one back.
	handle.setResponses(Array.from({ length: 8 }, () => reply));
	return handle;
}

/** The model a session runs on: the role's faux model in mock mode, else `<provider>/<id>` from the runtime. */
export async function sessionModel(spec: string, role: Role, mock: boolean): Promise<Model<Api>> {
	if (mock) {
		const m = (await mockProvider()).getModel(role);
		if (!m) throw new Error(`mock model ${role} is missing`);
		return m as Model<Api>;
	}
	const slash = spec.indexOf("/");
	const m = slash > 0 ? (await modelRuntime()).getModel(spec.slice(0, slash), spec.slice(slash + 1)) : undefined;
	if (!m) throw new Error(`model ${spec} is not in Pi's model runtime`);
	return m;
}
