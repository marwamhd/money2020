import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../src/gameEngine.js";
import { TEST_QUESTIONS, waitUntil } from "../testSupport/fixtures.js";

const FAST_CONFIG = { COUNTDOWN_MS: 30, SECTION_DURATION_MS: 500, QUESTION_TIMEOUT_MS: 200, RUNNER_UP_POINTS: 30, REVEAL_MS: 10 };

function makeEngine(config = FAST_CONFIG) {
  const events = [];
  const engine = new GameEngine(TEST_QUESTIONS, (snap) => events.push(snap), config);
  // Auto-supplies the current match code so every existing addPlayer(id, name) call below
  // keeps working unchanged — those tests are about other behavior, not code validation,
  // which gets its own dedicated tests further down using the real 3-arg form directly.
  const realAddPlayer = engine.addPlayer.bind(engine);
  engine.addPlayer = (id, name) => realAddPlayer(id, name, engine.matchCode);
  return { engine, events };
}

test("a join with the wrong match code (a stale QR from a previous session) is rejected", () => {
  const engine = new GameEngine(TEST_QUESTIONS, () => {}, FAST_CONFIG);
  const result = engine.addPlayer("p1", "Alice", "not-the-real-code");
  assert.equal(result.ok, false);
  assert.equal(engine.players.length, 0);
});

test("a join with the correct current match code succeeds", () => {
  const engine = new GameEngine(TEST_QUESTIONS, () => {}, FAST_CONFIG);
  const result = engine.addPlayer("p1", "Alice", engine.matchCode);
  assert.equal(result.ok, true);
});

test("openNextMatch issues a fresh match code, invalidating the previous session's QR", async () => {
  const engine = new GameEngine(TEST_QUESTIONS, () => {}, FAST_CONFIG);
  const oldCode = engine.matchCode;
  engine.addPlayer("p1", "Alice", oldCode);
  engine.addPlayer("p2", "Bob", oldCode);
  engine.setReady("p1");
  engine.setReady("p2");
  engine.forceEnd();
  assert.equal(engine.state, "finished");

  engine.openNextMatch();
  assert.notEqual(engine.matchCode, oldCode);
  const stale = engine.addPlayer("p3", "Carl", oldCode);
  assert.equal(stale.ok, false, "the previous session's code must no longer work");
});

test("a reconnecting player must still supply the current match code, not just any code", () => {
  const engine = new GameEngine(TEST_QUESTIONS, () => {}, FAST_CONFIG);
  engine.addPlayer("p1", "Alice", engine.matchCode);
  const staleReconnect = engine.addPlayer("p1", "Alice", "wrong-code");
  assert.equal(staleReconnect.ok, false);
});

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

test("answering tracks answeredCount and timeSpentMs per player; not answering leaves both untouched", async () => {
  const { engine } = makeEngine({ COUNTDOWN_MS: 30, SECTION_DURATION_MS: 500, QUESTION_TIMEOUT_MS: 200, RUNNER_UP_POINTS: 30 });
  engine.addPlayer("p1", "Alice");
  engine.addPlayer("p2", "Bob");
  engine.setReady("p1");
  engine.setReady("p2");
  await waitUntil(() => engine.state === "playing");

  const qid = engine.currentQuestion.id;
  await new Promise((r) => setTimeout(r, 30)); // let a little real time pass before answering
  engine.submitAnswer("p1", qid, "A");
  // p2 never answers this question — the timeout will advance it.

  const alice = engine.players.find((p) => p.id === "p1");
  const bob = engine.players.find((p) => p.id === "p2");
  assert.equal(alice.answeredCount, 1);
  assert.ok(alice.timeSpentMs >= 25, `expected some measurable time spent, got ${alice.timeSpentMs}ms`);
  assert.equal(bob.answeredCount, 0);
  assert.equal(bob.timeSpentMs, 0);
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
  // Bob answers second & correct every time -> each question's own points minus the 30pt
  // runner-up penalty: 3x(100-30) + 3x(150-30) = 210 + 360 = 570.
  assert.equal(bob.score, 570);
});

