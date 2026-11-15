import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "socket.io";

import {
  getActiveQuestions,
  persistMatchResults,
  getConfigOverrides,
  setMatchResultEmail,
  getMatchResultById,
  recordLeaderboardEntryIfFirst,
  getTopLeaderboard,
  listFullLeaderboard,
} from "./db.js";
import { MatchManager } from "./matchManager.js";
import { COMMANDS, STATE_EVENT, isValidEmail } from "./gameContract.js";
import { buildAdminRouter } from "./routes/admin.js";
import { appendPlayerRow, ensureWorkbookExists, PLAYERS_XLSX_PATH } from "./playersExport.js";
import { appendPlayerRowToSheet } from "./googleSheets.js";
import { appendPlayerRowToGit } from "./playersGitLog.js";

// Last-resort safety net: at a live booth, staying up (even degraded) beats a hard
// crash nobody notices until players complain. Handler bugs should still be fixed —
// this only guards against the unknown/unforeseen one.
process.on("uncaughtException", (err) => console.error("uncaughtException:", err));
process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const CLIENT_DIST = path.join(__dirname, "..", "..", "client", "dist");

// Never shipped to the browser: only the organizer's admin panel has this, entered
// at runtime. If unset, a random one is generated and printed once at startup.
const ADMIN_TOKEN = process.env.M2020_ADMIN_TOKEN || randomUUID();
console.log(`Admin token (also settable via M2020_ADMIN_TOKEN): ${ADMIN_TOKEN}`);

const app = express();
app.use(cors());
app.use(express.static(CLIENT_DIST));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

const envConfig = {
  ...(process.env.M2020_COUNTDOWN_MS && { COUNTDOWN_MS: Number(process.env.M2020_COUNTDOWN_MS) }),
  ...(process.env.M2020_SECTION_DURATION_MS && { SECTION_DURATION_MS: Number(process.env.M2020_SECTION_DURATION_MS) }),
  ...(process.env.M2020_QUESTION_TIMEOUT_MS && { QUESTION_TIMEOUT_MS: Number(process.env.M2020_QUESTION_TIMEOUT_MS) }),
  ...(process.env.M2020_RUNNER_UP_POINTS && { RUNNER_UP_POINTS: Number(process.env.M2020_RUNNER_UP_POINTS) }),
  ...(process.env.M2020_REVEAL_MS && { REVEAL_MS: Number(process.env.M2020_REVEAL_MS) }),
};
// db-stored config (set via the admin panel) wins over env vars, since it reflects
// the organizer's most recent, intentional choice and survives a server restart.
const config = { ...envConfig, ...getConfigOverrides() };

// Two (or more) matches run at once, one per booth station (one physical TV each). Every
// socket.io broadcast for a station goes only to that station's room, so a phone or screen
// never sees another station's match.
const stationRoom = (stationId) => `station:${stationId}`;

// A finished match must be saved exactly once, no matter how many times the engine emits
// while in the "finished" state (e.g. a phone reconnecting onto its results screen emits
// again). Keyed per station by matchCode, which regenerates for every new match. Holds
// { [playerId]: matchResultRowId } for that match, which the finished snapshot hands to the
// clients; submitEmail requires the client to echo its exact id back (see below), so a slow
// player's stale id from an earlier match can never attach an email to a later one.
const savedResultsByStation = new Map(); // stationId -> { matchCode, idsByPlayerId }

// The booth display (idle screen) needs the persistent top-5, so every broadcast
// carries a fresh read of it — cheap query, and it only actually changes right
// after a match finishes anyway.
function withLeaderboard(snapshot) {
  return { ...snapshot, leaderboard: getTopLeaderboard(5) };
}

function broadcastStation(stationId, snapshot) {
  io.to(stationRoom(stationId)).emit(STATE_EVENT, withLeaderboard({ ...snapshot, stationId }));
}

function handleStationChange(stationId, snapshot) {
  if (snapshot.state !== "finished") {
    broadcastStation(stationId, snapshot);
    return;
  }

  let saved = savedResultsByStation.get(stationId);
  const isFirstFinishEmit = !saved || saved.matchCode !== snapshot.matchCode;
  if (isFirstFinishEmit) {
    saved = {
      matchCode: snapshot.matchCode,
      idsByPlayerId: persistMatchResults(
        snapshot.players.map(({ id, name, score, slot, answeredCount, timeSpentMs }) => ({ id, name, score, slot, answeredCount, timeSpentMs })),
        snapshot.matchCode
      ),
    };
    savedResultsByStation.set(stationId, saved);
  }

  broadcastStation(stationId, {
    ...snapshot,
    players: snapshot.players.map((p) => ({ ...p, matchResultId: saved.idsByPlayerId[p.id] ?? null })),
  });

  // A finished match can change the shared top-5, so the other stations' screens (e.g. one
  // sitting on its idle leaderboard) get a fresh copy right away instead of staying stale
  // until their own next state change.
  if (isFirstFinishEmit) {
    manager.stationIds
      .filter((otherId) => otherId !== stationId)
      .forEach((otherId) => {
        const otherSnapshot = manager.getSnapshot(otherId);
        if (otherSnapshot && otherSnapshot.state !== "finished") broadcastStation(otherId, otherSnapshot);
      });
  }
}

