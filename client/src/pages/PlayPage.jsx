import { useEffect, useRef, useState } from "react";
import { useGameSocket, useCountdown, ReconnectingBanner } from "../useGameSocket.jsx";

const NAVY = "#020844";
const BLUE = "#4984fd";
const TINT = "#edf3ff";
const LINE = "#dce5f5";
const MUTED = "#7b85a6";
const BODY = "#4a5578";
const SERIF = "'Merriweather',Georgia,serif";
const SANS_BOLD = "'Merriweather Sans',sans-serif";

const TOKEN_KEY = "m2020_player_token";
const ROUND_LABELS = { R1: "Public or Private", R2: "Valuation Showdown", R3: "This or That" };

// R1 prompts are always generated as "Is {Company} public or private?" — extracts the
// company name so the placeholder badge can label it, without a separate schema field.
function extractR1Subject(prompt) {
  const match = /^Is (.+) public or private\?$/i.exec(prompt || "");
  return match ? match[1] : null;
}

function clock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
}

function duration(ms) {
  const t = Math.round(ms / 1000);
  return t >= 60 ? `${Math.floor(t / 60)}m ${t % 60}s` : `${t}s`;
}

// Shows the real logo once an admin sets one; renders nothing at all otherwise.
function CompanyLogo({ name, imageUrl, size = 34 }) {
  if (!imageUrl) return null;
  return <img src={imageUrl} alt={name} style={{ width: size, height: size, borderRadius: 10, objectFit: "contain", background: "#fff" }} />;
}

function StatusBar({ right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 24px 0", fontSize: 12, color: "#9AA3BF", fontWeight: 500 }}>
      <span>9:41</span>
      <span>{right}</span>
    </div>
  );
}

