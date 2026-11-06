// Mock mode (`run-night --mock`): real Pi sessions, sandboxes and evals on scripted models, for a free
// end-to-end check. Metrics mean nothing. The coder appends to MOCK.md through the sandbox's bash tool,
// so every experiment has a real diff; the reviewer keeps nothing.
import { type FauxResponseFactory, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";

export type MockRole = "coder" | "reviewer";

type Messages = Parameters<FauxResponseFactory>[0]["messages"];

export const MOCK_CHANGE = `echo "mock change $(date +%s)" >> MOCK.md`;
export const MOCK_APPROACH = "APPROACH: mock change, no real work";

/** One bash call, then the closing text. A resumed session ends on a tool result or a prompt, and either works. */
export function coderReply(messages: Messages) {
  return messages.at(-1)?.role === "toolResult"
    ? fauxAssistantMessage(MOCK_APPROACH)
    : fauxAssistantMessage(fauxToolCall("bash", { command: MOCK_CHANGE }), { stopReason: "toolUse" });
}

/** The JSON `parseReview` wants; the prompt says how many hypotheses. */
export function reviewerReply(messages: Messages) {
  const branches = Number(/exactly (\d+) hypotheses/.exec(JSON.stringify(messages.at(-1)))?.[1] ?? 1);
  const hypotheses = Array.from({ length: branches }, (_, i) => `mock hypothesis ${i + 1}`);
  return fauxAssistantMessage(JSON.stringify({ keep: null, keep_reason: "mock", feedback: "mock feedback", hypotheses }));
}

const respond: FauxResponseFactory = (context, _options, _state, model) => {
  faux.appendResponses([respond]);
  return model.id === "reviewer" ? reviewerReply(context.messages) : coderReply(context.messages);
};

const faux = fauxProvider({ provider: "mock", models: [{ id: "coder" }, { id: "reviewer" }] });
// Faux pops one step per call and sessions share the queue: each step refills it, the head start covers concurrency.
faux.setResponses(Array.from({ length: 64 }, () => respond));

export const mockProvider = faux.provider;
export const mockModel = (role: MockRole) => faux.getModel(role)!;
