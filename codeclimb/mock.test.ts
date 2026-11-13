import assert from "node:assert/strict";
import { test } from "node:test";
import { armMockOffline, coderReply } from "./pi/mock";

const failed = (m: ReturnType<typeof coderReply>) => m.stopReason === "error" && m.errorMessage === "fetch failed";

test("--mock-offline N: the coder's calls 2 to N+1 fail, once per night", () => {
  const prompt = [{ role: "user", content: "go", timestamp: 0 }] as Parameters<typeof coderReply>[0];
  armMockOffline("night-a", 3);
  const calls = Array.from({ length: 6 }, () => failed(coderReply(prompt)));
  assert.deepEqual(calls, [false, true, true, true, false, false]);
  // A retried step arms again for the same night: the counter does not start over.
  armMockOffline("night-a", 3);
  assert.equal(failed(coderReply(prompt)), false);
});
