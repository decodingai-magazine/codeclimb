// The `lessons` graph: one distillation (spec: Lessons across nights). A stub until the lessons ticket.
import { entrypoint } from "@langchain/langgraph";

export interface LessonsInput {
	night_id: string;
	scenario: string;
}

export const lessons = entrypoint("lessons", async (input: LessonsInput) => ({ night_id: input.night_id, skipped: "lessons not built yet" }));