function QHeader({ state }) {
  const msLeft = useCountdown(state.sectionEndsAt);
  const pct = state.sectionDurationMs ? Math.max(0, Math.min(100, (msLeft / state.sectionDurationMs) * 100)) : 0;
  return (
    <div style={{ padding: "20px 24px 14px", background: TINT, borderBottom: "1px solid #D8E3FF", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <span style={{ fontFamily: SERIF, fontSize: 24, color: NAVY }}>{clock(msLeft)}</span>
      </div>
      <div style={{ height: 5, borderRadius: 999, background: "rgba(142,199,240,.45)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: BLUE }} />
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
  const [name, setName] = useState("");
  const [myToken, setMyToken] = useState(() => localStorage.getItem(TOKEN_KEY) || null);
  const myTokenRef = useRef(myToken);
  myTokenRef.current = myToken;
  const [joinError, setJoinError] = useState(null);

  // Track locally what I picked for the current question (the server never echoes this
  // back to avoid leaking it to the opponent), and my score right as this question
  // appeared, so I can compute my own points gained once the reveal happens.
  const [myAnswers, setMyAnswers] = useState({}); // { [questionId]: "A"|"B" }
  const scoreAtQuestionStartRef = useRef(0);
  const seenQuestionIdRef = useRef(null);
  const [email, setEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState("idle"); // idle | sending | sent | error

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
        if (ack && ack.ok === false) setJoinError(ack.error || "Unable to join this match.");
      });
    };
    doJoin();
    socket.on("connect", doJoin);
    return () => socket.off("connect", doJoin);
  }, [socket, code]);

  const me = state?.players.find((p) => p.id === myToken);
  const other = state?.players.find((p) => p.id !== myToken);
  const otherName = other?.name ?? "Player 2";

  useEffect(() => {
    const qid = state?.currentQuestion?.id;
    if (state?.state === "playing" && qid && qid !== seenQuestionIdRef.current && state.revealUntil === null) {
      seenQuestionIdRef.current = qid;
      scoreAtQuestionStartRef.current = me?.score ?? 0;
    }
  }, [state, me]);

  // Freezes this player's own finished-match view the moment their match ends. Every
  // match has its own one-time QR code, so once it ends this player can never rejoin or
  // take part in anything that comes next — there's no "live state" worth following
  // afterward, just this terminal result screen. Scoped to `code` (this specific match's
  // one-time URL) + myToken, NOT persisted forever: a fresh page load with a different
  // `code` (a genuinely new match, even on a reused token) must not restore stale data.
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
      };
      setStickyResult(snapshot);
      try {
        localStorage.setItem(stickyKey, JSON.stringify(snapshot));
      } catch {
        // ignore — worst case this player just can't resume after a refresh
      }
      // A submission already recorded for this exact match (e.g. before a page refresh)
      // must stay final — never re-show the form and risk a second, different email.
      if (localStorage.getItem(`m2020_email_sent_${me.matchResultId}`)) {
        setEmailStatus("sent");
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
    const tieNote = data.tieBroken
      ? win
        ? `Tied on points — you answered faster.`
        : `Tied on points — ${data.otherName} answered faster.`
      : null;

    return (
      <div style={{ height: "100vh", background: TINT, padding: "44px 26px 36px", display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 11, letterSpacing: ".2em", fontWeight: 700, fontFamily: SANS_BOLD, color: BLUE }}>FINAL · 3 ROUNDS</span>
          <h3 style={{ margin: 0, fontFamily: SERIF, fontSize: 40, lineHeight: 1.05, fontWeight: 400, color: NAVY }}>
            {tie ? "Dead heat" : win ? "You won" : "You lost"}
          </h3>
          {tieNote && <span style={{ fontSize: 14, color: MUTED }}>{tieNote}</span>}
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1, padding: 18, borderRadius: 14, background: win ? NAVY : "#fff", display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, letterSpacing: ".12em", fontWeight: 700, fontFamily: SANS_BOLD, color: win ? "rgba(255,255,255,.6)" : MUTED }}>
              {(data.myName ?? "YOU").toUpperCase()}
            </span>
            <span style={{ fontFamily: SERIF, fontSize: 36, color: win ? "#fff" : NAVY }}>{myScore.toLocaleString()}</span>
          </div>
          <div style={{ flex: 1, padding: 18, borderRadius: 14, background: "#fff", display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, letterSpacing: ".12em", fontWeight: 700, fontFamily: SANS_BOLD, color: MUTED }}>{data.otherName.toUpperCase()}</span>
            <span style={{ fontFamily: SERIF, fontSize: 36, color: NAVY }}>{otherScore.toLocaleString()}</span>
          </div>
        </div>

        {!win && (
          <div style={{ padding: 22, borderRadius: 16, background: "#fff", display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 17, fontWeight: 600, color: NAVY }}>{tie ? "So close." : "Good run."}</span>
            <span style={{ fontSize: 14, lineHeight: 1.55, color: BODY }}>
              You answered {data.myAnsweredCount} questions in {duration(data.myTimeSpentMs)}.
            </span>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={{ fontSize: 11, letterSpacing: ".16em", fontWeight: 700, fontFamily: SANS_BOLD, color: MUTED }}>EMAIL TO ENTER THE LEADERBOARD</span>
          {emailStatus === "sent" ? (
            <div style={{ padding: 20, borderRadius: 14, background: "#fff", border: `1px solid ${BLUE}`, textAlign: "center", fontSize: 16, fontWeight: 600, color: NAVY }}>
              Thanks — we'll be in touch.
            </div>
          ) : (
            <>
              <input
                value={email}
                placeholder="name@company.com"
                onChange={(e) => setEmail(e.target.value)}
                style={{ padding: "18px 20px", borderRadius: 14, background: "#fff", border: "1px solid #C9D2E8", fontSize: 16, color: NAVY, fontFamily: "inherit", outline: "none" }}
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
                  background: NAVY,
                  color: "#fff",
                }}
              >
                {emailStatus === "sending" ? "Sending…" : "Submit"}
              </div>
              {emailStatus === "error" && <span style={{ fontSize: 12, color: "#C0392B" }}>Couldn't submit that — check the email and try again.</span>}
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: MUTED }}>Top 5 on the leaderboard get $200 credited on their first investment.</p>
            </>
          )}
        </div>
      </div>
    );
  }

  if (joinError) {
    return (
      <div style={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 34, textAlign: "center" }}>
        <span style={{ fontSize: 20, fontWeight: 600, color: NAVY }}>Can't join this match</span>
        <span style={{ fontSize: 15, color: MUTED }}>{joinError}</span>
      </div>
    );
  }

  if (!state) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: MUTED }}>
        Connecting…
      </div>
    );
  }

  function submitName(value) {
    setName(value);
    socket.emit("join", { name: value, token: myToken, code });
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
      if (ack?.ok) localStorage.setItem(`m2020_email_sent_${matchResultId}`, "1");
      setEmailStatus(ack?.ok ? "sent" : "error");
    });
  }

  function pickAnswer(letter) {
    const q = state.currentQuestion;
    if (!q || myAnswers[q.id]) return;
    setMyAnswers((prev) => ({ ...prev, [q.id]: letter }));
    socket.emit("answer", { questionId: q.id, choice: letter });
  }

  if (state.state === "lobby") {
    return (
      <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#fff" }}>
        <StatusBar right={me?.slot ? `Seat ${me.slot} of 2` : ""} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "40px 30px 36px" }}>
          <img src="/tanami-logo.png" alt="Tanami" style={{ height: 28, width: "auto", alignSelf: "flex-start" }} />

          <h3 style={{ margin: 0, fontFamily: SERIF, fontSize: 38, lineHeight: 1.05, fontWeight: 400, color: NAVY }}>
            Two players.
            <br />
            Three rounds.
            <br />
            <em style={{ color: BLUE }}>One minute each.</em>
          </h3>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 11, letterSpacing: ".16em", fontWeight: 700, fontFamily: SANS_BOLD, color: MUTED }}>YOUR NAME</span>
              <input
                value={name}
                placeholder="Type your name"
                disabled={me?.ready}
                onChange={(e) => submitName(e.target.value.slice(0, 18))}
                style={{
                  padding: "18px 20px",
                  borderRadius: 14,
                  fontSize: 18,
                  color: NAVY,
                  fontFamily: "inherit",
                  outline: "none",
                  background: me?.ready ? TINT : "#fff",
                  border: `1px solid ${name.trim() ? BLUE : "#C9D2E8"}`,
                }}
              />
            </div>

            {me?.ready ? (
              <div style={{ padding: 20, borderRadius: 14, background: TINT, border: `1px solid ${BLUE}`, textAlign: "center", fontSize: 16, fontWeight: 600, color: NAVY }}>
                Ready. Waiting for {otherName}
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
                  background: name.trim() ? NAVY : "#DCE1EE",
                  color: name.trim() ? "#fff" : "#9AA3BF",
                }}
              >
                I'm ready
              </div>
            )}

            <span style={{ textAlign: "center", fontSize: 12, color: "#9AA3BF" }}>
              {other?.ready ? `${otherName} is ready` : "Add your name, then press ready"}
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (state.state === "countdown") {
    return (
      <div style={{ height: "100vh", background: TINT, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 36 }}>
        <span style={{ fontSize: 11, letterSpacing: ".22em", fontWeight: 700, fontFamily: SANS_BOLD, color: BLUE }}>
          ROUND {state.currentRound?.slice(1)} OF 3
        </span>
        <h3 style={{ margin: 0, textAlign: "center", fontFamily: SERIF, fontSize: 40, lineHeight: 1.02, fontWeight: 400, color: NAVY }}>
          {ROUND_LABELS[state.currentRound]}
        </h3>
        <CountdownNumber endsAt={state.countdownEndsAt} />
        <span style={{ fontSize: 16, color: MUTED }}>Get your thumbs ready</span>
      </div>
    );
  }

  if (state.state === "playing") {
    const q = state.currentQuestion;
    const revealing = state.revealUntil !== null;
    const myChoice = q ? myAnswers[q.id] : null;

    if (!q && !revealing) {
      return (
        <div style={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 34 }}>
          <span style={{ fontSize: 12, letterSpacing: ".24em", fontWeight: 700, fontFamily: SANS_BOLD, color: BLUE }}>ROUND CLEARED</span>
          <div style={{ fontFamily: SERIF, fontSize: 74, color: NAVY }}>{(me?.score ?? 0).toLocaleString()}</div>
          <span style={{ fontSize: 15, color: MUTED }}>Waiting for the clock</span>
        </div>
      );
    }

    if (revealing) {
      const gain = (me?.score ?? 0) - scoreAtQuestionStartRef.current;
      const correct = gain > 0;
      // Runner-up = the question's own points minus a 30pt penalty (e.g. Hard 200 -> 170),
      // applied the same way across every difficulty level.
      const note = !myChoice ? "Time's up" : correct && gain < (q?.points ?? 0) ? `${otherName} answered first, so you get ${gain} instead of ${q.points}` : "";
      return (
        <div style={{ height: "100vh", background: correct ? TINT : "#fff", display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 34 }}>
            <span style={{ fontSize: 12, letterSpacing: ".24em", fontWeight: 700, fontFamily: SANS_BOLD, color: correct ? BLUE : "#9AA3BF" }}>
              {correct ? "CORRECT" : "NOT THIS TIME"}
            </span>
            <div style={{ fontFamily: SERIF, fontSize: 96, lineHeight: 1, color: correct ? BLUE : NAVY }}>+{gain}</div>
            {note && <span style={{ fontSize: 15, color: BODY }}>{note}</span>}
          </div>
        </div>
      );
    }

    if (myChoice) {
      return (
        <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
          <QHeader state={state} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 34 }}>
            <div style={{ padding: "18px 24px", borderRadius: 16, background: TINT, border: `2px solid ${BLUE}`, fontSize: 20, fontWeight: 600, color: NAVY }}>
              {myChoice === "A" ? q.optionA : q.optionB}
            </div>
            <span style={{ fontSize: 15, color: MUTED, animation: "pulse 1.4s infinite" }}>Waiting for {otherName}…</span>
          </div>
        </div>
      );
    }

    return (
      <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
        <QHeader state={state} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "30px 24px 32px", gap: 20 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 14, textAlign: "center" }}>
            <span style={{ fontSize: 11, letterSpacing: ".16em", fontWeight: 700, fontFamily: SANS_BOLD, color: BLUE }}>
              {q.difficulty?.toUpperCase()} · {q.points} PTS
            </span>
            <h3 style={{ margin: 0, fontFamily: SANS_BOLD, fontSize: 25, lineHeight: 1.35, fontWeight: 700, color: NAVY }}>{q.prompt}</h3>
            {state.currentRound === "R1" && <CompanyLogo name={extractR1Subject(q.prompt)} imageUrl={q.questionImage} size={84} />}
            {state.currentRound === "R2" && (q.optionAImage || q.optionBImage) && (
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <CompanyLogo name={q.optionA} imageUrl={q.optionAImage} size={84} />
                <span style={{ fontSize: 13, fontWeight: 700, color: MUTED, fontFamily: SANS_BOLD }}>VS</span>
                <CompanyLogo name={q.optionB} imageUrl={q.optionBImage} size={84} />
              </div>
            )}
            {other?.hasAnsweredCurrent && <span style={{ fontSize: 13, fontWeight: 600, color: BLUE }}>{otherName} has answered. Your turn.</span>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[["A", q.optionA], ["B", q.optionB]].map(([letter, opt]) => (
              <div
                key={letter}
                onClick={() => pickAnswer(letter)}
                style={{ display: "flex", alignItems: "center", gap: 16, padding: "24px 20px", borderRadius: 18, border: `2px solid ${LINE}`, background: "#fff", cursor: "pointer" }}
              >
                <span style={{ width: 34, height: 34, borderRadius: 10, background: "#EEF1F8", color: NAVY, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                  {letter}
                </span>
                <span style={{ fontSize: 19, fontWeight: 600, color: NAVY }}>{opt}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: MUTED, textAlign: "center", padding: 24 }}>
      {state.state} screen coming soon
    </div>
  );
}

function CountdownNumber({ endsAt }) {
  const msLeft = useCountdown(endsAt);
  return <div style={{ fontFamily: SERIF, fontSize: 132, lineHeight: 1, color: BLUE }}>{Math.ceil(msLeft / 1000)}</div>;
}
