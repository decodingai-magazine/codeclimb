// The `lessons` graph: one distillation, on the scenario's lessons thread, whose runs queue (spec: Lessons across nights).
import { join } from "node:path";
import { entrypoint } from "@langchain/langgraph";
import type { LessonsInput } from "../control.ts";
import { lessonsOn, proposeLessons, writeProposal } from "../lessons.ts";
import { scanText } from "../night/scan.ts";
import { serverRoot } from "../night/types.ts";
import { step } from "../runtime/step.ts";
import { registerTracing } from "../tracing.ts";

registerTracing();

export const lessons = entrypoint("lessons", async (input: LessonsInput) => {
	const { night_id: id, config } = input;
	if (!lessonsOn(config)) return { night_id: id, skipped: "lessons are off" };
	// A credit error fails the step and its retries run it again: no pause after a night.
	return await step(`${id}/distill`, async ({ signal }) => {
		const root = serverRoot();
		const scan = config.scenario_spec.scan;
		const scanner = { scenarioDir: join(root, config.scenario), ...(scan ? { scan } : {}), signal };
		const proposal = await proposeLessons(root, config, id, (text) => scanText(scanner, text), signal);
		// Nothing new, or a proposal for these rounds already there: a second run for the same night is harmless.
		if (!proposal) return { night_id: id, skipped: "nothing new to distill" };
		const { dir, applied } = writeProposal(root, config, proposal, config.lessons === "apply");
		return { night_id: id, dir, applied, ops: proposal.ops.length, rejected: proposal.rejected.length, usd: proposal.usd };
	})();
});
