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

const { getOpponentResult, getTopLeaderboard, getTopLeaderboardForDate, recordLeaderboardEntryIfFirst, resetLeaderboard, persistMatchResults, listMatchResults, getMatchResultById, db } = await import("../src/db.js");

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

// Regression: getTopLeaderboard used to show every entry ever recorded, all-time — a
// live event needs it to reset itself every day without an admin manually wiping it
// (and losing history) each morning. Inserted directly via `db` since
// recordLeaderboardEntryIfFirst always stamps "now".
test("getTopLeaderboard only shows today's (event-local) entries, not a stale prior day's", () => {
  resetLeaderboard();
  const yesterday = new Date(Date.now() - 24 * 3600_000).toISOString();
  db.prepare("INSERT INTO leaderboard (name, score, email, achieved_at) VALUES (?,?,?,?)").run("OldPlayer", 999, "old@example.com", yesterday);
  recordLeaderboardEntryIfFirst({ name: "Alice", score: 300, email: "alice@example.com" });

  const board = getTopLeaderboard(5);
  assert.deepEqual(board, [{ name: "Alice", score: 300 }], "yesterday's entry must not appear in today's live leaderboard");
});

test("getTopLeaderboardForDate returns a specific past event-local day's entries, even though getTopLeaderboard no longer shows them", () => {
  resetLeaderboard();
  db.prepare("INSERT INTO leaderboard (name, score, email, achieved_at) VALUES (?,?,?,?)").run("OldPlayer", 999, "old@example.com", "2026-09-14T10:00:00.000Z");
  db.prepare("INSERT INTO leaderboard (name, score, email, achieved_at) VALUES (?,?,?,?)").run("EdgeOfDay", 500, "edge@example.com", "2026-09-14T20:59:59.999Z"); // 23:59:59 Riyadh time (UTC+3)

  const day = getTopLeaderboardForDate("2026-09-14");
  assert.deepEqual(day.map((r) => r.name), ["OldPlayer", "EdgeOfDay"]);
});

// Regression: a match result's rightful owner (player_token) must be readable straight
// from the row, independent of any in-memory server state — the whole point is that this
// survives a server restart, which an in-memory map cannot. See index.js's submitEmail.
test("persistMatchResults stores each player's id as player_token, readable via getMatchResultById", () => {
  const ids = persistMatchResults([{ id: "player-abc-123", name: "Alice", score: 500, slot: 1 }], "OWNERCODE");
  const result = getMatchResultById(ids["player-abc-123"]);
  assert.equal(result.playerToken, "player-abc-123");
});

// Regression: a player's in-engine name can legitimately be null (a client that never
// went through the real "type a name, then ready" UI flow — e.g. a raw socket connection,
// or any future bypass of that rule). match_results.player_name is NOT NULL, and this
// crashed the whole process with an uncaught SqliteError the first time it happened for
// real, mid-session, on 2026-09-06.
test("persisting a match result with a null player name does not throw, and falls back to a labeled placeholder", () => {
  assert.doesNotThrow(() => {
    persistMatchResults([{ id: "p1", name: null, score: 120, slot: 2 }], "TESTCODE");
  });
  const rows = listMatchResults();
  const row = rows.find((r) => r.matchCode === "TESTCODE");
  assert.equal(row.playerName, "Player 2");
  assert.equal(row.score, 120);
});

// ENG-576: the players log needs each player's outcome and who they played.
test("a saved result remembers Winner / Runner-up / Tie, and the opponent is the other player in the same match", () => {
  const ids = persistMatchResults([
    { id: "w", name: "Winnie", score: 900, slot: 1, result: "Winner" },
    { id: "r", name: "Runner", score: 400, slot: 2, result: "Runner-up" },
  ], "PAIRCODE");
  assert.equal(getMatchResultById(ids.w).result, "Winner");
  assert.equal(getMatchResultById(ids.r).result, "Runner-up");
  assert.deepEqual(getOpponentResult("PAIRCODE", "w"), { name: "Runner", email: null, score: 400 });
  assert.deepEqual(getOpponentResult("PAIRCODE", "r"), { name: "Winnie", email: null, score: 900 });
});

test("two different matches never get mixed up as each other's opponent", () => {
  persistMatchResults([
    { id: "a1", name: "A1", score: 100, slot: 1, result: "Tie" },
    { id: "a2", name: "A2", score: 100, slot: 2, result: "Tie" },
  ], "MATCH-A");
  persistMatchResults([
    { id: "b1", name: "B1", score: 700, slot: 1, result: "Winner" },
    { id: "b2", name: "B2", score: 300, slot: 2, result: "Runner-up" },
  ], "MATCH-B");
  assert.equal(getOpponentResult("MATCH-A", "a1").name, "A2");
  assert.equal(getOpponentResult("MATCH-B", "b1").name, "B2");
});

test("no opponent is found for a result without a match code, or a match with only one saved player", () => {
  assert.equal(getOpponentResult(null, "x"), null);
  persistMatchResults([{ id: "solo", name: "Solo", score: 50, slot: 1, result: "Tie" }], "SOLOCODE");
  assert.equal(getOpponentResult("SOLOCODE", "solo"), null);
});
