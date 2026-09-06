import { useEffect, useRef, useState } from "react";
import { useGameSocket, useCountdown, ReconnectingBanner } from "../useGameSocket.jsx";
import { useLanguage, formatDuration, translateDifficulty, translateJoinError, logoSrc } from "../i18n.js";

// Dark theme (redesign 2026-09) — page background is near-black navy, cards sit one
// step lighter, text runs light-on-dark. BLUE is unchanged: it already matched the
// reference mockups almost exactly, sampled directly from the provided PNGs.
const BG = "#060b36";
const CARD = "#12183f";
const BLUE = "#4984fd";
const WHITE = "#f0f5ff";
const LINE = "rgba(255,255,255,.12)";
const MUTED = "#8b93bf";
const BODY = "#ccd2e0";

const TOKEN_KEY = "m2020_player_token";

// R1 prompts are always generated as "Is {Company} public or private?" — extracts the
// company name so the placeholder badge can label it, without a separate schema field.
// Question content stays English until a translated bank arrives (see TAN-2300), so this
// English-only regex is correct even when the surrounding UI chrome is in Arabic.
function extractR1Subject(prompt) {
  const match = /^Is (.+) public or private\?$/i.exec(prompt || "");
  return match ? match[1] : null;
}

function clock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
}

// Splits a round label like "Startups or Scandals" on its connector word so that word
// can get the oval-outline+italic highlight treatment — matches ScreenPage.jsx exactly.
function splitRoundLabel(label) {
  for (const connector of [" or ", " أم "]) {
    const idx = label.indexOf(connector);
    if (idx !== -1) {
      return { before: label.slice(0, idx), connector: connector.trim(), after: label.slice(idx + connector.length) };
    }
  }
  return { before: label, connector: null, after: "" };
}

function DollarCoin({ color }) {
  return (
    <span
      style={{
        width: 26,
        height: 26,
        borderRadius: "50%",
        border: `1.5px solid ${color}`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 14,
        fontWeight: 700,
        color,
      }}
    >
      $
    </span>
  );
}

// Shows the real logo once an admin sets one; renders nothing at all otherwise. Kept on
// a white chip regardless of theme — most logo assets assume a light backdrop.
function CompanyLogo({ name, imageUrl, size = 34 }) {
  if (!imageUrl) return null;
  return <img src={imageUrl} alt={name} style={{ width: size, height: size, borderRadius: 10, objectFit: "contain", background: "#fff" }} />;
}

function StatusBar({ right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 24px 0", fontSize: 12, color: MUTED, fontWeight: 500 }}>
      <span>9:41</span>
      <span>{right}</span>
    </div>
  );
}

function QHeader({ state, fonts }) {
  const msLeft = useCountdown(state.sectionEndsAt);
  const pct = state.sectionDurationMs ? Math.max(0, Math.min(100, (msLeft / state.sectionDurationMs) * 100)) : 0;
  return (
    <div style={{ padding: "20px 24px 14px", background: CARD, borderBottom: `1px solid ${LINE}`, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <span style={{ fontFamily: fonts.serif, fontSize: 24, color: WHITE }}>{clock(msLeft)}</span>
      </div>
      <div style={{ height: 5, borderRadius: 999, background: "rgba(255,255,255,.12)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: BLUE }} />
      </div>
    </div>
  );
}

// Shown only to the first player to join (slot 1) — their pick becomes shared match
// state, so player 2 (who joins after) never sees this and just inherits it.
function LanguagePickerScreen({ onPick, fonts }) {
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: BG, fontFamily: fonts.body }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "40px 30px 36px" }}>
        <img src="/tanami-logo-white.png" alt="Tanami" style={{ height: 28, width: "auto", alignSelf: "flex-start" }} />

        <h3 style={{ margin: 0, fontFamily: fonts.serif, fontSize: 34, lineHeight: 1.4, fontWeight: 400, color: WHITE, textAlign: "center" }}>
          Choose your language
          <br />
          <span style={{ fontFamily: "'Noto Kufi Arabic', sans-serif" }}>اختر لغتك</span>
        </h3>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            onClick={() => onPick("en")}
            style={{ padding: 22, borderRadius: 16, textAlign: "center", fontSize: 20, fontWeight: 600, cursor: "pointer", background: BLUE, color: "#fff" }}
          >
            English
          </div>
          <div
            onClick={() => onPick("ar")}
            style={{
              padding: 22,
              borderRadius: 16,
              textAlign: "center",
              fontSize: 22,
              fontWeight: 600,
              cursor: "pointer",
              background: CARD,
              border: `2px solid ${BLUE}`,
              color: WHITE,
              fontFamily: "'Noto Kufi Arabic', sans-serif",
            }}
          >
            العربية
          </div>
          <span style={{ textAlign: "center", fontSize: 12, color: MUTED }}>This sets the language for both players · سيتم اعتماد هذه اللغة لكلا اللاعبين</span>
        </div>
      </div>
    </div>
  );
}

