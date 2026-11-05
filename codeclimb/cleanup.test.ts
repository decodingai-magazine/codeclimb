import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cancelledNightId, markStopped } from "./cleanup";

function withRoot(fn: (nightDir: (id: string) => string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "cc-cleanup-"));
  const prev = process.env.CODECLIMB_ROOT;
  process.env.CODECLIMB_ROOT = root;
  try {
    fn((id) => {
      const dir = join(root, "runs", "scenario", "nights", id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "night.json"), "{}");
      return dir;
    });
  } finally {
    if (prev === undefined) delete process.env.CODECLIMB_ROOT;
    else process.env.CODECLIMB_ROOT = prev;
    rmSync(root, { recursive: true, force: true });
  }
}

const reason = (dir: string) => JSON.parse(readFileSync(join(dir, "stop.json"), "utf8")).reason;

test("markStopped keeps the first reason", () => {
  withRoot((nightDir) => {
    const dir = nightDir("n1");
    markStopped("n1", "app");
    markStopped("n1", "cancelled");
    assert.equal(reason(dir), "app");
  });
});

test("markStopped leaves a finished night alone", () => {
  withRoot((nightDir) => {
    const dir = nightDir("n2");
    writeFileSync(join(dir, "done.json"), "{}");
    markStopped("n2", "failed");
    assert.equal(existsSync(join(dir, "stop.json")), false);
  });
});

test("cancelledNightId reads the triggering event of a cancelled run", () => {
  // Shape recorded from the dev server (CLI 1.49.0) for a run cancelled by `timeouts.finish`.
  const data = {
    _inngest: { status: "Cancelled" },
    event: { data: { night_id: "n-1", config: {} }, id: "night-start-n-1", name: "codeclimb/night.start", ts: 1 },
    events: [{ data: { night_id: "n-1" }, id: "night-start-n-1", name: "codeclimb/night.start", ts: 1 }],
    function_id: "codeclimb-worker-run-night",
    run_id: "01RUN",
  };
  assert.equal(cancelledNightId(data), "n-1");
  for (const bad of [undefined, null, {}, { event: {} }, { event: { data: { night_id: 7 } } }, { event: { data: { night_id: "" } } }]) {
    assert.equal(cancelledNightId(bad), undefined);
  }
});
