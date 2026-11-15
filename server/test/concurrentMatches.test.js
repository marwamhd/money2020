import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { io as connect } from "socket.io-client";

// Boots the REAL server (src/index.js) in a child process against a throwaway database and
// spreadsheet, with no Google/GitHub credentials, so nothing external is ever touched.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.join(__dirname, "..", "src", "index.js");
const PORT = 40000 + Math.floor(Math.random() * 20000);
const URL = `http://127.0.0.1:${PORT}`;
const ADMIN_TOKEN = "test-admin-token";

const tmpDir = mkdtempSync(path.join(os.tmpdir(), "m2020-concurrent-"));
let serverProcess;
const sockets = [];

function startServer() {
  const env = {
    ...process.env,
    PORT: String(PORT),
    M2020_DB_PATH: path.join(tmpDir, "test.db"),
    M2020_PLAYERS_XLSX_PATH: path.join(tmpDir, "players.xlsx"),
    M2020_ADMIN_TOKEN: ADMIN_TOKEN,
    M2020_COUNTDOWN_MS: "30",
    M2020_SECTION_DURATION_MS: "600",
    M2020_QUESTION_TIMEOUT_MS: "300",
    M2020_REVEAL_MS: "10",
  };
  for (const key of ["GITHUB_TOKEN", "GITHUB_REPO", "GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "GOOGLE_SHEET_ID"]) {
    delete env[key];
  }
  serverProcess = spawn(process.execPath, [SERVER_ENTRY], { env, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 10000);
    serverProcess.stdout.on("data", (chunk) => {
      if (String(chunk).includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    serverProcess.on("exit", (code) => reject(new Error(`server exited early (${code})`)));
  });
}

// A connected client that remembers the latest state it was sent.
function client(query = {}) {
  const socket = connect(URL, { transports: ["websocket"], query, forceNew: true });
  const c = { socket, state: null, seen: [] };
  socket.on("state", (s) => {
    c.state = s;
    c.seen.push(s);
  });
  sockets.push(socket);
  // Ready once the server's initial state has arrived, as a real page would be.
  return new Promise((resolve) => socket.once("state", () => resolve(c)));
}

const emitAck = (c, event, payload) => new Promise((resolve) => c.socket.emit(event, payload, resolve));

async function waitFor(predicate, timeoutMs = 8000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: condition never became true");
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function adminGet(pathname) {
  const res = await fetch(`${URL}/api/admin${pathname}`, { headers: { "x-admin-token": ADMIN_TOKEN } });
  return res.json();
}

async function adminPost(pathname, body) {
  const res = await fetch(`${URL}/api/admin${pathname}`, {
    method: "POST",
    headers: { "x-admin-token": ADMIN_TOKEN, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test.before(startServer);
test.after(() => {
  sockets.forEach((s) => s.close());
  serverProcess?.kill();
  rmSync(tmpDir, { recursive: true, force: true });
});

// Seats two phones in one station and gets both to Ready.
async function seatMatch(screen, names) {
  const code = screen.state.matchCode;
  const phones = [];
  for (const name of names) {
    const phone = await client({ code });
    const ack = await emitAck(phone, "join", { name, code });
    assert.equal(ack.ok, true, `${name} should join: ${JSON.stringify(ack)}`);
    phone.token = ack.token;
    phones.push(phone);
  }
  return phones;
}

function answerEverything(phones, screen) {
  // Each phone answers every question it is shown. The first phone always picks A, the second B.
  const answered = new Set();
  const timer = setInterval(() => {
    const q = screen.state?.currentQuestion;
    if (screen.state?.state !== "playing" || !q) return;
    phones.forEach((phone, index) => {
      const key = `${index}:${q.id}`;
      if (answered.has(key)) return;
      answered.add(key);
      phone.socket.emit("answer", { questionId: q.id, choice: index === 0 ? "A" : "B" });
    });
  }, 15);
  return () => clearInterval(timer);
}

test("two matches run at once, stay separate, and every player's email is saved", async () => {
  const screen1 = await client({ station: "1" });
  const screen2 = await client({ station: "2" });
  assert.equal(screen1.state.stationId, 1);
  assert.equal(screen2.state.stationId, 2);
  assert.notEqual(screen1.state.matchCode, screen2.state.matchCode);

  const [a1, a2] = await seatMatch(screen1, ["Alice", "Bob"]);
  const [b1, b2] = await seatMatch(screen2, ["Carol", "Dave"]);

  await waitFor(() => screen1.state.players.length === 2 && screen2.state.players.length === 2);
  assert.deepEqual(screen1.state.players.map((p) => p.name).sort(), ["Alice", "Bob"]);
  assert.deepEqual(screen2.state.players.map((p) => p.name).sort(), ["Carol", "Dave"]);

  // Both matches start at the same moment.
  const stop1 = answerEverything([a1, a2], screen1);
  const stop2 = answerEverything([b1, b2], screen2);
  [a1, a2, b1, b2].forEach((p) => p.socket.emit("ready"));

  await waitFor(() => screen1.state.state === "finished" && screen2.state.state === "finished", 15000);
  stop1();
  stop2();

  // Nobody ever received the other match's players.
  for (const snap of screen1.seen) {
    snap.players.forEach((p) => assert.ok(["Alice", "Bob"].includes(p.name), `station 1 leaked ${p.name}`));
  }
  for (const snap of screen2.seen) {
    snap.players.forEach((p) => assert.ok(["Carol", "Dave"].includes(p.name), `station 2 leaked ${p.name}`));
  }
  for (const phone of [a1, a2]) {
    phone.seen.forEach((snap) => assert.equal(snap.stationId, 1));
  }
  for (const phone of [b1, b2]) {
    phone.seen.forEach((snap) => assert.equal(snap.stationId, 2));
  }

  // Each finished match was saved exactly once: 4 results, 2 per match code.
  const results = await adminGet("/results");
  assert.equal(results.length, 4);
  const byCode = {};
  results.forEach((r) => (byCode[r.matchCode] = (byCode[r.matchCode] || 0) + 1));
  assert.deepEqual(Object.values(byCode), [2, 2]);

  // All four players submit an email at the same moment; none are lost.
  const players = [
    { phone: a1, screen: screen1, email: "alice@example.com" },
    { phone: a2, screen: screen1, email: "bob@example.com" },
    { phone: b1, screen: screen2, email: "carol@example.com" },
    { phone: b2, screen: screen2, email: "dave@example.com" },
  ];
  const acks = await Promise.all(
    players.map(({ phone, screen, email }) => {
      const me = screen.state.players.find((p) => p.id === phone.token);
      return emitAck(phone, "submitEmail", { email, matchResultId: me.matchResultId });
    })
  );
  acks.forEach((ack) => assert.equal(ack.ok, true, JSON.stringify(ack)));

  const saved = await adminGet("/results");
  assert.deepEqual(saved.map((r) => r.email).sort(), players.map((p) => p.email).sort());
});

test("a phone reconnecting onto its results screen does not save the match a second time", async () => {
  const before = (await adminGet("/results")).length;
  const screen1 = await client({ station: "1" });
  assert.equal(screen1.state.state, "finished");

  const oldCode = screen1.state.matchCode;
  const reconnecting = await client({ code: oldCode });
  const player = screen1.state.players[0];
  await emitAck(reconnecting, "join", { token: player.id, code: oldCode });

  assert.equal((await adminGet("/results")).length, before);
});

test("a stale or unknown QR is rejected, and the next match gets a fresh code", async () => {
  const phone = await client();
  const ack = await emitAck(phone, "join", { name: "Eve", code: "deadbeef" });
  assert.equal(ack.ok, false);
  assert.equal(ack.errorCode, "qr_expired");

  const screen1 = await client({ station: "1" });
  const oldCode = screen1.state.matchCode;
  screen1.socket.emit("openNextMatch");
  await waitFor(() => screen1.state.state === "lobby");
  assert.notEqual(screen1.state.matchCode, oldCode);

  const late = await client();
  const lateAck = await emitAck(late, "join", { name: "Late", code: oldCode });
  assert.equal(lateAck.errorCode, "qr_expired");
});

test("one station's 'next match' and admin reset leave the other station alone", async () => {
  const screen2 = await client({ station: "2" });
  assert.equal(screen2.state.state, "finished");
  const winnerBefore = screen2.state.winnerId;

  // Station 1 is now in a fresh lobby. Resetting it via admin must not touch station 2.
  const refused = await adminPost("/match/reset", { station: 1 });
  assert.equal(refused.status, 400); // needs confirm
  const reset = await adminPost("/match/reset", { station: 1, confirm: true });
  assert.equal(reset.status, 200);
  assert.equal((await adminGet("/match?station=2")).state, "finished");
  assert.equal((await adminGet("/match?station=2")).winnerId, winnerBefore);

  const unknown = await adminPost("/match/reset", { station: 9, confirm: true });
  assert.equal(unknown.status, 404);
});

test("a phone that scanned one TV's QR then the other's holds a slot in only one station", async () => {
  const screen1 = await client({ station: "1" });
  const screen2 = await client({ station: "2" });
  screen2.socket.emit("openNextMatch");
  await waitFor(() => screen2.state.state === "lobby");

  const phone = await client();
  const first = await emitAck(phone, "join", { name: "Mover", code: screen1.state.matchCode });
  assert.equal(first.ok, true);
  await waitFor(() => screen1.state.players.length === 1);

  const second = await emitAck(phone, "join", { name: "Mover", code: screen2.state.matchCode });
  assert.equal(second.ok, true);
  assert.equal(second.stationId, 2);
  await waitFor(() => screen1.state.players.length === 0 && screen2.state.players.length === 1);
});
