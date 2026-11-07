// Mock mode (`run-night --mock`): real Pi sessions, sandboxes and evals on scripted models, for a free
// end-to-end check. Metrics mean nothing. The coder appends to MOCK.md through the sandbox's bash tool,
// so every experiment has a real diff, and writes a done task list and a note; every score is 0, so nothing is kept.
import { type FauxResponseFactory, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";

export type MockRole = "coder" | "reviewer";

type Messages = Parameters<FauxResponseFactory>[0]["messages"];

export const MOCK_CHANGE =
  `echo "mock change $(date +%s)" >> MOCK.md && echo '[{"task": "mock", "check": "none", "status": "done"}]' > /tmp/tasks.json && echo "mock note" > /tmp/notes.md && echo '{"before": {"mock": 0}, "after": {"mock": 0}, "command": "mock"}' > /tmp/train-score.json`;
export const MOCK_APPROACH = "APPROACH: mock change, no real work";

/** One bash call, then the closing text. A resumed session ends on a tool result or a prompt, and either works. */
export function coderReply(messages: Messages) {
  return messages.at(-1)?.role === "toolResult"
    ? fauxAssistantMessage(MOCK_APPROACH)
    : fauxAssistantMessage(fauxToolCall("bash", { command: MOCK_CHANGE }), { stopReason: "toolUse" });
}

/** The JSON `parseReview` wants. */
export function reviewerReply() {
  return fauxAssistantMessage(JSON.stringify({ feedback: "mock feedback", hypothesis: "mock hypothesis", verdict: "mock verdict" }));
}

const respond: FauxResponseFactory = (context, _options, _state, model) => {
  faux.appendResponses([respond]);
  return model.id === "reviewer" ? reviewerReply() : coderReply(context.messages);
};

const faux = fauxProvider({ provider: "mock", models: [{ id: "coder" }, { id: "reviewer" }] });
// Faux pops one step per call and sessions share the queue: each step refills it, the head start covers concurrency.
faux.setResponses(Array.from({ length: 64 }, () => respond));

export const mockProvider = faux.provider;
export const mockModel = (role: MockRole) => faux.getModel(role)!;