export default function PlayPage({ code }) {
  const { connected } = useGameSocket();
  return (
    <>
      <ReconnectingBanner connected={connected} />
      <PlayPageBody code={code} />
    </>
  );
}

function PlayPageBody({ code }) {
  const { state, socket } = useGameSocket();
  const [myToken, setMyToken] = useState(() => localStorage.getItem(TOKEN_KEY) || null);
  const myTokenRef = useRef(myToken);
  myTokenRef.current = myToken;

  // Freezes this player's own finished-match view the moment their match ends (declared
  // here, ahead of everything else that reads it, including useLanguage below) — see the
  // full explanation further down where the snapshot itself is populated.
  const stickyKey = `m2020_sticky_result_${code}_${myToken}`;
  const [stickyResult, setStickyResult] = useState(() => {
    if (!myToken) return null;
    try {
      const raw = localStorage.getItem(stickyKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  // Once this player's result is sticky, the match's shared `language` has already served
  // its purpose for them — the live value keeps changing after that (resets to English on
  // the next match, or reads as English for the instant before this socket's first "state"
  // event arrives on a refresh), so the finished screen must keep reading the language the
  // match was actually PLAYED in, from the frozen snapshot, not the live value.
  const { lang, dir, t, fonts, roundLabels } = useLanguage(stickyResult?.language ?? state?.language);
  const [name, setName] = useState("");
  const [joinError, setJoinError] = useState(null);
  const [languagePicked, setLanguagePicked] = useState(false);

  // Track locally what I picked for the current question (the server never echoes this
  // back to avoid leaking it to the opponent), and my score right as this question
  // appeared, so I can compute my own points gained once the reveal happens.
  const [myAnswers, setMyAnswers] = useState({}); // { [questionId]: "A"|"B" }
  const scoreAtQuestionStartRef = useRef(0);
  const seenQuestionIdRef = useRef(null);
  const [email, setEmail] = useState("");
  // Reads localStorage directly (not via an effect gated on stickyResult) so a refresh
  // restores "sent" immediately — the effect below only ever runs the FIRST time this
  // match's result appears (it's guarded by !stickyResult, which is already true from
  // this same localStorage on every refresh after that), so it would otherwise never
  // re-check "already sent" and would show the blank form again, inviting a second,
  // different email for an already-recorded result.
  //
  // The "sent" flag lives INSIDE the stickyResult snapshot itself (keyed by matchCode +
  // player token — see stickyKey above), not in a separate key keyed by the raw numeric
  // matchResultId. That numeric id is a bare SQLite auto-increment PK, and the database
  // file isn't committed to the repo (gitignored) — on a host with an ephemeral disk
  // (e.g. Render without a persistent Disk attached), every redeploy wipes it and the
  // counter restarts from 1. A phone that had ever submitted an email for id 1 would
  // then falsely see a brand-new, never-submitted match (also assigned id 1 after the
  // reset) as "already sent" and silently skip the real submission — which is exactly
  // what happened live on 2026-09-06: two players never got onto the leaderboard despite
  // never having entered an email at all.
  const [emailStatus, setEmailStatus] = useState(() => { // idle | sending | sent | error
    if (!myToken) return "idle";
    try {
      const raw = localStorage.getItem(`m2020_sticky_result_${code}_${myToken}`);
      return raw && JSON.parse(raw)?.emailSent ? "sent" : "idle";
    } catch {
      return "idle";
    }
  });

  // Re-sends "join" (with our saved token) every time the socket (re)connects, not just on
  // first mount. Without this, a phone's transient wifi/cellular drop reconnects with a new
  // socket.id that the server never re-links to our player token — our answer/ready emits
  // would then silently go nowhere while our own UI still optimistically shows "waiting".
  useEffect(() => {
    if (!socket) return;
    const doJoin = () => {
      socket.emit("join", { token: myTokenRef.current, code }, (ack) => {
        if (ack?.token) {
          localStorage.setItem(TOKEN_KEY, ack.token);
          setMyToken(ack.token);
        }
        if (ack && ack.ok === false) setJoinError(ack.errorCode || "unable_to_join");
      });
    };
    doJoin();
    socket.on("connect", doJoin);
    return () => socket.off("connect", doJoin);
  }, [socket, code]);

  const me = state?.players.find((p) => p.id === myToken);
  const other = state?.players.find((p) => p.id !== myToken);
  // Falls back to a translated "Player N" only when the opponent hasn't typed a name yet
  // (the server never invents one) — other?.slot ?? 2 because if `other` doesn't exist at
  // all yet, I must be slot 1, so the missing opponent is necessarily slot 2.
  const otherName = other?.name || t("playerPlaceholder", other?.slot ?? 2);

  useEffect(() => {
    const qid = state?.currentQuestion?.id;
    if (state?.state === "playing" && qid && qid !== seenQuestionIdRef.current && state.revealUntil === null) {
      seenQuestionIdRef.current = qid;
      scoreAtQuestionStartRef.current = me?.score ?? 0;
    }
  }, [state, me]);

  // Every match has its own one-time QR code, so once it ends this player can never
  // rejoin or take part in anything that comes next — there's no "live state" worth
  // following afterward, just this terminal result screen (stickyKey/stickyResult
  // themselves are declared above, ahead of useLanguage). Scoped to `code` (this
  // specific match's one-time URL) + myToken, NOT persisted forever: a fresh page load
  // with a different `code` (a genuinely new match, even on a reused token) must not
  // restore stale data.
  useEffect(() => {
    if (state?.state === "finished" && me?.matchResultId && !stickyResult) {
      const snapshot = {
        myScore: me.score,
        myName: me.name,
        myAnsweredCount: me.answeredCount,
        myTimeSpentMs: me.timeSpentMs,
        matchResultId: me.matchResultId,
        otherScore: other?.score ?? 0,
        otherName,
        winnerId: state.winnerId,
        tieBroken: state.tieBroken,
        language: state.language,
      };
      setStickyResult(snapshot);
      try {
        localStorage.setItem(stickyKey, JSON.stringify(snapshot));
      } catch {
        // ignore — worst case this player just can't resume after a refresh
      }
    }
  }, [state, me, other, otherName, stickyResult, stickyKey]);

  // Every match has its own one-time QR code, so once this player's match ends they can
  // never rejoin or take part in whatever comes next — there's no "live state" worth
  // following afterward, just this terminal result screen. Checked BEFORE joinError/
  // connecting: a stale-code rejoin (the booth having moved to the next pair) or even
  // a not-yet-connected socket must never hide an already-known result — stickyResult
  // (restored from localStorage on mount) already covers both of those cases.
  if (stickyResult || state?.state === "finished") {
    const data = stickyResult ?? {
      myScore: me?.score ?? 0,
      myName: me?.name,
      myAnsweredCount: me?.answeredCount ?? 0,
      myTimeSpentMs: me?.timeSpentMs ?? 0,
      otherScore: other?.score ?? 0,
      otherName,
      winnerId: state?.winnerId,
      tieBroken: state?.tieBroken,
    };
    const myScore = data.myScore;
    const otherScore = data.otherScore;
    const win = data.winnerId === myToken;
    const tie = data.winnerId === null;
    const tieNote = data.tieBroken ? (win ? t("tiedFaster") : t("tiedOtherFaster", data.otherName)) : null;

    return (
      <div dir={dir} style={{ height: "100vh", background: BG, padding: "44px 26px 36px", display: "flex", flexDirection: "column", gap: 22, fontFamily: fonts.body }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 11, letterSpacing: ".2em", fontWeight: 700, fontFamily: fonts.sansBold, color: BLUE }}>{t("finalThreeRounds")}</span>
          <h3 style={{ margin: 0, fontFamily: fonts.serif, fontSize: 40, lineHeight: 1.05, fontWeight: 400, color: WHITE }}>
            {tie ? t("deadHeat") : win ? t("youWon") : t("youLost")}
          </h3>
          {tieNote && <span style={{ fontSize: 14, color: MUTED }}>{tieNote}</span>}
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1, padding: 18, borderRadius: 14, background: win ? "rgba(73,132,253,.16)" : CARD, border: win ? `2px solid ${BLUE}` : "none", display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, letterSpacing: ".12em", fontWeight: 700, fontFamily: fonts.sansBold, color: win ? BLUE : MUTED }}>
              {(data.myName ?? t("you")).toUpperCase()}
            </span>
            <span style={{ fontFamily: fonts.serif, fontSize: 36, color: WHITE }}>{myScore.toLocaleString()}</span>
          </div>
          <div style={{ flex: 1, padding: 18, borderRadius: 14, background: CARD, display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, letterSpacing: ".12em", fontWeight: 700, fontFamily: fonts.sansBold, color: MUTED }}>{data.otherName.toUpperCase()}</span>
            <span style={{ fontFamily: fonts.serif, fontSize: 36, color: WHITE }}>{otherScore.toLocaleString()}</span>
          </div>
        </div>

        {!win && (
          <div style={{ padding: 22, borderRadius: 16, background: CARD, display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 17, fontWeight: 600, color: WHITE }}>{tie ? t("soClose") : t("goodRun")}</span>
            <span style={{ fontSize: 14, lineHeight: 1.55, color: BODY }}>
              {t("answeredInTime", data.myAnsweredCount, formatDuration(data.myTimeSpentMs, lang))}
            </span>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={{ fontSize: 11, letterSpacing: ".16em", fontWeight: 700, fontFamily: fonts.sansBold, color: MUTED }}>{t("emailToEnter")}</span>
          {emailStatus === "sent" ? (
            <div style={{ padding: 20, borderRadius: 14, background: CARD, border: `1px solid ${BLUE}`, textAlign: "center", fontSize: 16, fontWeight: 600, color: WHITE }}>
              {t("thanksInTouch")}
            </div>
          ) : (
            <>
              <input
                value={email}
                placeholder={t("emailPlaceholder")}
                onChange={(e) => setEmail(e.target.value)}
                style={{ padding: "18px 20px", borderRadius: 14, background: CARD, border: `1px solid ${LINE}`, fontSize: 16, color: WHITE, fontFamily: "inherit", outline: "none" }}
              />
              <div
                onClick={submitEmail}
                style={{
                  padding: 20,
                  borderRadius: 14,
                  textAlign: "center",
                  fontSize: 17,
                  fontWeight: 600,
                  cursor: "pointer",
                  background: BLUE,
                  color: "#fff",
                }}
              >
                {emailStatus === "sending" ? t("sending") : t("submit")}
              </div>
              {emailStatus === "error" && <span style={{ fontSize: 12, color: "#ff7a6e" }}>{t("emailError")}</span>}
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: MUTED }}>{t("prizeNote")}</p>
            </>
          )}
        </div>
      </div>
    );
  }

  if (joinError) {
    return (
      <div dir={dir} style={{ height: "100vh", background: BG, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 34, textAlign: "center", fontFamily: fonts.body }}>
        <span style={{ fontSize: 20, fontWeight: 600, color: WHITE }}>{t("cantJoin")}</span>
        <span style={{ fontSize: 15, color: MUTED }}>{translateJoinError(joinError, lang)}</span>
      </div>
    );
  }

  if (!state) {
    return (
      <div dir={dir} style={{ height: "100vh", background: BG, display: "flex", alignItems: "center", justifyContent: "center", color: MUTED, fontFamily: fonts.body }}>
        {t("connecting")}
      </div>
    );
  }

  function submitName(value) {
    setName(value);
    socket.emit("join", { name: value, token: myToken, code });
  }

  function pickLanguage(language) {
    socket.emit("setLanguage", { language });
    setLanguagePicked(true);
  }

  // Re-joins on the current connection before sending "ready", rather than assuming a
  // prior join already landed on this exact socket — closes a race where a phone's
  // wifi/cellular blip reconnects with a fresh socket.id just as "ready" is pressed,
  // and the bare "ready" emit would silently drop since the server can't yet map that
  // new socket back to our player token.
  function pressReady() {
    if (!name.trim()) return;
    socket.emit("join", { token: myTokenRef.current, code }, (ack) => {
      if (ack && ack.ok === false) return setJoinError(ack.error || "Unable to join this match.");
      socket.emit("ready");
    });
  }

  function submitEmail() {
    const matchResultId = stickyResult?.matchResultId ?? me?.matchResultId;
    if (!email.trim() || !matchResultId || emailStatus === "sent" || !socket) return;
    setEmailStatus("sending");
    socket.emit("submitEmail", { email: email.trim(), matchResultId }, (ack) => {
      if (ack?.ok) {
        try {
          const updated = { ...(stickyResult ?? {}), emailSent: true };
          localStorage.setItem(stickyKey, JSON.stringify(updated));
          setStickyResult(updated);
        } catch {
          // ignore — worst case a refresh re-shows the form; resubmitting is harmless
        }
      }
      setEmailStatus(ack?.ok ? "sent" : "error");
    });
  }

  function pickAnswer(letter) {
    const q = state.currentQuestion;
    if (!q || myAnswers[q.id]) return;
    setMyAnswers((prev) => ({ ...prev, [q.id]: letter }));
    socket.emit("answer", { questionId: q.id, choice: letter });
  }

  if (state.state === "lobby" && me?.slot === 1 && !languagePicked) {
    return <LanguagePickerScreen onPick={pickLanguage} fonts={fonts} />;
  }

  if (state.state === "lobby") {
    return (
      <div dir={dir} style={{ height: "100vh", display: "flex", flexDirection: "column", background: BG, fontFamily: fonts.body }}>
        <StatusBar right={me?.slot ? t("seatOf2", me.slot) : ""} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "40px 30px 36px" }}>
          <img src={logoSrc(lang)} alt="Tanami" style={{ height: 28, width: "auto", alignSelf: "flex-start" }} />

          <h3 style={{ margin: 0, fontFamily: fonts.serif, fontSize: 38, lineHeight: 1.05, fontWeight: 400, color: WHITE }}>
            {t("heroLine1")}
            <br />
            {t("heroLine2")}
            <br />
            <em style={{ color: BLUE }}>{t("heroLine3")}</em>
          </h3>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 11, letterSpacing: ".16em", fontWeight: 700, fontFamily: fonts.sansBold, color: MUTED }}>{t("yourNameLabel")}</span>
              <input
                value={name}
                placeholder={t("namePlaceholder")}
                disabled={me?.ready}
                onChange={(e) => submitName(e.target.value.slice(0, 18))}
                style={{
                  padding: "18px 20px",
                  borderRadius: 14,
                  fontSize: 18,
                  color: WHITE,
                  fontFamily: "inherit",
                  outline: "none",
                  background: CARD,
                  border: `1px solid ${name.trim() ? BLUE : LINE}`,
                }}
              />
            </div>

            {me?.ready ? (
              <div style={{ padding: 20, borderRadius: 14, background: CARD, border: `1px solid ${BLUE}`, textAlign: "center", fontSize: 16, fontWeight: 600, color: WHITE }}>
                {t("readyWaitingFor", otherName)}
              </div>
            ) : (
              <div
                onClick={pressReady}
                style={{
                  padding: 20,
                  borderRadius: 14,
                  textAlign: "center",
                  fontSize: 17,
                  fontWeight: 600,
                  cursor: name.trim() ? "pointer" : "default",
                  background: name.trim() ? BLUE : "rgba(255,255,255,.08)",
                  color: name.trim() ? "#fff" : MUTED,
                }}
              >
                {t("imReady")}
              </div>
            )}

            <span style={{ textAlign: "center", fontSize: 12, color: MUTED }}>
              {other?.ready ? t("otherIsReady", otherName) : t("addNamePrompt")}
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (state.state === "countdown") {
    const parts = splitRoundLabel(roundLabels[state.currentRound] ?? "");
    return (
      <div dir={dir} style={{ height: "100vh", background: BG, display: "flex", flexDirection: "column", fontFamily: fonts.body }}>
        <div style={{ padding: "24px 30px 0", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: BLUE, display: "inline-block" }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: WHITE }}>Tanami</span>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "0 30px" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 16px",
              borderRadius: 999,
              background: "#dce5f5",
              color: "#020844",
              fontSize: 12,
              fontWeight: 700,
              fontFamily: fonts.sansBold,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" stroke="#020844" strokeWidth="1.6" strokeLinecap="round" fill="none" />
              <path d="M13.8 2.5v2.2h-2.2" stroke="#020844" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
            {t("roundOf3", state.currentRound?.slice(1))}
          </span>
          <h3 style={{ margin: 0, textAlign: "center", fontFamily: fonts.serif, fontSize: 34, lineHeight: 1.05, fontWeight: 400, color: WHITE }}>
            {parts.connector ? (
              <>
                {parts.before}{" "}
                <span
                  style={{
                    display: "inline-block",
                    fontStyle: "italic",
                    color: BLUE,
                    border: `2px solid ${BLUE}`,
                    borderRadius: 999,
                    padding: "0 10px",
                  }}
                >
                  {parts.connector}
                </span>{" "}
                {parts.after}
              </>
            ) : (
              parts.before
            )}
          </h3>
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: "50%",
              background: BLUE,
              border: "3px dashed #fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "8px 0",
            }}
          >
            <CountdownNumber endsAt={state.countdownEndsAt} fonts={fonts} color={BG} />
          </div>
          <span style={{ fontSize: 15, color: MUTED }}>{t("getThumbsReady")}</span>
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <DollarCoin color={BLUE} />
            <DollarCoin color="#fff" />
            <DollarCoin color={BLUE} />
          </div>
        </div>
      </div>
    );
  }

  if (state.state === "playing") {
    const q = state.currentQuestion;
    const revealing = state.revealUntil !== null;
    const myChoice = q ? myAnswers[q.id] : null;

    if (!q && !revealing) {
      return (
        <div dir={dir} style={{ height: "100vh", background: BG, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 34, fontFamily: fonts.body }}>
          <span style={{ fontSize: 12, letterSpacing: ".24em", fontWeight: 700, fontFamily: fonts.sansBold, color: BLUE }}>{t("roundCleared")}</span>
          <div style={{ fontFamily: fonts.serif, fontSize: 74, color: WHITE }}>{(me?.score ?? 0).toLocaleString()}</div>
          <span style={{ fontSize: 15, color: MUTED }}>{t("waitingForClock")}</span>
        </div>
      );
    }

    if (revealing) {
      const gain = (me?.score ?? 0) - scoreAtQuestionStartRef.current;
      const correct = gain > 0;
      // Runner-up = the question's own points minus a 30pt penalty (e.g. Hard 200 -> 170),
      // applied the same way across every difficulty level.
      const note = !myChoice ? t("timesUp") : correct && gain < (q?.points ?? 0) ? t("runnerUpNote", otherName, gain, q.points) : "";
      return (
        <div dir={dir} style={{ height: "100vh", background: correct ? "rgba(73,132,253,.14)" : BG, display: "flex", flexDirection: "column", fontFamily: fonts.body }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 34 }}>
            <span style={{ fontSize: 12, letterSpacing: ".24em", fontWeight: 700, fontFamily: fonts.sansBold, color: correct ? BLUE : MUTED }}>
              {correct ? t("correct") : t("notThisTime")}
            </span>
            <div style={{ fontFamily: fonts.serif, fontSize: 96, lineHeight: 1, color: correct ? BLUE : WHITE }}>+{gain}</div>
            {note && <span style={{ fontSize: 15, color: BODY }}>{note}</span>}
          </div>
        </div>
      );
    }

    if (myChoice) {
      return (
        <div dir={dir} style={{ height: "100vh", background: BG, display: "flex", flexDirection: "column", fontFamily: fonts.body }}>
          <QHeader state={state} fonts={fonts} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 34 }}>
            <div style={{ padding: "18px 24px", borderRadius: 16, background: CARD, border: `2px solid ${BLUE}`, fontSize: 20, fontWeight: 600, color: WHITE }}>
              {myChoice === "A" ? q.optionA : q.optionB}
            </div>
            <span style={{ fontSize: 15, color: MUTED, animation: "pulse 1.4s infinite" }}>{t("waitingForOther", otherName)}</span>
          </div>
        </div>
      );
    }

    return (
      <div dir={dir} style={{ height: "100vh", background: BG, display: "flex", flexDirection: "column", fontFamily: fonts.body }}>
        <QHeader state={state} fonts={fonts} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "30px 24px 32px", gap: 20 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 14, textAlign: "center" }}>
            <span style={{ fontSize: 11, letterSpacing: ".16em", fontWeight: 700, fontFamily: fonts.sansBold, color: BLUE }}>
              {t("difficultyPoints", translateDifficulty(q.difficulty, lang), q.points)}
            </span>
            <h3 style={{ margin: 0, fontFamily: fonts.sansBold, fontSize: 25, lineHeight: 1.35, fontWeight: 700, color: WHITE }}>{q.prompt}</h3>
            {state.currentRound === "R1" && <CompanyLogo name={extractR1Subject(q.prompt)} imageUrl={q.questionImage} size={84} />}
            {state.currentRound === "R2" && (q.optionAImage || q.optionBImage) && (
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <CompanyLogo name={q.optionA} imageUrl={q.optionAImage} size={84} />
                <span style={{ fontSize: 13, fontWeight: 700, color: MUTED, fontFamily: fonts.sansBold }}>{t("vs")}</span>
                <CompanyLogo name={q.optionB} imageUrl={q.optionBImage} size={84} />
              </div>
            )}
            {other?.hasAnsweredCurrent && <span style={{ fontSize: 13, fontWeight: 600, color: BLUE }}>{t("otherAnswered", otherName)}</span>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[["A", q.optionA], ["B", q.optionB]].map(([letter, opt]) => (
              <div
                key={letter}
                onClick={() => pickAnswer(letter)}
                style={{ display: "flex", alignItems: "center", gap: 16, padding: "24px 20px", borderRadius: 18, border: `2px solid ${LINE}`, background: CARD, cursor: "pointer" }}
              >
                <span style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(255,255,255,.08)", color: WHITE, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                  {letter}
                </span>
                <span style={{ fontSize: 19, fontWeight: 600, color: WHITE }}>{opt}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div dir={dir} style={{ height: "100vh", background: BG, display: "flex", alignItems: "center", justifyContent: "center", color: MUTED, textAlign: "center", padding: 24, fontFamily: fonts.body }}>
      {state.state} screen coming soon
    </div>
  );
}

function CountdownNumber({ endsAt, fonts, color = BLUE }) {
  const msLeft = useCountdown(endsAt);
  return <div style={{ fontFamily: fonts.serif, fontSize: 48, lineHeight: 1, color }}>{Math.ceil(msLeft / 1000)}</div>;
}