const manager = new MatchManager(getActiveQuestions(), handleStationChange, config);

app.use("/api/admin", (req, res, next) => {
  if (req.headers["x-admin-token"] !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}, buildAdminRouter(manager));

// Deliberately NOT behind the admin-token gate above — this is the hidden booth-screen
// panel's data source. An email address isn't sensitive the way match/config controls
// are, so it's fine for anyone who discovers that hidden click to see this.
app.get("/api/leaderboard-emails", (req, res) => {
  res.json(listFullLeaderboard());
});

// Same reasoning/sensitivity level as leaderboard-emails above, and deliberately a plain
// GET (not under /api/admin) so the booth screen's hidden panel can link straight to it
// as a real download, without needing the admin token in client code.
app.get("/api/players-export", async (req, res) => {
  await ensureWorkbookExists();
  res.download(PLAYERS_XLSX_PATH, "players.xlsx");
});

// SPA fallback — must be registered LAST so static assets and /api/admin above take
// priority. Matches bare /screen, /play, /admin AND their variants with a trailing
// segment (/play/:code, /screen/:code); the client's own router (main.jsx) decides
// what to actually render for the path once index.html loads.
app.get("*", (req, res) => {
  res.sendFile(path.join(CLIENT_DIST, "index.html"));
});

// Player identity must survive a socket reconnect, so it can't be socket.id (which
// changes on every reload/reconnect). Each connection maps to a durable player token:
// the client sends back the token it was given on first join, or gets a fresh one.
const socketToPlayerId = new Map();

// Which station each connection belongs to. A booth screen picks its station at connect
// time (/screen/1 -> station 1); a phone picks it by the match code in the QR it scanned.
// With neither (an older client), it falls back to station 1 so nothing breaks.
const socketToStationId = new Map();

function pickStationForHandshake(handshakeQuery) {
  const { station, code } = handshakeQuery || {};
  const byCode = manager.findByCode(typeof code === "string" ? code : "");
  if (byCode) return byCode.stationId;
  return manager.getEngine(station) ? Number(station) : 1;
}

function moveSocketToStation(socket, stationId) {
  const previous = socketToStationId.get(socket.id);
  if (previous === stationId) return;
  if (previous !== undefined) socket.leave(stationRoom(previous));
  socketToStationId.set(socket.id, stationId);
  socket.join(stationRoom(stationId));
}

function engineFor(socket) {
  return manager.getEngine(socketToStationId.get(socket.id));
}

io.on("connection", (socket) => {
  const initialStationId = pickStationForHandshake(socket.handshake.query);
  moveSocketToStation(socket, initialStationId);
  socket.emit(STATE_EVENT, withLeaderboard({ ...manager.getSnapshot(initialStationId), stationId: initialStationId }));

  // Payloads are untrusted client input — a bare emit with no/null/malformed data must
  // never throw here, since an uncaught exception in a socket handler crashes the whole
  // process (every match at the booth), not just this connection.
  socket.on(COMMANDS.JOIN, (payload, ack) => {
    const { name, token, code } = payload || {};

    // The QR's match code decides which station this phone joins. A code no station is
    // currently issuing is a stale/expired QR — same answer the engine itself gives.
    const target = manager.findByCode(typeof code === "string" ? code : "");
    if (!target) {
      return ack?.({ ok: false, errorCode: "qr_expired", error: "This QR code has expired — scan the current one on the booth screen." });
    }

    // Reuse this connection's own id for a repeated join without a token (e.g. a client
    // retry before it received its token back) — otherwise each such call would mint a
    // fresh id and silently consume a second slot on the very same connection.
    const playerId = token || socketToPlayerId.get(socket.id) || randomUUID();

    // A connection that was in a different station (e.g. a phone that scanned the other TV's
    // QR first) must be removed from that station's lobby, or it would hold a phantom slot.
    const previousStationId = socketToStationId.get(socket.id);
    if (socketToPlayerId.has(socket.id) && previousStationId !== undefined && previousStationId !== target.stationId) {
      manager.getEngine(previousStationId)?.disconnectPlayer(socketToPlayerId.get(socket.id));
    }

    socketToPlayerId.set(socket.id, playerId);
    moveSocketToStation(socket, target.stationId);
    // null (not "Player") when no name was sent at all — e.g. the client's automatic
    // re-join on every socket reconnect only sends a token, never a name. addPlayer()
    // only overwrites an existing player's name when one is actually provided, so this
    // null must stay falsy — coercing it to the string "Player" here would make that
    // guard always true and stomp a real typed name back to "Player" on every reconnect.
    const safeName = typeof name === "string" && name.trim() ? name.trim().slice(0, 40) : null;
    const result = target.engine.addPlayer(playerId, safeName, code);
    // The joiner may have just switched rooms, so hand them their station's state directly.
    socket.emit(STATE_EVENT, withLeaderboard({ ...target.engine.getSnapshot(), stationId: target.stationId }));
    ack?.({ ...result, token: playerId, stationId: target.stationId });
  });

  socket.on(COMMANDS.SET_LANGUAGE, (payload) => {
    const { language } = payload || {};
    const playerId = socketToPlayerId.get(socket.id);
    if (playerId) engineFor(socket)?.setLanguage(playerId, language);
  });

  socket.on(COMMANDS.READY, () => {
    const playerId = socketToPlayerId.get(socket.id);
    if (playerId) engineFor(socket)?.setReady(playerId);
  });

  socket.on(COMMANDS.ANSWER, (payload) => {
    const { questionId, choice } = payload || {};
    const playerId = socketToPlayerId.get(socket.id);
    if (playerId) engineFor(socket)?.submitAnswer(playerId, questionId, choice);
  });

  socket.on(COMMANDS.SUBMIT_EMAIL, (payload, ack) => {
    const { email, matchResultId } = payload || {};
    const playerId = socketToPlayerId.get(socket.id);
    if (!playerId) return ack?.({ ok: false, error: "Not in a match" });
    if (!isValidEmail(email)) return ack?.({ ok: false, error: "Invalid email" });

    // Ownership is checked against the database (player_token), not in-memory state —
    // that resets to empty on every server restart (Render's free tier idles down and
    // cold-restarts on the next request), so a player who took a bit longer than usual
    // between finishing and hitting Submit could be falsely rejected even though their
    // result was safely sitting in the database the whole time. It also keeps this
    // independent of which station the player was in.
    const result = matchResultId ? getMatchResultById(matchResultId) : null;
    if (!result || result.playerToken !== playerId) {
      return ack?.({ ok: false, error: "No completed result to attach an email to" });
    }

    const trimmedEmail = email.trim();
    setMatchResultEmail(matchResultId, trimmedEmail);

    // Submitting an email is what enters a player into the persistent leaderboard —
    // if this email already has an entry (a repeat player), their first score stands.
    recordLeaderboardEntryIfFirst({ name: result.playerName, score: result.score, email: trimmedEmail });
    // Separate from the leaderboard on purpose: every player who played and gave an
    // email gets a row here, in order, even a repeat player whose new score doesn't
    // become their leaderboard entry — this is a full participation log, not a ranking.
    //
    // Logged to three places on purpose, none of which depend on the other two: the
    // local players.xlsx (same disk as the app — fast, but wiped along with everything
    // else if Render's disk ever resets), a live Google Sheet (independent of Render
    // entirely — open it anytime, no exports needed), and a commit straight into this
    // repo's git history (independent of Render AND of any Google account — survives
    // even if the Render service is deleted outright). None of these can throw and
    // break the actual email submission — each is isolated and logs its own failures.
    const rowData = { name: result.playerName, email: trimmedEmail, score: result.score, timeSpentMs: result.timeSpentMs };
    appendPlayerRow(rowData);
    appendPlayerRowToSheet(rowData);
    appendPlayerRowToGit(rowData);
    ack?.({ ok: true });
  });

  socket.on(COMMANDS.OPEN_NEXT_MATCH, () => {
    engineFor(socket)?.openNextMatch();
  });

  socket.on("disconnect", () => {
    const playerId = socketToPlayerId.get(socket.id);
    if (playerId) engineFor(socket)?.disconnectPlayer(playerId);
    socketToPlayerId.delete(socket.id);
    socketToStationId.delete(socket.id);
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Money20/20 game server listening on http://0.0.0.0:${PORT}`);
});
