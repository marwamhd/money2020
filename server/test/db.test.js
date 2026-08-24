import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// db.js reads its DB_PATH once at import time, so each test file that needs an isolated
// database must point M2020_DB_PATH at a fresh temp file BEFORE the dynamic import below —
// sharing the real dev database here would pollute (or be polluted by) live booth data.
const tmpDir = mkdtempSync(path.join(os.tmpdir(), "m2020-db-test-"));
process.env.M2020_DB_PATH = path.join(tmpDir, "test.db");

const { getTopLeaderboard, recordLeaderboardEntryIfFirst, resetLeaderboard } = await import("../src/db.js");

test.after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("submitting an email for the first time enters that score into the leaderboard", () => {
  resetLeaderboard();
  recordLeaderboardEntryIfFirst({ name: "Alice", score: 300, email: "alice@example.com" });
  const board = getTopLeaderboard(5);
  assert.deepEqual(board, [{ name: "Alice", score: 300 }]);
});

test("a repeat play under the same email does not replace the first submitted score", () => {
  resetLeaderboard();
  recordLeaderboardEntryIfFirst({ name: "Alice", score: 300, email: "alice@example.com" });
  recordLeaderboardEntryIfFirst({ name: "Alice", score: 900, email: "alice@example.com" });
  const board = getTopLeaderboard(5);
  assert.deepEqual(board, [{ name: "Alice", score: 300 }], "the higher second score must be ignored");
});

test("different emails each get their own leaderboard entry, ranked by score", () => {
  resetLeaderboard();
  recordLeaderboardEntryIfFirst({ name: "Alice", score: 150, email: "alice@example.com" });
  recordLeaderboardEntryIfFirst({ name: "Bob", score: 300, email: "bob@example.com" });
  const board = getTopLeaderboard(5);
  assert.deepEqual(board, [
    { name: "Bob", score: 300 },
    { name: "Alice", score: 150 },
  ]);
});
