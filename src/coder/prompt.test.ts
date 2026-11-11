import assert from "node:assert/strict";
import { test } from "node:test";
import { loadNightConfig } from "../config.ts";
import { coderPrompt } from "./prompt.ts";

const ROOT = process.cwd();

test("the coder prompt carries neither the send-back's nor the wrap-up's phrase", () => {
	const config = loadNightConfig("configs/datenorm-smoke.yaml", { cwd: ROOT, root: ROOT, mock: true });
	const prompt = coderPrompt({ config, bundleDir: "scenarios/datenorm", checkpoint: { accuracy: 0.2 }, hypothesis: "h", minutes: 10, endsAt: new Date(0), hasTrain: true });
	assert.match(prompt, /<targets>/);
	assert.match(prompt, /APPROACH/);
	assert.doesNotMatch(prompt, /You stopped with/);
	assert.doesNotMatch(prompt, /change no more code/);
});