test("a section ends when its time is up, even with unanswered questions left in the pool", async () => {
  const { engine } = makeEngine({ COUNTDOWN_MS: 10, SECTION_DURATION_MS: 60, QUESTION_TIMEOUT_MS: 5000, RUNNER_UP_POINTS: 30, REVEAL_MS: 10 });
  engine.addPlayer("p1", "Alice");
  engine.addPlayer("p2", "Bob");
  engine.setReady("p1");
  engine.setReady("p2");

  // Nobody answers anything; section time (60ms) is far shorter than the question timeout (5s),
  // so the round must end on the clock (moving into the next round's countdown), not by
  // exhausting/timing out every question.
  await waitUntil(() => (engine.state === "countdown" && engine.roundIndex === 0) || engine.state === "finished", 2000);
  assert.notEqual(engine.state, "playing");
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

test("a full round transitions playing -> countdown (showing the upcoming round) -> playing (round 2), with no separate break", async () => {
  const { engine } = makeEngine({ COUNTDOWN_MS: 60, SECTION_DURATION_MS: 40, QUESTION_TIMEOUT_MS: 5000, RUNNER_UP_POINTS: 30, REVEAL_MS: 10 });
  engine.addPlayer("p1", "Alice");
  engine.addPlayer("p2", "Bob");
  engine.setReady("p1");
  engine.setReady("p2");
  await waitUntil(() => engine.state === "playing"); // round 1

  await waitUntil(() => engine.state === "countdown" && engine.roundIndex === 0);
  assert.equal(engine.currentRound, "R2", "the between-round countdown must already show the upcoming round, not the one that just ended");
  assert.equal(engine.currentQuestion, null);

  await waitUntil(() => engine.state === "playing" && engine.currentRound === "R2");
});

test("an orphaned duplicate countdown timer firing after the round already started does not skip a round", () => {
  const { engine } = makeEngine();
  engine.addPlayer("p1", "Alice");
  engine.addPlayer("p2", "Bob");
  engine.setReady("p1");
  engine.setReady("p2");
  assert.equal(engine.state, "countdown");

  engine._startNextSection(); // the real transition into round 1
  assert.equal(engine.state, "playing");
  assert.equal(engine.roundIndex, 0);

  // Simulates a second, orphaned countdown timer (see _startCountdown's own guard
  // against this) firing again after the state already moved on — must be a no-op,
  // not a second incrementing of roundIndex.
  engine._startNextSection();
  assert.equal(engine.roundIndex, 0, "roundIndex must not double-increment from a stray call");
  assert.equal(engine.state, "playing");
  assert.equal(engine.currentRound, "R1");
});

test("an orphaned duplicate reveal timer firing after the round already ended does not re-trigger _endSection", () => {
  const { engine } = makeEngine();
  engine.addPlayer("p1", "Alice");
  engine.addPlayer("p2", "Bob");
  engine.setReady("p1");
  engine.setReady("p2");
  engine._startNextSection(); // into round 1, playing
  assert.equal(engine.state, "playing");

  engine._endSection(); // simulates the round's real, legitimate end
  const roundIndexAfterRealEnd = engine.roundIndex;
  const stateAfterRealEnd = engine.state;

  // Simulates a second, orphaned reveal timer (see _startReveal's own guard against
  // this) calling _serveNextQuestion after the state already moved past "playing" —
  // must be a no-op, not a second _endSection() acting on stale leftover state.
  engine._serveNextQuestion();
  assert.equal(engine.roundIndex, roundIndexAfterRealEnd, "a stray call must not advance roundIndex again");
  assert.equal(engine.state, stateAfterRealEnd, "a stray call must not change state again");
});

test("disconnecting during a between-round countdown (round 2/3) does NOT wipe progress, unlike the kickoff countdown", async () => {
  const { engine } = makeEngine({ COUNTDOWN_MS: 60, SECTION_DURATION_MS: 40, QUESTION_TIMEOUT_MS: 5000, RUNNER_UP_POINTS: 30, REVEAL_MS: 10 });
  engine.addPlayer("p1", "Alice");
  engine.addPlayer("p2", "Bob");
  engine.setReady("p1");
  engine.setReady("p2");
  await waitUntil(() => engine.state === "playing");
  await waitUntil(() => engine.state === "countdown" && engine.roundIndex === 0); // the between-round countdown into R2

  engine.disconnectPlayer("p2");
  assert.equal(engine.state, "countdown", "must stay in the between-round countdown, not revert to lobby");
  assert.equal(engine.players.length, 2, "the disconnected player's slot/progress must be preserved");
  assert.equal(engine.players.find((p) => p.id === "p2").connected, false);
});

test("forceEnd during the initial countdown finishes cleanly and does not resurrect afterward", async () => {
  const { engine } = makeEngine({ COUNTDOWN_MS: 100, SECTION_DURATION_MS: 500, QUESTION_TIMEOUT_MS: 200, RUNNER_UP_POINTS: 30 });
  engine.addPlayer("p1", "Alice");
  engine.addPlayer("p2", "Bob");
  engine.setReady("p1");
  engine.setReady("p2");
  assert.equal(engine.state, "countdown");

  engine.forceEnd();
  assert.equal(engine.state, "finished");

  // Wait well past the original countdown duration — if its timer wasn't cancelled,
  // it would fire here and flip the match back to "playing".
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(engine.state, "finished", "the countdown's own timer must not resurrect the match afterward");
});

test("the higher score wins outright, regardless of time spent", () => {
  const { engine } = makeEngine();
  engine.addPlayer("p1", "Alice");
  engine.addPlayer("p2", "Bob");
  engine.setReady("p1");
  engine.setReady("p2");
  engine.players[0].score = 300;
  engine.players[0].timeSpentMs = 50000; // slower...
  engine.players[1].score = 200;
  engine.players[1].timeSpentMs = 10000; // ...but faster; score still decides it
  engine.forceEnd();
  assert.equal(engine.winnerId, "p1");
  assert.equal(engine.tieBroken, false);
});

test("an equal score is broken by whoever spent less total time", () => {
  const { engine } = makeEngine();
  engine.addPlayer("p1", "Alice");
  engine.addPlayer("p2", "Bob");
  engine.setReady("p1");
  engine.setReady("p2");
  engine.players[0].score = 300;
  engine.players[0].timeSpentMs = 40000;
  engine.players[1].score = 300;
  engine.players[1].timeSpentMs = 25000; // faster
  engine.forceEnd();
  assert.equal(engine.winnerId, "p2");
  assert.equal(engine.tieBroken, true);
});

test("an equal score AND equal time is a genuine, undecided tie", () => {
  const { engine } = makeEngine();
  engine.addPlayer("p1", "Alice");
  engine.addPlayer("p2", "Bob");
  engine.setReady("p1");
  engine.setReady("p2");
  engine.players[0].score = 150;
  engine.players[0].timeSpentMs = 30000;
  engine.players[1].score = 150;
  engine.players[1].timeSpentMs = 30000;
  engine.forceEnd();
  assert.equal(engine.winnerId, null);
  assert.equal(engine.tieBroken, false);
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

test("openNextMatch is a no-op unless the match has actually finished, unlike admin resetMatch", async () => {
  const { engine } = makeEngine();
  engine.addPlayer("p1", "Alice");
  engine.addPlayer("p2", "Bob");
  engine.setReady("p1");
  engine.setReady("p2");
  await waitUntil(() => engine.state === "playing");

  engine.openNextMatch();
  assert.equal(engine.state, "playing", "must not disrupt a live match — this is what makes it safe with no admin token");

  await waitUntil(() => engine.state === "finished", 5000);
  engine.openNextMatch();
  assert.equal(engine.state, "lobby");
  assert.equal(engine.players.length, 0);
});

test("the match language defaults to English, and only the first player to join (slot 1) can change it", () => {
  const { engine } = makeEngine();
  assert.equal(engine.language, "en");

  engine.addPlayer("p1", "Alice");
  engine.addPlayer("p2", "Bob");

  engine.setLanguage("p2", "ar");
  assert.equal(engine.language, "en", "the second player must not be able to set the language");

  engine.setLanguage("p1", "ar");
  assert.equal(engine.language, "ar", "the first player's choice is what sticks");
});

test("setLanguage ignores an unknown language and a language change after the match has started", async () => {
  const { engine } = makeEngine();
  engine.addPlayer("p1", "Alice");

  engine.setLanguage("p1", "fr");
  assert.equal(engine.language, "en", "an unsupported language must be ignored");

  engine.addPlayer("p2", "Bob");
  engine.setReady("p1");
  engine.setReady("p2");
  await waitUntil(() => engine.state === "playing");

  engine.setLanguage("p1", "ar");
  assert.equal(engine.language, "en", "language can't change once the match has left the lobby");
});

test("a fresh match resets the language back to English, even if the previous one was played in Arabic", async () => {
  const { engine } = makeEngine();
  engine.addPlayer("p1", "Alice");
  engine.setLanguage("p1", "ar");
  engine.addPlayer("p2", "Bob");
  engine.setReady("p1");
  engine.setReady("p2");
  engine.forceEnd();
  assert.equal(engine.state, "finished");

  engine.openNextMatch();
  assert.equal(engine.language, "en");
});
