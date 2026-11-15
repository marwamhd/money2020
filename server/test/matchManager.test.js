import test from "node:test";
import assert from "node:assert/strict";
import { MatchManager } from "../src/matchManager.js";
import { TEST_QUESTIONS, waitUntil } from "../testSupport/fixtures.js";

const FAST_CONFIG = { COUNTDOWN_MS: 30, SECTION_DURATION_MS: 500, QUESTION_TIMEOUT_MS: 200, RUNNER_UP_POINTS: 30, REVEAL_MS: 10 };

function makeManager(stationCount) {
  const events = [];
  const manager = new MatchManager(TEST_QUESTIONS, (stationId, snap) => events.push({ stationId, snap }), FAST_CONFIG, stationCount);
  return { manager, events };
}

function join(manager, stationId, id, name) {
  const engine = manager.getEngine(stationId);
  return engine.addPlayer(id, name, engine.matchCode);
}

test("defaults to 2 stations, each with its own engine and its own match code", () => {
  const { manager } = makeManager();
  assert.deepEqual(manager.stationIds, [1, 2]);
  assert.notEqual(manager.getEngine(1), manager.getEngine(2));
  assert.notEqual(manager.getEngine(1).matchCode, manager.getEngine(2).matchCode);
});

test("getEngine accepts a numeric string and returns null for unknown stations", () => {
  const { manager } = makeManager();
  assert.equal(manager.getEngine("2"), manager.getEngine(2));
  assert.equal(manager.getEngine(3), null);
  assert.equal(manager.getEngine("abc"), null);
  assert.equal(manager.getEngine(undefined), null);
  assert.equal(manager.getSnapshot(99), null);
});

test("findByCode routes a code to the station that issued it, and rejects unknown ones", () => {
  const { manager } = makeManager();
  const found2 = manager.findByCode(manager.getEngine(2).matchCode);
  assert.equal(found2.stationId, 2);
  assert.equal(found2.engine, manager.getEngine(2));
  assert.equal(manager.findByCode("not-a-code"), null);
  assert.equal(manager.findByCode(undefined), null);
  assert.equal(manager.findByCode(""), null);
});

test("a stale code stops matching any station once that station moves to its next match", () => {
  const { manager } = makeManager();
  const engine = manager.getEngine(1);
  const oldCode = engine.matchCode;
  join(manager, 1, "a", "A");
  join(manager, 1, "b", "B");
  engine.setReady("a");
  engine.setReady("b");
  engine.forceEnd();
  engine.openNextMatch();
  assert.equal(manager.findByCode(oldCode), null);
  assert.equal(manager.findByCode(engine.matchCode).stationId, 1);
});

test("players in one station never appear in the other", () => {
  const { manager } = makeManager();
  join(manager, 1, "a1", "Alice");
  join(manager, 1, "a2", "Bob");
  join(manager, 2, "b1", "Carol");
  assert.deepEqual(manager.getEngine(1).players.map((p) => p.id), ["a1", "a2"]);
  assert.deepEqual(manager.getEngine(2).players.map((p) => p.id), ["b1"]);
});

test("a full station does not block the other: both can hold 2 players at once", () => {
  const { manager } = makeManager();
  assert.equal(join(manager, 1, "a1", "A1").ok, true);
  assert.equal(join(manager, 1, "a2", "A2").ok, true);
  assert.equal(join(manager, 1, "a3", "A3").ok, false); // station 1 is full
  assert.equal(join(manager, 2, "b1", "B1").ok, true);
  assert.equal(join(manager, 2, "b2", "B2").ok, true);
});

test("onChange reports which station each snapshot came from", () => {
  const { manager, events } = makeManager();
  join(manager, 2, "b1", "Carol");
  assert.ok(events.length > 0);
  assert.ok(events.every((e) => e.stationId === 2));
  join(manager, 1, "a1", "Alice");
  assert.equal(events.at(-1).stationId, 1);
});

test("two matches run at the same time and finish independently with their own scores", async () => {
  const { manager } = makeManager();
  const e1 = manager.getEngine(1);
  const e2 = manager.getEngine(2);
  join(manager, 1, "a1", "A1");
  join(manager, 1, "a2", "A2");
  join(manager, 2, "b1", "B1");
  join(manager, 2, "b2", "B2");
  e1.setReady("a1");
  e1.setReady("a2");
  e2.setReady("b1");
  e2.setReady("b2");
  await waitUntil(() => e1.state === "playing" && e2.state === "playing");

  // Only station 1 scores: station 2's players never answer.
  const q = e1.currentQuestion;
  e1.submitAnswer("a1", q.id, q.correctOption);
  e1.submitAnswer("a2", q.id, q.correctOption === "A" ? "B" : "A");
  assert.ok(e1.players.find((p) => p.id === "a1").score > 0);
  assert.equal(e2.players.every((p) => p.score === 0), true);

  // Ending one match leaves the other untouched and still playing.
  e1.forceEnd();
  assert.equal(e1.state, "finished");
  assert.equal(e2.state, "playing");
  assert.equal(e1.winnerId, "a1");
  assert.equal(e2.winnerId, null);

  await waitUntil(() => e2.state === "finished", 5000);
  assert.equal(e1.players.length, 2);
  assert.equal(e2.players.length, 2);
});

test("resetting one station leaves the other's match alone", () => {
  const { manager } = makeManager();
  join(manager, 1, "a1", "A1");
  join(manager, 2, "b1", "B1");
  manager.getEngine(1).resetMatch();
  assert.equal(manager.getEngine(1).players.length, 0);
  assert.equal(manager.getEngine(2).players.length, 1);
});

test("updateConfig and setQuestions apply to every station", () => {
  const { manager } = makeManager();
  manager.updateConfig({ RUNNER_UP_POINTS: 55 });
  assert.equal(manager.getEngine(1).config.RUNNER_UP_POINTS, 55);
  assert.equal(manager.getEngine(2).config.RUNNER_UP_POINTS, 55);
  assert.equal(manager.config.RUNNER_UP_POINTS, 55);

  manager.setQuestions([TEST_QUESTIONS[0]]);
  assert.equal(manager.getEngine(1).questionsByRound.R1.length, 1);
  assert.equal(manager.getEngine(2).questionsByRound.R1.length, 1);
});
