import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { markStopped } from "./cleanup";

function nightDir(root: string, nightId: string): string {
  const dir = join(root, "runs", "scn", "nights", nightId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "night.json"), "{}");
  return dir;
}

function withRoot(fn: (root: string) => void): void {
  const prev = process.env.CODECLIMB_ROOT;
  const root = mkdtempSync(join(tmpdir(), "cc-cleanup-"));
  process.env.CODECLIMB_ROOT = root;
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
    if (prev === undefined) delete process.env.CODECLIMB_ROOT;
    else process.env.CODECLIMB_ROOT = prev;
  }
}

const reason = (dir: string): string => JSON.parse(readFileSync(join(dir, "stop.json"), "utf8")).reason;

test("markStopped keeps the first stop reason", () => {
  withRoot((root) => {
    const dir = nightDir(root, "n1");
    markStopped("n1", "app");
    // The follow-up stop sent when `run-night` is cancelled must not overwrite the user's reason.
    markStopped("n1", "cancelled");
    assert.equal(reason(dir), "app");
  });
});

test("markStopped leaves a finished night alone", () => {
  withRoot((root) => {
    const dir = nightDir(root, "n2");
    writeFileSync(join(dir, "done.json"), "{}");
    markStopped("n2", "failed");
    assert.equal(existsSync(join(dir, "stop.json")), false);
  });
});
