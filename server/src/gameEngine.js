import { randomUUID } from "node:crypto";
import { GAME_STATES, ROUNDS, DEFAULTS, LANGUAGES, DEFAULT_LANGUAGE, scoreAnswers } from "./gameContract.js";

// Short, URL-friendly code identifying one match "session" — embedded in the booth
// screen's QR code so a stale/previous session's QR can't be used to join a new one.
function generateMatchCode() {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// correctOption is only ever included once both players have answered (or the question
// timed out) — that's the "reveal" window, when it's no longer possible to cheat with it.
function publicQuestion(question, { reveal = false } = {}) {
  if (!question) return null;
  const { id, prompt, optionA, optionB, difficulty, points, correctOption, optionAImage, optionBImage, questionImage } = question;
  return {
    id, prompt, optionA, optionB, difficulty, points, optionAImage, optionBImage, questionImage,
    ...(reveal ? { correctOption } : {}),
  };
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

  // Admin config changes apply as soon as they'd naturally come up next: SECTION_DURATION_MS
  // and COUNTDOWN_MS only affect the next section/match (sectionEndsAt/countdownEndsAt are
  // fixed timestamps computed once and not recomputed), but QUESTION_TIMEOUT_MS and
  // RUNNER_UP_POINTS take effect on the very next question, even mid-section, since those
  // are read live each time. Either way, nothing already scheduled changes duration.
  updateConfig(partial) {
    this.config = { ...this.config, ...partial };
  }

  reset() {
    this._cancelCountdown();
    this._cancelQuestionTimer();
    this._cancelReveal();
    this.state = GAME_STATES.LOBBY;
    this.players = []; // { id, name, slot, ready, score, connected, answeredCount, timeSpentMs }
    this.countdownEndsAt = null;
    this.roundIndex = -1;
    this.currentRound = null;
    this.roundQueue = [];
    this.currentQuestion = null; // full question, incl. correctOption (only sent to clients during the reveal window)
    this.questionShownAt = null;
    this.sectionEndsAt = null;
    this.revealUntil = null;
    this.answerOrder = []; // [{ playerId, choice }] in receipt order, for the current question
    this.winnerId = null; // set once, in _finish() — null means a genuine tie (equal score AND equal time)
    this.tieBroken = false; // true when winnerId was decided by time-spent, not score
    this.matchCode = generateMatchCode();
    this.language = DEFAULT_LANGUAGE; // shared for both players — see setLanguage()
  }

  getSnapshot() {
    const counts = { A: 0, B: 0 };
    this.answerOrder.forEach(({ choice }) => counts[choice]++);
    const revealing = this.revealUntil !== null;
    const answeredIds = new Set(this.answerOrder.map((a) => a.playerId));

    return {
      state: this.state,
      players: this.players.map(({ id, name, slot, ready, score, connected, answeredCount, timeSpentMs }) => ({
        id, name, slot, ready, score, connected, answeredCount, timeSpentMs,
        // Whether they've locked in an answer for the CURRENT question — not what they
        // picked (that stays hidden until reveal), just that they've answered.
        hasAnsweredCurrent: answeredIds.has(id),
      })),
      winnerId: this.winnerId,
      tieBroken: this.tieBroken,
      matchCode: this.matchCode,
      language: this.language,
      countdownEndsAt: this.countdownEndsAt,
      currentRound: this.currentRound,
      sectionEndsAt: this.sectionEndsAt,
      sectionDurationMs: this.config.SECTION_DURATION_MS, // so clients can render an accurate round-progress bar
      currentQuestion: publicQuestion(this.currentQuestion, { reveal: revealing }),
      revealUntil: this.revealUntil,
      answerCounts: counts,
    };
  }

  _emit() {
    this.onChange(this.getSnapshot());
  }

  // `code` must match this session's matchCode (from the QR the player scanned) — this
  // is what stops a stale QR from a previous match (or a screenshot of one) from being
  // used to join or silently re-enter a later session, even for an already-joined
  // player reconnecting: their code is fixed at page-load time from the URL they're on,
  // so it naturally stops matching once the match they were in ends and a new one starts.
  // `error` is an English fallback (server logs, admin/API debugging); `errorCode` is the
  // stable identifier the client actually translates and displays — see client/src/i18n.js.
  addPlayer(id, name, code) {
    if (code !== this.matchCode) {
      return { ok: false, errorCode: "qr_expired", error: "This QR code has expired — scan the current one on the booth screen." };
    }
    const existing = this.players.find((p) => p.id === id);
    if (existing) {
      existing.connected = true;
      if (name) existing.name = name; // a repeat/retry join can arrive with the real name after an earlier placeholder one
      this._emit();
      return { ok: true, slot: existing.slot };
    }

    if (this.state !== GAME_STATES.LOBBY) {
      return { ok: false, errorCode: "match_in_progress", error: "Match already in progress" };
    }
    if (this.players.length >= 2) {
      return { ok: false, errorCode: "match_full", error: "Match is full" };
    }

    // name stays null (not a hardcoded English "Player N") until a real one is submitted —
    // clients render their own translated placeholder for an unnamed opponent, since the
    // engine itself has no notion of a display language.
    const slot = this.players.length + 1;
    this.players.push({ id, name: name || null, slot, ready: false, score: 0, connected: true, answeredCount: 0, timeSpentMs: 0 });
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

    // Only the very first (pre-round-1) countdown reverts to lobby on disconnect —
    // nothing is at stake yet. A countdown between rounds 2/3 has real scores riding
    // on it already, so it must be treated like a mid-match disconnect instead
    // (below): flag offline, keep slot/score, let them reconnect.
    if (this.state === GAME_STATES.COUNTDOWN && this.roundIndex === -1) {
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

  // Only the first player to join (slot 1) can set the match language, and only before
  // the match starts — this is what makes "first player's choice sets it for both" true
  // without a race: player 2 never gets a setLanguage of their own, they just inherit
  // whatever's already in the shared snapshot by the time they join.
  setLanguage(id, language) {
    if (this.state !== GAME_STATES.LOBBY) return;
    if (!LANGUAGES.includes(language)) return;
    const player = this.players.find((p) => p.id === id);
    if (!player || player.slot !== 1) return;
    this.language = language;
    this._emit();
  }

  setReady(id) {
    const player = this.players.find((p) => p.id === id);
    if (!player || this.state !== GAME_STATES.LOBBY) return;

    player.ready = true;
    this._emit();

    if (this.players.length === 2 && this.players.every((p) => p.ready)) {
      this.roundIndex = -1; // fresh match kickoff — this is the only place this resets
      this._startCountdown();
    }
  }

  _startCountdown() {
    this._cancelCountdown(); // in case a stray prior timer is still pending — never leave two live
    this.state = GAME_STATES.COUNTDOWN;
    this.countdownEndsAt = Date.now() + this.config.COUNTDOWN_MS;
    // Show the round this countdown is FOR (upcoming), not the one that just ended —
    // roundIndex hasn't been incremented yet, so peek one ahead.
    this.currentRound = ROUNDS[this.roundIndex + 1];
    this._emit();

    this._countdownTimer = setTimeout(() => {
      this.countdownEndsAt = null;
      this._countdownTimer = null;
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
    // Guards against a stray/orphaned countdown timer (see _startCountdown) firing this
    // a second time after the state has already moved on — that would double-increment
    // roundIndex and silently skip an entire round straight to _finish().
    if (this.state !== GAME_STATES.COUNTDOWN) return;
    this.roundIndex++;
    if (this.roundIndex >= ROUNDS.length) {
      this._finish();
      return;
    }

    this.state = GAME_STATES.PLAYING;
    this.currentRound = ROUNDS[this.roundIndex];
    this.roundQueue = shuffle(this.questionsByRound[this.currentRound] || []);
    if (this.roundQueue.length === 0) {
      // Not a crash, but a real operational trap: this round (or the whole match, if every
      // round is empty) will be skipped silently with no visible warning otherwise — an
      // admin who deactivated/deleted every question in a round should see this in the log.
      console.warn(`[gameEngine] round ${this.currentRound} has zero active questions — skipping it`);
    }
    this.sectionEndsAt = Date.now() + this.config.SECTION_DURATION_MS;
    this._serveNextQuestion();
  }

  _serveNextQuestion() {
    // Guards against a stray/orphaned reveal timer (see _startReveal) firing this after
    // the state has already moved on (e.g. into the next round's countdown) — without
    // this, it would read stale leftover sectionEndsAt/roundQueue and could trigger a
    // second, uninvited _endSection() for a round that's already been left behind.
    if (this.state !== GAME_STATES.PLAYING) return;
    const remaining = this.sectionEndsAt - Date.now();
    if (remaining <= 0 || this.roundQueue.length === 0) {
      this._endSection();
      return;
    }

    this.currentQuestion = this.roundQueue.shift();
    this.questionShownAt = Date.now();
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

  // A round's time (or question pool) is up: go straight into the next round's
  // countdown (which already shows that round's name), or finish if it was the last one.
  _endSection() {
    this._cancelQuestionTimer();
    this.currentQuestion = null;
    this.sectionEndsAt = null;
    const isLastRound = this.roundIndex >= ROUNDS.length - 1;
    if (isLastRound) {
      this._finish();
    } else {
      this._startCountdown();
    }
  }

  submitAnswer(playerId, questionId, choice) {
    if (this.state !== GAME_STATES.PLAYING) return;
    if (!this.currentQuestion || this.currentQuestion.id !== questionId) return;
    if (!["A", "B"].includes(choice)) return;
    if (this.answerOrder.some((a) => a.playerId === playerId)) return; // one answer per player per question
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return;

    player.answeredCount += 1;
    player.timeSpentMs += Math.max(0, Date.now() - this.questionShownAt);

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
    this._startReveal();
  }

  // Hold on the resolved question for a beat — correct answer + pick counts visible —
  // before moving on. Without this, the question would change before anyone could see it.
  _startReveal() {
    this._cancelReveal(); // in case a stray prior timer is still pending — never leave two live
    this.revealUntil = Date.now() + this.config.REVEAL_MS;
    this._emit();

    this._revealTimer = setTimeout(() => {
      this.revealUntil = null;
      this._revealTimer = null;
      this._serveNextQuestion();
    }, this.config.REVEAL_MS);
  }

  _cancelReveal() {
    if (this._revealTimer) {
      clearTimeout(this._revealTimer);
      this._revealTimer = null;
    }
    this.revealUntil = null;
  }

  _finish() {
    // Cancel every pending timer — otherwise a forceEnd() (or a natural finish racing
    // with one) leaves one live, and it fires later flipping "finished" back to active.
    this._cancelCountdown();
    this._cancelQuestionTimer();
    this._cancelReveal();
    this.state = GAME_STATES.FINISHED;
    this.currentRound = null;
    this.currentQuestion = null;
    this.sectionEndsAt = null;
    this._decideWinner();
    this._emit();
  }

  // Server-authoritative winner decision, computed once at finish so every client reads
  // the same answer instead of each independently comparing raw scores. A tied score is
  // broken by total time spent (faster wins); only an exact tie on BOTH score and time
  // is a genuine, undecided tie (winnerId stays null).
  _decideWinner() {
    const [a, b] = this.players;
    if (!a || !b) {
      this.winnerId = null;
      this.tieBroken = false;
      return;
    }
    if (a.score !== b.score) {
      this.winnerId = a.score > b.score ? a.id : b.id;
      this.tieBroken = false;
    } else if (a.timeSpentMs !== b.timeSpentMs) {
      this.winnerId = a.timeSpentMs < b.timeSpentMs ? a.id : b.id;
      this.tieBroken = true;
    } else {
      this.winnerId = null;
      this.tieBroken = false;
    }
  }

  // Admin recovery control: end a stuck match right now, keeping whatever scores
  // stand — goes through the normal finish path, so the result still persists.
  forceEnd() {
    if (![GAME_STATES.COUNTDOWN, GAME_STATES.PLAYING].includes(this.state)) return;
    this._finish();
  }

  // Admin recovery control: abort the current match entirely — no persistence,
  // back to an empty lobby. For when a match is broken and shouldn't be logged.
  resetMatch() {
    this.reset();
    this._emit();
  }

  // Unauthenticated-safe: only ever does anything once the match has already finished
  // (result already persisted), so unlike resetMatch() it can't be used to disrupt a
  // live game — that's what lets the booth display offer it without an admin token.
  openNextMatch() {
    if (this.state !== GAME_STATES.FINISHED) return;
    this.reset();
    this._emit();
  }
}
