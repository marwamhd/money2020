// Deterministic question set for engine tests — independent of the real question bank
// so tests never break just because someone edits questions.json.
export const TEST_QUESTIONS = [
  { id: "R1-a", round: "R1", prompt: "q1", optionA: "X", optionB: "Y", correctOption: "A", points: 100 },
  { id: "R1-b", round: "R1", prompt: "q2", optionA: "X", optionB: "Y", correctOption: "B", points: 150 },
  { id: "R2-a", round: "R2", prompt: "q3", optionA: "X", optionB: "Y", correctOption: "A", points: 100 },
  { id: "R2-b", round: "R2", prompt: "q4", optionA: "X", optionB: "Y", correctOption: "B", points: 150 },
  { id: "R3-a", round: "R3", prompt: "q5", optionA: "X", optionB: "Y", correctOption: "A", points: 100 },
  { id: "R3-b", round: "R3", prompt: "q6", optionA: "X", optionB: "Y", correctOption: "B", points: 150 },
];

export function waitUntil(predicate, timeoutMs = 3000, intervalMs = 5) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error("waitUntil: condition never became true"));
      }
    }, intervalMs);
  });
}
