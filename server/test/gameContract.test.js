import test from "node:test";
import assert from "node:assert/strict";
import { scoreAnswers } from "../src/gameContract.js";

const q = { correctOption: "A", points: 100 };

test("first correct, no second answer: full points", () => {
  const result = scoreAnswers(q, [{ playerId: "p1", choice: "A" }]);
  assert.deepEqual(result, { p1: 100 });
});

test("first wrong, second correct: second gets full points", () => {
  const result = scoreAnswers(q, [
    { playerId: "p1", choice: "B" },
    { playerId: "p2", choice: "A" },
  ]);
  assert.deepEqual(result, { p1: 0, p2: 100 });
});

test("both correct: second gets the runner-up points, not full", () => {
  const result = scoreAnswers(q, [
    { playerId: "p1", choice: "A" },
    { playerId: "p2", choice: "A" },
  ], 30);
  assert.deepEqual(result, { p1: 100, p2: 30 });
});

test("first correct, second wrong: second gets zero", () => {
  const result = scoreAnswers(q, [
    { playerId: "p1", choice: "A" },
    { playerId: "p2", choice: "B" },
  ]);
  assert.deepEqual(result, { p1: 100, p2: 0 });
});

test("both wrong: zero for both", () => {
  const result = scoreAnswers(q, [
    { playerId: "p1", choice: "B" },
    { playerId: "p2", choice: "B" },
  ]);
  assert.deepEqual(result, { p1: 0, p2: 0 });
});

test("no answers: empty result, nobody scores", () => {
  const result = scoreAnswers(q, []);
  assert.deepEqual(result, {});
});
