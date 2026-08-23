import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "socket.io";

import { getActiveQuestions, persistMatchResults, getConfigOverrides, setMatchResultEmail } from "./db.js";
import { GameEngine } from "./gameEngine.js";
import { COMMANDS, STATE_EVENT, isValidEmail } from "./gameContract.js";
import { buildAdminRouter } from "./routes/admin.js";

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
app.get(["/play/:code", "/screen/:code", "/admin"], (req, res) => {
  res.sendFile(path.join(CLIENT_DIST, "index.html"));
});

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

const envConfig = {
  ...(process.env.M2020_COUNTDOWN_MS && { COUNTDOWN_MS: Number(process.env.M2020_COUNTDOWN_MS) }),
  ...(process.env.M2020_SECTION_DURATION_MS && { SECTION_DURATION_MS: Number(process.env.M2020_SECTION_DURATION_MS) }),
  ...(process.env.M2020_QUESTION_TIMEOUT_MS && { QUESTION_TIMEOUT_MS: Number(process.env.M2020_QUESTION_TIMEOUT_MS) }),
  ...(process.env.M2020_RUNNER_UP_POINTS && { RUNNER_UP_POINTS: Number(process.env.M2020_RUNNER_UP_POINTS) }),
};
// db-stored config (set via the admin panel) wins over env vars, since it reflects
// the organizer's most recent, intentional choice and survives a server restart.
const config = { ...envConfig, ...getConfigOverrides() };

// Populated on every finish with { [playerId]: matchResultRowId }, so a player's
// post-game submitEmail can be attached to the right row. Overwritten on the next
// finish; fine since only one match is ever active/pending email capture at a time.
let matchResultIdsByPlayerId = {};

const engine = new GameEngine(getActiveQuestions(), (snapshot) => {
  io.emit(STATE_EVENT, snapshot);
  if (snapshot.state === "finished") {
    matchResultIdsByPlayerId = persistMatchResults(snapshot.players.map(({ id, name, score }) => ({ id, name, score })));
  }
}, config);

app.use("/api/admin", (req, res, next) => {
  if (req.headers["x-admin-token"] !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}, buildAdminRouter(engine));

// Player identity must survive a socket reconnect, so it can't be socket.id (which
// changes on every reload/reconnect). Each connection maps to a durable player token:
// the client sends back the token it was given on first join, or gets a fresh one.
const socketToPlayerId = new Map();

io.on("connection", (socket) => {
  socket.emit(STATE_EVENT, engine.getSnapshot());

  // Payloads are untrusted client input — a bare emit with no/null/malformed data must
  // never throw here, since an uncaught exception in a socket handler crashes the whole
  // process (both players' match, for everyone at the booth), not just this connection.
  socket.on(COMMANDS.JOIN, (payload, ack) => {
    const { name, token } = payload || {};
    // Reuse this connection's own id for a repeated join without a token (e.g. a client
    // retry before it received its token back) — otherwise each such call would mint a
    // fresh id and silently consume a second slot on the very same connection.
    const playerId = token || socketToPlayerId.get(socket.id) || randomUUID();
    socketToPlayerId.set(socket.id, playerId);
    const safeName = typeof name === "string" && name.trim() ? name.trim().slice(0, 40) : "Player";
    const result = engine.addPlayer(playerId, safeName);
    ack?.({ ...result, token: playerId });
  });

  socket.on(COMMANDS.READY, () => {
    const playerId = socketToPlayerId.get(socket.id);
    if (playerId) engine.setReady(playerId);
  });

  socket.on(COMMANDS.ANSWER, (payload) => {
    const { questionId, choice } = payload || {};
    const playerId = socketToPlayerId.get(socket.id);
    if (playerId) engine.submitAnswer(playerId, questionId, choice);
  });

  socket.on(COMMANDS.SUBMIT_EMAIL, (payload, ack) => {
    const { email } = payload || {};
    const playerId = socketToPlayerId.get(socket.id);
    if (!playerId) return ack?.({ ok: false, error: "Not in a match" });
    if (!isValidEmail(email)) return ack?.({ ok: false, error: "Invalid email" });

    const matchResultId = matchResultIdsByPlayerId[playerId];
    if (!matchResultId) return ack?.({ ok: false, error: "No completed result to attach an email to" });

    setMatchResultEmail(matchResultId, email.trim());
    ack?.({ ok: true });
  });

  socket.on("disconnect", () => {
    const playerId = socketToPlayerId.get(socket.id);
    if (playerId) engine.disconnectPlayer(playerId);
    socketToPlayerId.delete(socket.id);
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Money20/20 game server listening on http://0.0.0.0:${PORT}`);
});
