import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "socket.io";

import { getActiveQuestions, persistMatchResults } from "./db.js";
import { GameEngine } from "./gameEngine.js";
import { COMMANDS, STATE_EVENT } from "./gameContract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const CLIENT_DIST = path.join(__dirname, "..", "..", "client", "dist");

const app = express();
app.use(cors());
app.use(express.static(CLIENT_DIST));
app.get(["/play/:code", "/screen/:code", "/admin"], (req, res) => {
  res.sendFile(path.join(CLIENT_DIST, "index.html"));
});

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

const config = {
  ...(process.env.M2020_COUNTDOWN_MS && { COUNTDOWN_MS: Number(process.env.M2020_COUNTDOWN_MS) }),
  ...(process.env.M2020_SECTION_DURATION_MS && { SECTION_DURATION_MS: Number(process.env.M2020_SECTION_DURATION_MS) }),
  ...(process.env.M2020_QUESTION_TIMEOUT_MS && { QUESTION_TIMEOUT_MS: Number(process.env.M2020_QUESTION_TIMEOUT_MS) }),
  ...(process.env.M2020_RUNNER_UP_POINTS && { RUNNER_UP_POINTS: Number(process.env.M2020_RUNNER_UP_POINTS) }),
};

const engine = new GameEngine(getActiveQuestions(), (snapshot) => {
  io.emit(STATE_EVENT, snapshot);
  if (snapshot.state === "finished") {
    persistMatchResults(snapshot.players.map(({ name, score }) => ({ name, score })));
  }
}, config);

// Player identity must survive a socket reconnect, so it can't be socket.id (which
// changes on every reload/reconnect). Each connection maps to a durable player token:
// the client sends back the token it was given on first join, or gets a fresh one.
const socketToPlayerId = new Map();

io.on("connection", (socket) => {
  socket.emit(STATE_EVENT, engine.getSnapshot());

  socket.on(COMMANDS.JOIN, ({ name, token }, ack) => {
    const playerId = token || randomUUID();
    socketToPlayerId.set(socket.id, playerId);
    const result = engine.addPlayer(playerId, name);
    ack?.({ ...result, token: playerId });
  });

  socket.on(COMMANDS.READY, () => {
    const playerId = socketToPlayerId.get(socket.id);
    if (playerId) engine.setReady(playerId);
  });

  socket.on(COMMANDS.ANSWER, ({ questionId, choice }) => {
    const playerId = socketToPlayerId.get(socket.id);
    if (playerId) engine.submitAnswer(playerId, questionId, choice);
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
