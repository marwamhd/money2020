import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useGameSocket, useCountdown, ReconnectingBanner } from "../useGameSocket.jsx";
import { useLanguage, formatDuration, translateDifficulty, logoSrc } from "../i18n.js";

const NAVY = "#020844";
const BLUE = "#4984fd";
const SKY = "#8ec7f0";
const TINT = "#edf3ff";
const LINE = "#dce5f5";
const MUTED = "#7b85a6";
const BODY = "#4a5578";

// Falls back to a translated "Player N" only when that seat hasn't typed a name yet —
// the server never invents one (see gameEngine#addPlayer).
function playerName(state, slot, t) {
  return state.players.find((p) => p.slot === slot)?.name || t("playerPlaceholder", slot);
}

// R1 prompts are always generated as "Is {Company} public or private?" — extracts the
// company name so the placeholder badge (and admin form) can label it, without a
// separate "subject name" field in the schema. Question content stays English until a
// translated bank arrives (see TAN-2300), so this English-only regex stays correct even
// when the surrounding UI chrome is in Arabic.
function extractR1Subject(prompt) {
  const match = /^Is (.+) public or private\?$/i.exec(prompt || "");
  return match ? match[1] : null;
}

// Shows the real logo once an admin sets one; renders nothing at all otherwise.
function CompanyLogo({ name, imageUrl, size = "2.6cqw" }) {
  if (!imageUrl) return null;
  return <img src={imageUrl} alt={name} style={{ width: size, height: size, borderRadius: 10, objectFit: "contain", background: "#fff" }} />;
}

const CONFETTI_PIECES = Array.from({ length: 70 }, (_, i) => {
  const white = i % 2 === 0;
  return {
    left: Math.random() * 100,
    delay: -Math.random() * 6,
    dur: 4.5 + Math.random() * 3.5,
    w: 5 + Math.random() * 5,
    h: 9 + Math.random() * 9,
    rot: Math.random() * 360,
    bg: white ? "#fff" : i % 3 === 0 ? BLUE : SKY,
  };
});

