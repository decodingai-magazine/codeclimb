import assert from "node:assert/strict";
import { test } from "node:test";
import { loadNightConfig } from "../config.ts";
import { emptyLoop, softStop, thresholdsMet } from "./loop.ts";

const ROOT = process.cwd();
const base = loadNightConfig("configs/datenorm-smoke.yaml", { cwd: ROOT, root: ROOT, mock: true });
const config = { ...base, max_rounds: 5, max_tokens: 1000, plateau_rounds: 2, budget_usd: { experiment: 1, night: 10 } };
const now = 1_000;
const deadline = 2_000;

test("no soft stop on a fresh night", () => {
	assert.equal(softStop(config, emptyLoop(), 1, now, deadline), null);
});

test("each soft stop on its own", () => {
	assert.equal(softStop(config, emptyLoop(), 6, now, deadline), "max_rounds");
	assert.equal(softStop(config, emptyLoop(), 2, deadline, deadline), "deadline");
	// spend + costliest round + costliest evaluation > night budget
	assert.equal(softStop(config, { ...emptyLoop(), spentUsd: 6, maxRoundUsd: 3, maxEvalUsd: 1.5 }, 2, now, deadline), "budget");
	assert.equal(softStop(config, { ...emptyLoop(), spentUsd: 6, maxRoundUsd: 3, maxEvalUsd: 1 }, 2, now, deadline), null);
	// tokens + the costliest round's tokens > max_tokens
	assert.equal(softStop(config, { ...emptyLoop(), tokens: 600, maxRoundTokens: 401 }, 2, now, deadline), "tokens");
	assert.equal(softStop({ ...config, max_tokens: undefined }, { ...emptyLoop(), tokens: 600, maxRoundTokens: 401 }, 2, now, deadline), null);
	assert.equal(softStop(config, { ...emptyLoop(), roundsWithoutKeep: 2 }, 3, now, deadline), "plateau");
	assert.equal(softStop({ ...config, plateau_rounds: 0 }, { ...emptyLoop(), roundsWithoutKeep: 9 }, 3, now, deadline), null);
});

test("the first of the five wins, in order", () => {
	const all = { spentUsd: 9, maxRoundUsd: 3, maxEvalUsd: 1, tokens: 900, maxRoundTokens: 900, roundsWithoutKeep: 5 };
	assert.equal(softStop(config, all, 6, deadline, deadline), "max_rounds");
	assert.equal(softStop(config, all, 2, deadline, deadline), "deadline");
	assert.equal(softStop(config, all, 2, now, deadline), "budget");
	assert.equal(softStop(config, { ...all, spentUsd: 0 }, 2, now, deadline), "tokens");
	assert.equal(softStop(config, { ...all, spentUsd: 0, tokens: 0 }, 2, now, deadline), "plateau");
});

test("thresholds: every threshold metric present and at least its target", () => {
	const c = { ...config, thresholds: { a: 0.5, b: 1 } };
	assert.equal(thresholdsMet(c, { a: 0.5, b: 1 }), true);
	assert.equal(thresholdsMet(c, { a: 0.5 }), false);
	assert.equal(thresholdsMet(c, { a: 0.49, b: 2 }), false);
});
