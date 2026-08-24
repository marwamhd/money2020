import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.M2020_DB_PATH || path.join(__dirname, "..", "data", "game.db");
const QUESTIONS_SEED_PATH = path.join(__dirname, "..", "data", "questions.json");

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    round TEXT NOT NULL,
    prompt TEXT NOT NULL,
    option_a TEXT NOT NULL,
    option_b TEXT NOT NULL,
    correct_option TEXT NOT NULL CHECK (correct_option IN ('A','B')),
    difficulty TEXT NOT NULL,
    points INTEGER NOT NULL,
    host_note TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    option_a_image TEXT,
    option_b_image TEXT,
    question_image TEXT
  );

  CREATE TABLE IF NOT EXISTS leaderboard (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    score INTEGER NOT NULL,
    email TEXT,
    achieved_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS match_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_code TEXT,
    player_name TEXT NOT NULL,
    score INTEGER NOT NULL,
    email TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Migration for DBs created before optional per-option logo images existed —
// CREATE TABLE IF NOT EXISTS doesn't retroactively add columns to an existing table.
const questionColumns = db.prepare("PRAGMA table_info(questions)").all().map((c) => c.name);
if (!questionColumns.includes("option_a_image")) {
  db.exec("ALTER TABLE questions ADD COLUMN option_a_image TEXT");
}
if (!questionColumns.includes("option_b_image")) {
  db.exec("ALTER TABLE questions ADD COLUMN option_b_image TEXT");
}
if (!questionColumns.includes("question_image")) {
  db.exec("ALTER TABLE questions ADD COLUMN question_image TEXT");
}

// Migration for DBs created before leaderboard entries were keyed by email.
const leaderboardColumns = db.prepare("PRAGMA table_info(leaderboard)").all().map((c) => c.name);
if (!leaderboardColumns.includes("email")) {
  db.exec("ALTER TABLE leaderboard ADD COLUMN email TEXT");
}
// SQLite treats every NULL as distinct for uniqueness purposes, so this only enforces
// one row per non-null email — legacy rows from before email was required are unaffected.
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_email ON leaderboard(email)");

export function getActiveQuestions() {
  const rows = db
    .prepare(
      `SELECT id, round, prompt, option_a AS optionA, option_b AS optionB,
              correct_option AS correctOption, difficulty, points, host_note AS hostNote,
              option_a_image AS optionAImage, option_b_image AS optionBImage, question_image AS questionImage
       FROM questions WHERE active = 1 ORDER BY sort_order ASC`
    )
    .all();
  return rows;
}

export function getTopLeaderboard(limit = 5) {
  return db
    .prepare(`SELECT name, score FROM leaderboard WHERE email IS NOT NULL ORDER BY score DESC, achieved_at ASC LIMIT ?`)
    .all(limit);
}

export function resetLeaderboard() {
  db.prepare("DELETE FROM leaderboard").run();
}

export function listQuestions() {
  return db
    .prepare(
      `SELECT id, round, prompt, option_a AS optionA, option_b AS optionB,
              correct_option AS correctOption, difficulty, points, host_note AS hostNote,
              active, sort_order AS sortOrder, option_a_image AS optionAImage, option_b_image AS optionBImage,
              question_image AS questionImage
       FROM questions ORDER BY sort_order ASC`
    )
    .all();
}

export function upsertQuestion(q) {
  const existing = db.prepare("SELECT sort_order FROM questions WHERE id = ?").get(q.id);
  const sortOrder = existing
    ? existing.sort_order
    : (db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM questions").get().maxOrder + 1);

  db.prepare(
    `INSERT INTO questions (id, round, prompt, option_a, option_b, correct_option, difficulty, points, host_note, active, sort_order, option_a_image, option_b_image, question_image)
     VALUES (@id, @round, @prompt, @optionA, @optionB, @correctOption, @difficulty, @points, @hostNote, @active, @sortOrder, @optionAImage, @optionBImage, @questionImage)
     ON CONFLICT(id) DO UPDATE SET
       round = excluded.round, prompt = excluded.prompt, option_a = excluded.option_a,
       option_b = excluded.option_b, correct_option = excluded.correct_option,
       difficulty = excluded.difficulty, points = excluded.points, host_note = excluded.host_note,
       active = excluded.active, option_a_image = excluded.option_a_image, option_b_image = excluded.option_b_image,
       question_image = excluded.question_image`
  ).run({
    ...q,
    hostNote: q.hostNote ?? null,
    active: q.active === false ? 0 : 1,
    sortOrder,
    optionAImage: q.optionAImage ?? null,
    questionImage: q.questionImage ?? null,
    optionBImage: q.optionBImage ?? null,
  });
}

export function deleteQuestion(id) {
  db.prepare("DELETE FROM questions WHERE id = ?").run(id);
}

export function setQuestionActive(id, active) {
  db.prepare("UPDATE questions SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
}

export const reorderQuestions = db.transaction((orderedIds) => {
  const update = db.prepare("UPDATE questions SET sort_order = ? WHERE id = ?");
  orderedIds.forEach((id, index) => update.run(index, id));
});

export function getConfigOverrides() {
  const rows = db.prepare("SELECT key, value FROM config").all();
  return Object.fromEntries(rows.map(({ key, value }) => [key, Number(value)]));
}

export function setConfigValue(key, value) {
  db.prepare(
    `INSERT INTO config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

const insertMatchResult = db.prepare(`
  INSERT INTO match_results (match_code, player_name, score, email, created_at)
  VALUES (@matchCode, @playerName, @score, @email, @createdAt)
`);

// Only inserted once a player submits an email (see recordLeaderboardEntryIfFirst below) —
// a played-but-unclaimed match still gets a match_results row, just never a leaderboard one.
const insertLeaderboardEntry = db.prepare(`
  INSERT INTO leaderboard (name, score, email, achieved_at)
  VALUES (@name, @score, @email, @achievedAt)
  ON CONFLICT(email) DO NOTHING
`);

// Returns { [player.id]: matchResultRowId } so the caller can later attach an
// email to the right row once the player submits one post-game.
export const persistMatchResults = db.transaction((players, matchCode = null) => {
  const now = new Date().toISOString();
  const resultIdsByPlayerId = {};
  players.forEach(({ id, name, score }) => {
    const { lastInsertRowid } = insertMatchResult.run({ matchCode, playerName: name, score, email: null, createdAt: now });
    resultIdsByPlayerId[id] = lastInsertRowid;
  });
  return resultIdsByPlayerId;
});

export function setMatchResultEmail(matchResultId, email) {
  db.prepare("UPDATE match_results SET email = ? WHERE id = ?").run(email, matchResultId);
}

export function getMatchResultById(id) {
  return db
    .prepare(
      `SELECT id, match_code AS matchCode, player_name AS playerName, score, email, created_at AS createdAt
       FROM match_results WHERE id = ?`
    )
    .get(id);
}

// Submitting an email is what enters a player into the persistent leaderboard. If this
// email already has an entry (a repeat player), the new score is silently ignored —
// their first submitted score stands, per the "no repeat-play overwrites" requirement.
export function recordLeaderboardEntryIfFirst({ name, score, email }) {
  insertLeaderboardEntry.run({ name, score, email, achievedAt: new Date().toISOString() });
}

export function listMatchResults() {
  return db
    .prepare(
      `SELECT id, match_code AS matchCode, player_name AS playerName, score, email, created_at AS createdAt
       FROM match_results ORDER BY created_at DESC`
    )
    .all();
}

function seedQuestionsIfEmpty() {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM questions").get();
  if (count > 0) return;

  const questions = JSON.parse(readFileSync(QUESTIONS_SEED_PATH, "utf-8"));
  const insert = db.prepare(`
    INSERT INTO questions (id, round, prompt, option_a, option_b, correct_option, difficulty, points, host_note, sort_order, option_a_image, option_b_image, question_image)
    VALUES (@id, @round, @prompt, @optionA, @optionB, @correctOption, @difficulty, @points, @hostNote, @sortOrder, @optionAImage, @optionBImage, @questionImage)
  `);

  const insertAll = db.transaction((rows) => {
    rows.forEach((q, index) =>
      insert.run({
        ...q,
        sortOrder: index,
        optionAImage: q.optionAImage ?? null,
        optionBImage: q.optionBImage ?? null,
        questionImage: q.questionImage ?? null,
      })
    );
  });
  insertAll(questions);
}

seedQuestionsIfEmpty();
