// Shared shape used by the game engine, and consumed by the play/screen/admin clients.

export const GAME_STATES = Object.freeze({
  LOBBY: "lobby",
  COUNTDOWN: "countdown",
  PLAYING: "playing",
  FINISHED: "finished",
});

export const ROUNDS = ["R1", "R2", "R3"];

// Client -> server
export const COMMANDS = Object.freeze({
  JOIN: "join",
  READY: "ready",
  ANSWER: "answer",
  SUBMIT_EMAIL: "submitEmail",
});

// Server -> client: a single full-state snapshot, broadcast on every change.
export const STATE_EVENT = "state";

export const DEFAULTS = Object.freeze({
  COUNTDOWN_MS: 3000,
  SECTION_DURATION_MS: 60000,
  QUESTION_TIMEOUT_MS: 25000,
  RUNNER_UP_POINTS: 30,
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email) {
  return typeof email === "string" && EMAIL_PATTERN.test(email.trim());
}

export const DIFFICULTY_POINTS = Object.freeze({
  Easy: 100,
  Medium: 150,
  Hard: 200,
});

/**
 * Score a single question given the order players answered in.
 * @param {{ correctOption: "A"|"B", points: number }} question
 * @param {Array<{ playerId: string, choice: "A"|"B" }>} orderedAnswers - in server-receipt order
 * @param {number} runnerUpPoints
 * @returns {Record<string, number>} playerId -> points awarded for this question
 */
export function scoreAnswers(question, orderedAnswers, runnerUpPoints = DEFAULTS.RUNNER_UP_POINTS) {
  const results = {};
  if (orderedAnswers.length === 0) return results;

  const [first, second] = orderedAnswers;
  const firstCorrect = first.choice === question.correctOption;
  results[first.playerId] = firstCorrect ? question.points : 0;

  if (second) {
    const secondCorrect = second.choice === question.correctOption;
    if (secondCorrect && firstCorrect) {
      results[second.playerId] = runnerUpPoints;
    } else if (secondCorrect && !firstCorrect) {
      results[second.playerId] = question.points;
    } else {
      results[second.playerId] = 0;
    }
  }

  return results;
}