function Confetti() {
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {CONFETTI_PIECES.map((c, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            top: "-8%",
            left: `${c.left}%`,
            width: c.w,
            height: c.h,
            background: c.bg,
            borderRadius: 2,
            boxShadow: c.bg === "#fff" ? "0 0 0 1px rgba(2,8,68,.08)" : "none",
            transform: `rotate(${c.rot}deg)`,
            animation: `confettiFall ${c.dur}s linear ${c.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function IdleScreen({ state, t, fonts, lang }) {
  const readyCount = state.players.filter((p) => p.ready).length;
  const stillNeeded = 2 - readyCount;
  // Keyed to this session's matchCode (fresh every reset/openNextMatch) so a screenshot
  // or a leftover browser tab from a previous match's QR can't be used to join this one.
  const joinUrl = `${window.location.origin}/play/${state.matchCode}`;
  const board = state.leaderboard;

  // Deliberately not visually indicated as clickable (no cursor change, no hover
  // style) — this is a discreet way for whoever knows to pull the leaderboard's
  // emails for prize contact, without exposing that entry point to booth visitors.
  const [emailPanel, setEmailPanel] = useState(null); // null | { rows: [...] } | { error: "..." }

  async function openEmailPanel() {
    setEmailPanel({ rows: [] });
    try {
      const res = await fetch("/api/leaderboard-emails");
      setEmailPanel({ rows: res.ok ? await res.json() : [] });
    } catch {
      setEmailPanel({ error: "Couldn't load. Check the connection." });
    }
  }

  return (
    <div style={{ flex: 1, display: "flex" }}>
      <div
        style={{
          flex: 1.15,
          padding: "4cqh 3cqw",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: "2cqh",
          minHeight: 0,
        }}
      >
        <img src={logoSrc(lang)} alt="Tanami" style={{ height: "2.6cqw", width: "auto", alignSelf: "flex-start" }} />

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Noto Kufi Arabic's taller strokes/dots need more breathing room between lines
              than Merriweather does — line-height: 1 makes the two lines look like they're
              touching in Arabic, so only Arabic gets the looser value. */}
          <h3 style={{ margin: 0, fontFamily: fonts.serif, fontSize: "3.9cqw", lineHeight: lang === "ar" ? 1.5 : 1, fontWeight: 400, color: NAVY }}>
            {t("heroTitleLine1")}
            <br />
            <em style={{ color: BLUE }}>{t("heroTitleLine2")}</em>
          </h3>
          <p style={{ margin: 0, maxWidth: "36cqw", fontSize: "1.5cqw", lineHeight: 1.5, color: BODY }}>{t("idleSubtitle")}</p>
          <div style={{ display: "flex", alignItems: "center", gap: "1.6cqw", marginTop: "1cqh" }}>
            <div
              style={{
                width: "11cqw",
                aspectRatio: "1 / 1",
                borderRadius: "1.2cqw",
                background: "#fff",
                border: "1px solid #D8E3FF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "1cqw",
              }}
            >
              <QRCodeSVG value={joinUrl} size={512} style={{ width: "100%", height: "100%" }} fgColor={NAVY} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.2cqh", alignItems: "flex-start" }}>
              <span style={{ fontSize: "1.8cqw", fontWeight: 600, color: NAVY }}>{t("scanToJoin")}</span>
              <span
                style={{
                  padding: "0.9cqh 1.4cqw",
                  borderRadius: 999,
                  background: "rgba(73,132,253,.12)",
                  color: BLUE,
                  fontSize: "1.3cqw",
                  fontWeight: 700,
                  fontFamily: fonts.sansBold,
                  animation: "pulse 1.6s infinite",
                }}
              >
                {stillNeeded <= 0 ? t("starting") : t("playersStillReady", stillNeeded)}
              </span>
            </div>
          </div>
        </div>

        <span style={{ fontSize: "1.2cqw", color: "#9AA3BF" }}>{t("eventName")}</span>
      </div>

      <div
        style={{
          width: "38%",
          padding: "4cqh 3cqw",
          background: TINT,
          borderInlineStart: "1px solid #D8E3FF",
          display: "flex",
          flexDirection: "column",
          gap: "2cqh",
          minHeight: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h4 style={{ margin: 0, fontFamily: fonts.serif, fontSize: "1.8cqw", fontWeight: 400, color: NAVY }}>{t("leaderboard")}</h4>
          <span onClick={openEmailPanel} style={{ fontSize: "1.1cqw", letterSpacing: ".14em", fontWeight: 700, fontFamily: fonts.sansBold, color: BLUE }}>{t("top5")}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.1cqh" }}>
          {board.length === 0 && <span style={{ fontSize: "1.3cqw", color: MUTED }}>{t("noGamesYet")}</span>}
          {board.map((entry, i) =>
            i === 0 ? (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "stretch",
                  borderRadius: 16,
                  overflow: "hidden",
                  background: "#fff",
                  border: `2px solid ${BLUE}`,
                }}
              >
                <div style={{ width: "5.2cqw", flex: "none", background: BLUE, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontFamily: fonts.serif, fontSize: "3.4cqw", lineHeight: 1, color: "#fff" }}>1</span>
                </div>
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "1.2cqw", padding: "2.2cqh 1.6cqw" }}>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.3cqh", minWidth: 0 }}>
                    <span style={{ fontSize: "0.95cqw", letterSpacing: ".2em", fontWeight: 700, fontFamily: fonts.sansBold, color: BLUE }}>
                      {t("topScore")}
                    </span>
                    <span
                      style={{
                        fontFamily: fonts.serif,
                        fontSize: "2.2cqw",
                        color: NAVY,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {entry.name}
                    </span>
                  </div>
                  <span style={{ fontFamily: fonts.serif, fontSize: "2.6cqw", color: BLUE }}>{entry.score.toLocaleString()}</span>
                </div>
              </div>
            ) : (
              <div
                key={i}
                style={{ display: "flex", alignItems: "center", gap: 14, padding: "1.4cqh 1.6cqw", borderRadius: 14, background: "#fff", border: `1px solid ${LINE}` }}
              >
                <span style={{ fontFamily: fonts.serif, fontSize: "1.8cqw", width: "2.8cqw", textAlign: "center", color: "#9AA3BF" }}>{i + 1}</span>
                <span style={{ flex: 1, fontSize: "1.5cqw", fontWeight: 600, color: NAVY }}>{entry.name}</span>
                <span style={{ fontFamily: fonts.serif, fontSize: "1.9cqw", color: NAVY }}>{entry.score.toLocaleString()}</span>
              </div>
            )
          )}
        </div>
      </div>

      {emailPanel && (
        <div
          onClick={() => setEmailPanel(null)}
          style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(2,8,68,.85)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 16, padding: 28, minWidth: 420, maxWidth: "80vw", maxHeight: "80vh", overflow: "auto", display: "flex", flexDirection: "column", gap: 14 }}
          >
            <h4 style={{ margin: 0, fontFamily: fonts.serif, fontWeight: 400, color: NAVY }}>{t("leaderboardEmails")}</h4>
            {emailPanel.error ? (
              <span style={{ color: "#C0392B" }}>{emailPanel.error}</span>
            ) : emailPanel.rows.length === 0 ? (
              <span style={{ color: MUTED }}>{t("noEntriesYet")}</span>
            ) : (
              <table style={{ borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: "start", color: MUTED }}>
                    <th style={{ padding: "4px 12px" }}>{t("colHash")}</th>
                    <th style={{ padding: "4px 12px" }}>{t("colName")}</th>
                    <th style={{ padding: "4px 12px" }}>{t("colScore")}</th>
                    <th style={{ padding: "4px 12px" }}>{t("colEmail")}</th>
                  </tr>
                </thead>
                <tbody>
                  {emailPanel.rows.map((r, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${LINE}` }}>
                      <td style={{ padding: "6px 12px", color: NAVY }}>{i + 1}</td>
                      <td style={{ padding: "6px 12px", color: NAVY }}>{r.name}</td>
                      <td style={{ padding: "6px 12px", color: NAVY }}>{r.score}</td>
                      <td style={{ padding: "6px 12px", color: NAVY }}>{r.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div onClick={() => setEmailPanel(null)} style={{ alignSelf: "flex-end", padding: "8px 16px", borderRadius: 10, background: NAVY, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              {t("close")}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CountdownScreen({ state, t, fonts, roundLabels }) {
  const msLeft = useCountdown(state.countdownEndsAt);
  const seconds = Math.ceil(msLeft / 1000);

  return (
    <div style={{ flex: 1, background: TINT, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1cqh" }}>
      <span style={{ fontSize: "1.2cqw", letterSpacing: ".26em", fontWeight: 700, fontFamily: fonts.sansBold, color: BLUE }}>
        {t("roundOf3", state.currentRound?.slice(1))}
      </span>
      <h3 style={{ margin: 0, fontFamily: fonts.serif, fontSize: "4.2cqw", lineHeight: 1.02, fontWeight: 400, color: NAVY }}>
        {roundLabels[state.currentRound]}
      </h3>
      <div style={{ fontFamily: fonts.serif, fontSize: "9cqw", lineHeight: 0.9, color: BLUE }}>{seconds}</div>
      <span style={{ fontSize: "1.5cqw", color: MUTED }}>{t("vsBetween", playerName(state, 1, t), playerName(state, 2, t))}</span>
    </div>
  );
}

function clock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
}

function PlayerColumn({ player, opponent, tinted, t, fonts }) {
  const leading = player && opponent && player.score > opponent.score;
  return (
    <div
      style={{
        width: "23%",
        padding: "3cqh 2cqw",
        background: tinted ? TINT : "#fff",
        // Logical (inline-start/end) so the seam touching the center column stays on the
        // correct visual edge whether the row is LTR or mirrored for RTL.
        borderInlineEnd: tinted ? "1px solid #D8E3FF" : "none",
        borderInlineStart: tinted ? "none" : `1px solid ${LINE}`,
        display: "flex",
        flexDirection: "column",
        gap: "1.6cqh",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "1cqw" }}>
        <div
          style={{
            width: "3.6cqw",
            height: "3.6cqw",
            borderRadius: 12,
            background: tinted ? BLUE : NAVY,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "1.5cqw",
            fontWeight: 700,
          }}
        >
          {player?.name?.[0] ?? "?"}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: "1.6cqw", fontWeight: 600, color: NAVY }}>{player?.name}</span>
          <span style={{ fontSize: "1cqw", fontWeight: 600, color: leading ? BLUE : MUTED }}>{leading ? t("leading") : ""}</span>
        </div>
      </div>
      <div style={{ fontFamily: fonts.serif, fontSize: "3.8cqw", lineHeight: 1, color: NAVY }}>{(player?.score ?? 0).toLocaleString()}</div>
      <span style={{ fontSize: "1.2cqw", color: MUTED }}>{t("answeredCount", player?.answeredCount ?? 0)}</span>
      <span style={{ fontSize: "1.2cqw", fontWeight: 600, color: player?.hasAnsweredCurrent ? BLUE : "#9AA3BF" }}>
        {player?.hasAnsweredCurrent ? t("lockedIn") : t("choosing")}
      </span>
    </div>
  );
}

function PlayingScreen({ state, t, fonts, roundLabels, lang }) {
  const msLeft = useCountdown(state.sectionEndsAt);
  const q = state.currentQuestion;
  const revealing = state.revealUntil !== null;
  const playerA = state.players.find((p) => p.slot === 1);
  const playerB = state.players.find((p) => p.slot === 2);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "1.8cqh 2.5cqw", background: "#fff", borderBottom: `1px solid ${LINE}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <img src={logoSrc(lang)} alt="Tanami" style={{ height: "1.7cqw", width: "auto" }} />
        <span style={{ fontSize: "1.1cqw", letterSpacing: ".16em", fontWeight: 700, fontFamily: fonts.sansBold, color: MUTED }}>
          {t("roundOf3", state.currentRound?.slice(1))} · {roundLabels[state.currentRound]?.toUpperCase()}
        </span>
      </div>
      <div style={{ flex: 1, display: "flex" }}>
        <PlayerColumn player={playerA} opponent={playerB} tinted t={t} fonts={fonts} />
        <div style={{ flex: 1, padding: "3cqh 2.6cqw", display: "flex", flexDirection: "column", gap: "4.5cqh", alignItems: "center" }}>
          {q && (
            <span
              style={{
                padding: "0.8cqh 1.1cqw",
                borderRadius: 999,
                background: NAVY,
                color: "#fff",
                fontSize: "1cqw",
                fontWeight: 700,
                fontFamily: fonts.sansBold,
              }}
            >
              {t("difficultyPoints", translateDifficulty(q.difficulty, lang), q.points)}
            </span>
          )}
          {q && (
            <h3
              style={{
                margin: 0,
                textAlign: "center",
                fontFamily: fonts.sansBold,
                fontSize: "2.4cqw",
                lineHeight: 1.28,
                fontWeight: 700,
                color: NAVY,
                maxWidth: "44cqw",
              }}
            >
              {q.prompt}
            </h3>
          )}
          {q && state.currentRound === "R1" && (
            <CompanyLogo name={extractR1Subject(q.prompt)} imageUrl={q.questionImage} size="8cqw" />
          )}
          {q && state.currentRound === "R2" && (q.optionAImage || q.optionBImage) && (
            <div style={{ display: "flex", alignItems: "center", gap: "1.2cqw" }}>
              <CompanyLogo name={q.optionA} imageUrl={q.optionAImage} size="8cqw" />
              <span style={{ fontSize: "1.2cqw", fontWeight: 700, color: MUTED, fontFamily: fonts.sansBold }}>{t("vs")}</span>
              <CompanyLogo name={q.optionB} imageUrl={q.optionBImage} size="8cqw" />
            </div>
          )}
          {q && (
            <div style={{ width: "100%", display: "flex", gap: "1.4cqw" }}>
              {[q.optionA, q.optionB].map((opt, i) => {
                const letter = i === 0 ? "A" : "B";
                const n = state.answerCounts[letter];
                const isCorrect = revealing && q.correctOption === letter;
                return (
                  <div
                    key={letter}
                    style={{
                      flex: 1,
                      padding: "2cqh 1.6cqw",
                      borderRadius: 16,
                      background: isCorrect ? TINT : "#fff",
                      border: `2px solid ${isCorrect ? BLUE : LINE}`,
                      display: "flex",
                      flexDirection: "column",
                      gap: "1.2cqh",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "1cqw" }}>
                      <span
                        style={{
                          width: "2.6cqw",
                          height: "2.6cqw",
                          borderRadius: 10,
                          background: isCorrect ? BLUE : "#EEF1F8",
                          color: isCorrect ? "#fff" : NAVY,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "1.3cqw",
                          fontWeight: 700,
                        }}
                      >
                        {letter}
                      </span>
                      <span style={{ fontSize: "1.6cqw", fontWeight: 600, color: NAVY }}>{opt}</span>
                      {isCorrect && (
                        <span style={{ marginInlineStart: "auto", fontSize: "1cqw", letterSpacing: ".12em", fontWeight: 700, fontFamily: fonts.sansBold, color: BLUE }}>
                          {t("correct")}
                        </span>
                      )}
                    </div>
                    {revealing && <span style={{ fontSize: "1.2cqw", color: BODY }}>{t("playersPicked", n)}</span>}
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.6cqh" }}>
            <span style={{ fontFamily: fonts.serif, fontSize: "3.9cqw", lineHeight: 1, color: msLeft <= 10000 ? BLUE : NAVY }}>{clock(msLeft)}</span>
            {revealing && <span style={{ fontSize: "1.2cqw", fontWeight: 600, color: BLUE }}>{t("nextQuestionLoading")}</span>}
          </div>
        </div>
        <PlayerColumn player={playerB} opponent={playerA} tinted={false} t={t} fonts={fonts} />
      </div>
    </div>
  );
}

function FinishedScreen({ state, t, fonts, lang }) {
  const { socket } = useGameSocket();

  function openNextMatch() {
    if (!window.confirm(t("confirmNextMatch"))) return;
    socket.emit("openNextMatch");
  }

  const playerA = state.players.find((p) => p.slot === 1);
  const playerB = state.players.find((p) => p.slot === 2);
  const winner = state.winnerId === null ? null : state.winnerId === playerA.id ? playerA : playerB;
  const runnerUp = winner ? (winner === playerA ? playerB : playerA) : null;
  const hi = Math.max(playerA.score, playerB.score);
  const lo = Math.min(playerA.score, playerB.score);
  const top = playerA.score >= playerB.score ? playerA : playerB;
  const bottom = top === playerA ? playerB : playerA;

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        background: TINT,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "2.6cqh",
        padding: "4cqh 3cqw",
        overflow: "hidden",
      }}
    >
      <Confetti />
      <span style={{ fontSize: "1.2cqw", letterSpacing: ".26em", fontWeight: 700, fontFamily: fonts.sansBold, color: BLUE }}>{t("gameOverThreeRounds")}</span>
      <h3 style={{ margin: 0, fontFamily: fonts.serif, fontSize: "3.9cqw", lineHeight: lang === "ar" ? 1.5 : 1, fontWeight: 400, color: NAVY, textAlign: "center" }}>
        {winner ? t("takesIt", winner.name) : t("deadHeat")}
      </h3>
      {winner && state.tieBroken && (
        <span style={{ fontSize: "1.2cqw", color: MUTED }}>{t("tiedOtherFaster", winner.name)}</span>
      )}
      <div style={{ display: "flex", gap: "1.6cqw" }}>
        <div style={{ width: "22cqw", padding: "2.6cqh 2cqw", borderRadius: 18, background: "#fff", border: `2px solid ${BLUE}`, display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: "1.1cqw", letterSpacing: ".14em", fontWeight: 700, fontFamily: fonts.sansBold, color: BLUE }}>{t("winner")}</span>
          <span style={{ fontSize: "2cqw", fontWeight: 600, color: NAVY }}>{winner?.name ?? t("bothPlaceholder")}</span>
          <span style={{ fontFamily: fonts.serif, fontSize: "3.2cqw", lineHeight: 1, color: NAVY }}>{hi.toLocaleString()}</span>
          <span style={{ fontSize: "1.1cqw", color: MUTED }}>{t("answersInDuration", top.answeredCount, formatDuration(top.timeSpentMs, lang))}</span>
        </div>
        <div style={{ width: "22cqw", padding: "2.6cqh 2cqw", borderRadius: 18, background: "#fff", border: `1px solid ${LINE}`, display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: "1.1cqw", letterSpacing: ".14em", fontWeight: 700, fontFamily: fonts.sansBold, color: MUTED }}>{t("runnerUp")}</span>
          <span style={{ fontSize: "2cqw", fontWeight: 600, color: NAVY }}>{runnerUp?.name ?? t("bothPlaceholder")}</span>
          <span style={{ fontFamily: fonts.serif, fontSize: "3.2cqw", lineHeight: 1, color: NAVY }}>{lo.toLocaleString()}</span>
          <span style={{ fontSize: "1.1cqw", color: MUTED }}>{t("answersInDuration", bottom.answeredCount, formatDuration(bottom.timeSpentMs, lang))}</span>
        </div>
      </div>
      <div
        onClick={openNextMatch}
        style={{ padding: "1.4cqh 2cqw", borderRadius: 999, background: NAVY, color: "#fff", fontSize: "1.3cqw", fontWeight: 600, cursor: "pointer" }}
      >
        {t("goToLeaderboard")}
      </div>
    </div>
  );
}

export default function ScreenPage() {
  const { connected } = useGameSocket();
  return (
    <>
      <ReconnectingBanner connected={connected} />
      <ScreenPageBody />
    </>
  );
}

function ScreenPageBody() {
  const { state } = useGameSocket();
  const { lang, dir, t, fonts, roundLabels } = useLanguage(state?.language);

  if (!state) {
    return (
      <div dir={dir} style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: MUTED, fontFamily: fonts.body }}>
        {t("connecting")}
      </div>
    );
  }

  return (
    <div dir={dir} style={{ height: "100vh", width: "100vw", containerType: "size", background: "#fff", display: "flex", fontFamily: fonts.body }}>
      {state.state === "lobby" ? (
        <IdleScreen state={state} t={t} fonts={fonts} lang={lang} />
      ) : state.state === "countdown" ? (
        <CountdownScreen state={state} t={t} fonts={fonts} roundLabels={roundLabels} />
      ) : state.state === "playing" ? (
        <PlayingScreen state={state} t={t} fonts={fonts} roundLabels={roundLabels} lang={lang} />
      ) : state.state === "finished" ? (
        <FinishedScreen state={state} t={t} fonts={fonts} lang={lang} />
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: MUTED }}>
          {state.state} screen coming soon
        </div>
      )}
    </div>
  );
}
