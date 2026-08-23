import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../src/gameEngine.js";
import { TEST_QUESTIONS, waitUntil } from "../testSupport/fixtures.js";

const FAST_CONFIG = { COUNTDOWN_MS: 30, SECTION_DURATION_MS: 500, QUESTION_TIMEOUT_MS: 200, RUNNER_UP_POINTS: 30 };

function makeEngine(config = FAST_CONFIG) {
  const events = [];
  const engine = new GameEngine(TEST_QUESTIONS, (snap) => events.push(snap), config);
  return { engine, events };
}

test("exactly two players can join; a third is rejected", () => {
  const { engine } = makeEngine();
  assert.equal(engine.addPlayer("p1", "Alice").ok, true);
  assert.equal(engine.addPlayer("p2", "Bob").ok, true);
  const third = engine.addPlayer("p3", "Eve");
  assert.equal(third.ok, false);
});

test("joining again with the same id returns the existing slot, not a new player", () => {
  const { engine } = makeEngine();
  const first = engine.addPlayer("p1", "Alice");
  const again = engine.addPlayer("p1", "Alice");
  assert.equal(again.slot, first.slot);
  assert.equal(engine.players.length, 1);
});

test("a later join with the same id updates the name (e.g. a placeholder name from an earlier retry)", () => {
  const { engine } = makeEngine();
  engine.addPlayer("p1", "Player");
  engine.addPlayer("p1", "Alice");
  assert.equal(engine.players.find((p) => p.id === "p1").name, "Alice");
});

test("a later join with the same id but no name keeps the existing name", () => {
  const { engine } = makeEngine();
  engine.addPlayer("p1", "Alice");
  engine.addPlayer("p1", undefined);
  assert.equal(engine.players.find((p) => p.id === "p1").name, "Alice");
});

test("stays in lobby until both players ready, then counts down and starts playing", async () => {
  const { engine } = makeEngine();
  engine.addPlayer("p1", "Alice");
  engine.addPlayer("p2", "Bob");

  engine.setReady("p1");
  assert.equal(engine.state, "lobby");

  engine.setReady("p2");
  assert.equal(engine.state, "countdown");

  await waitUntil(() => engine.state === "playing");
  assert.ok(engine.currentQuestion, "a question should be served once playing starts");
});

test("a duplicate answer for the same question is ignored", async () => {
  const { engine } = makeEngine();
  engine.addPlayer("p1", "Alice");
  engine.addPlayer("p2", "Bob");
  engine.setReady("p1");
  engine.setReady("p2");
  await waitUntil(() => engine.state === "playing");

  const qid = engine.currentQuestion.id;
  engine.submitAnswer("p1", qid, "A");
  engine.submitAnswer("p1", qid, "B"); // duplicate, should be ignored
  assert.equal(engine.answerOrder.length, 1);
  assert.equal(engine.answerOrder[0].choice, "A");
});

test("answers only count for the currently active question id", async () => {
  const { engine } = makeEngine();
  engine.addPlayer("p1", "Alice");
  engine.addPlayer("p2", "Bob");
  engine.setReady("p1");
  engine.setReady("p2");
  await waitUntil(() => engine.state === "playing");

  engine.submitAnswer("p1", "not-the-current-question", "A");
  assert.equal(engine.answerOrder.length, 0);
});

test("both answering immediately advances without waiting for the timeout", async () => {
  const { engine } = makeEngine();
  engine.addPlayer("p1", "Alice");
  engine.addPlayer("p2", "Bob");
  engine.setReady("p1");
  engine.setReady("p2");
  await waitUntil(() => engine.state === "playing");

  const firstQuestionId = engine.currentQuestion.id;
  const startedAt = Date.now();
  engine.submitAnswer("p1", firstQuestionId, "A");
  engine.submitAnswer("p2", firstQuestionId, "A");

  await waitUntil(() => engine.currentQuestion?.id !== firstQuestionId);
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < FAST_CONFIG.QUESTION_TIMEOUT_MS, `advanced in ${elapsed}ms, expected well under the ${FAST_CONFIG.QUESTION_TIMEOUT_MS}ms timeout`);
});

