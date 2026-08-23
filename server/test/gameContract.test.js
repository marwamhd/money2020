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

test("both correct: second gets the question's own points minus the runner-up penalty", () => {
  const result = scoreAnswers(q, [
    { playerId: "p1", choice: "A" },
    { playerId: "p2", choice: "A" },
  ], 30);
  assert.deepEqual(result, { p1: 100, p2: 70 }); // 100 - 30
});

test("both correct on a Hard question: second gets 200 - 30 = 170, not a flat 30", () => {
  const hard = { correctOption: "A", points: 200 };
  const result = scoreAnswers(hard, [
    { playerId: "p1", choice: "A" },
    { playerId: "p2", choice: "A" },
  ], 30);
  assert.deepEqual(result, { p1: 200, p2: 170 });
});

test("the runner-up penalty never pushes the second player's score below zero", () => {
  const cheap = { correctOption: "A", points: 10 };
  const result = scoreAnswers(cheap, [
    { playerId: "p1", choice: "A" },
    { playerId: "p2", choice: "A" },
  ], 30);
  assert.deepEqual(result, { p1: 10, p2: 0 });
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
