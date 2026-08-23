import { GAME_STATES, ROUNDS, DEFAULTS, scoreAnswers } from "./gameContract.js";

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function publicQuestion(question) {
  if (!question) return null;
  const { id, prompt, optionA, optionB } = question;
  return { id, prompt, optionA, optionB };
}

export class GameEngine {
  constructor(questions, onChange = () => {}, config = {}) {
    this.setQuestions(questions);
    this.onChange = onChange;
    this.config = { ...DEFAULTS, ...config };
    this.reset();
  }

  // Admin edits to the question bank only take effect for the next section/match —
  // a round already in progress keeps the queue it already shuffled.
  setQuestions(questions) {
    this.questionsByRound = Object.fromEntries(
      ROUNDS.map((round) => [round, questions.filter((q) => q.round === round)])
    );
  }

  // Admin config changes (section/question timing, runner-up points) apply from the
  // next section/match onward — timers already scheduled keep their original duration.
  updateConfig(partial) {
    this.config = { ...this.config, ...partial };
  }

  reset() {
    this._cancelCountdown();
    this._cancelQuestionTimer();
    this.state = GAME_STATES.LOBBY;
    this.players = []; // { id, name, slot, ready, score, connected }
    this.countdownEndsAt = null;
    this.roundIndex = -1;
    this.currentRound = null;
    this.roundQueue = [];
    this.currentQuestion = null; // full question, incl. correctOption (never sent to clients directly)
    this.sectionEndsAt = null;
    this.answerOrder = []; // [{ playerId, choice }] in receipt order, for the current question
  }

  getSnapshot() {
    const counts = { A: 0, B: 0 };
    this.answerOrder.forEach(({ choice }) => counts[choice]++);

    return {
      state: this.state,
      players: this.players.map(({ id, name, slot, ready, score, connected }) => ({ id, name, slot, ready, score, connected })),
      countdownEndsAt: this.countdownEndsAt,
      currentRound: this.currentRound,
      sectionEndsAt: this.sectionEndsAt,
      currentQuestion: publicQuestion(this.currentQuestion),
      answerCounts: counts,
    };
  }

  _emit() {
    this.onChange(this.getSnapshot());
  }

  addPlayer(id, name) {
    const existing = this.players.find((p) => p.id === id);
    if (existing) {
      existing.connected = true;
      this._emit();
      return { ok: true, slot: existing.slot };
    }

    if (this.state !== GAME_STATES.LOBBY) {
      return { ok: false, error: "Match already in progress" };
    }
    if (this.players.length >= 2) {
      return { ok: false, error: "Match is full" };
    }

    const slot = this.players.length + 1;
    this.players.push({ id, name, slot, ready: false, score: 0, connected: true });
    this._emit();
    return { ok: true, slot };
  }

  // Called when a player's socket disconnects. Mid-match this only flags them as
  // offline — their slot/score/ready are preserved so the same id can reconnect
  // and resume via addPlayer. Only lobby (nothing at stake yet) frees the slot outright.
  disconnectPlayer(id) {
    const player = this.players.find((p) => p.id === id);
    if (!player) return;
    if (this.state === GAME_STATES.FINISHED) return; // finished result is immutable until admin reset

    if (this.state === GAME_STATES.LOBBY) {
      this.players = this.players.filter((p) => p.id !== id);
      this._emit();
      return;
    }

    if (this.state === GAME_STATES.COUNTDOWN) {
      this._cancelCountdown();
      this.state = GAME_STATES.LOBBY;
      this.players = this.players.filter((p) => p.id !== id);
      this.players.forEach((p) => (p.ready = false));
      this._emit();
      return;
    }

    player.connected = false;
    this._emit();
  }

  setReady(id) {
    const player = this.players.find((p) => p.id === id);
    if (!player || this.state !== GAME_STATES.LOBBY) return;

    player.ready = true;
    this._emit();

    if (this.players.length === 2 && this.players.every((p) => p.ready)) {
      this._startCountdown();
    }
  }

  _startCountdown() {
    this.state = GAME_STATES.COUNTDOWN;
    this.countdownEndsAt = Date.now() + this.config.COUNTDOWN_MS;
    this._emit();

    this._countdownTimer = setTimeout(() => {
      this.countdownEndsAt = null;
      this._countdownTimer = null;
      this.roundIndex = -1;
      this._startNextSection();
    }, this.config.COUNTDOWN_MS);
  }

  _cancelCountdown() {
    if (this._countdownTimer) {
      clearTimeout(this._countdownTimer);
      this._countdownTimer = null;
    }
    this.countdownEndsAt = null;
  }

  _startNextSection() {
    this.roundIndex++;
    if (this.roundIndex >= ROUNDS.length) {
      this._finish();
      return;
    }

    this.state = GAME_STATES.PLAYING;
    this.currentRound = ROUNDS[this.roundIndex];
    this.roundQueue = shuffle(this.questionsByRound[this.currentRound] || []);
    this.sectionEndsAt = Date.now() + this.config.SECTION_DURATION_MS;
    this._serveNextQuestion();
  }

  _serveNextQuestion() {
    const remaining = this.sectionEndsAt - Date.now();
    if (remaining <= 0 || this.roundQueue.length === 0) {
      this._startNextSection();
      return;
    }

    this.currentQuestion = this.roundQueue.shift();
    this.answerOrder = [];
    this._emit();

    const timeout = Math.min(this.config.QUESTION_TIMEOUT_MS, remaining);
    this._questionTimer = setTimeout(() => this._resolveQuestion(), timeout);
  }

  _cancelQuestionTimer() {
    if (this._questionTimer) {
      clearTimeout(this._questionTimer);
      this._questionTimer = null;
    }
  }

  submitAnswer(playerId, questionId, choice) {
    if (this.state !== GAME_STATES.PLAYING) return;
    if (!this.currentQuestion || this.currentQuestion.id !== questionId) return;
    if (!["A", "B"].includes(choice)) return;
    if (this.answerOrder.some((a) => a.playerId === playerId)) return; // one answer per player per question
    if (!this.players.some((p) => p.id === playerId)) return;

    this.answerOrder.push({ playerId, choice });
    this._emit();

    if (this.answerOrder.length === this.players.length) {
      this._cancelQuestionTimer();
      this._resolveQuestion();
    }
  }

  _resolveQuestion() {
    this._cancelQuestionTimer();
    const awarded = scoreAnswers(this.currentQuestion, this.answerOrder, this.config.RUNNER_UP_POINTS);
    Object.entries(awarded).forEach(([playerId, points]) => {
      const player = this.players.find((p) => p.id === playerId);
      if (player) player.score += points;
    });
    this._emit();
    this._serveNextQuestion();
  }

  _finish() {
    this._cancelQuestionTimer();
    this.state = GAME_STATES.FINISHED;
    this.currentRound = null;
    this.currentQuestion = null;
    this.sectionEndsAt = null;
    this._emit();
  }

  // Admin recovery control: end a stuck match right now, keeping whatever scores
  // stand — goes through the normal finish path, so the result still persists.
  forceEnd() {
    if (this.state !== GAME_STATES.COUNTDOWN && this.state !== GAME_STATES.PLAYING) return;
    this._finish();
  }

  // Admin recovery control: abort the current match entirely — no persistence,
  // back to an empty lobby. For when a match is broken and shouldn't be logged.
  resetMatch() {
    this.reset();
    this._emit();
  }
}