test("a full match scores correctly and produces deterministic totals", async () => {
  const { engine } = makeEngine();
  engine.addPlayer("p1", "Alice");
  engine.addPlayer("p2", "Bob");
  engine.setReady("p1");
  engine.setReady("p2");

  let lastQuestionId = null;
  const drive = setInterval(() => {
    if (engine.state === "playing" && engine.currentQuestion && engine.currentQuestion.id !== lastQuestionId) {
      lastQuestionId = engine.currentQuestion.id;
      const correct = engine.currentQuestion.correctOption;
      engine.submitAnswer("p1", lastQuestionId, correct); // p1 always first & correct
      setTimeout(() => engine.submitAnswer("p2", lastQuestionId, correct), 5); // p2 always second & correct
    }
  }, 5);

  await waitUntil(() => engine.state === "finished", 5000);
  clearInterval(drive);

  const alice = engine.players.find((p) => p.id === "p1");
  const bob = engine.players.find((p) => p.id === "p2");
  // Alice answers first & correct every time -> full points for all 6 fixture questions (750 total).
  assert.equal(alice.score, 750);
  // Bob answers second & correct every time -> runner-up (30) each -> 6 * 30 = 180.
  assert.equal(bob.score, 180);
});

test("a section ends when its time is up, even with unanswered questions left in the pool", async () => {
  const { engine } = makeEngine({ COUNTDOWN_MS: 10, SECTION_DURATION_MS: 60, QUESTION_TIMEOUT_MS: 5000, RUNNER_UP_POINTS: 30 });
  engine.addPlayer("p1", "Alice");
  engine.addPlayer("p2", "Bob");
  engine.setReady("p1");
  engine.setReady("p2");

  // Nobody answers anything; section time (60ms) is far shorter than the question timeout (5s),
  // so the round must end on the clock, not by exhausting/timing out every question.
  await waitUntil(() => engine.currentRound === "R2" || engine.state === "finished", 2000);
  assert.notEqual(engine.currentRound, "R1");
});

test("disconnecting mid-match keeps the player's slot and score; reconnecting with the same id restores them", async () => {
  const { engine } = makeEngine();
  engine.addPlayer("p1", "Alice");
  engine.addPlayer("p2", "Bob");
  engine.setReady("p1");
  engine.setReady("p2");
  await waitUntil(() => engine.state === "playing");

  const qid = engine.currentQuestion.id;
  const correct = engine.currentQuestion.correctOption;
  engine.submitAnswer("p1", qid, correct);
  engine.submitAnswer("p2", qid, correct);
  await waitUntil(() => engine.currentQuestion?.id !== qid);

  const bobScoreBeforeDrop = engine.players.find((p) => p.id === "p2").score;
  engine.disconnectPlayer("p2");

  const bobAfterDrop = engine.players.find((p) => p.id === "p2");
  assert.ok(bobAfterDrop, "player should still be present after a mid-match disconnect");
  assert.equal(bobAfterDrop.connected, false);
  assert.equal(bobAfterDrop.score, bobScoreBeforeDrop);
  assert.equal(engine.players.length, 2, "slot must not be freed up for a new joiner mid-match");

  const rejoin = engine.addPlayer("p2", "Bob");
  assert.equal(rejoin.ok, true);
  assert.equal(rejoin.slot, 2);
  assert.equal(engine.players.find((p) => p.id === "p2").connected, true);
  assert.equal(engine.players.find((p) => p.id === "p2").score, bobScoreBeforeDrop, "score must survive the reconnect");
});

test("a stranger cannot steal a disconnected player's slot mid-match", async () => {
  const { engine } = makeEngine();
  engine.addPlayer("p1", "Alice");
  engine.addPlayer("p2", "Bob");
  engine.setReady("p1");
  engine.setReady("p2");
  await waitUntil(() => engine.state === "playing");

  engine.disconnectPlayer("p2");
  const intruder = engine.addPlayer("p3", "Eve");
  assert.equal(intruder.ok, false);
});

test("disconnecting during the countdown cancels it and returns to lobby", () => {
  const { engine } = makeEngine();
  engine.addPlayer("p1", "Alice");
  engine.addPlayer("p2", "Bob");
  engine.setReady("p1");
  engine.setReady("p2");
  assert.equal(engine.state, "countdown");

  engine.disconnectPlayer("p2");
  assert.equal(engine.state, "lobby");
  assert.equal(engine.players.length, 1);
  assert.equal(engine.players[0].ready, false);
});

test("a finished match is immutable: disconnecting afterward does not change players or re-emit", async () => {
  const { engine, events } = makeEngine();
  engine.addPlayer("p1", "Alice");
  engine.addPlayer("p2", "Bob");
  engine.setReady("p1");
  engine.setReady("p2");
  await waitUntil(() => engine.state === "playing");

  // Let the whole match run out without anyone answering (fastest deterministic path to "finished").
  await waitUntil(() => engine.state === "finished", 5000);

  const eventCountAtFinish = events.length;
  const playersSnapshotAtFinish = JSON.stringify(engine.players);

  engine.disconnectPlayer("p1");
  engine.disconnectPlayer("p2");

  assert.equal(events.length, eventCountAtFinish, "no further state broadcasts after finish");
  assert.equal(JSON.stringify(engine.players), playersSnapshotAtFinish, "players must not change after finish");
});
