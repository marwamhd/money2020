import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "data", "game.db");
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
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS leaderboard (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    score INTEGER NOT NULL,
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

export function getActiveQuestions() {
  const rows = db
    .prepare(
      `SELECT id, round, prompt, option_a AS optionA, option_b AS optionB,
              correct_option AS correctOption, difficulty, points, host_note AS hostNote
       FROM questions WHERE active = 1 ORDER BY sort_order ASC`
    )
    .all();
  return rows;
}

export function getTopLeaderboard(limit = 5) {
  return db
    .prepare(`SELECT name, score FROM leaderboard ORDER BY score DESC, achieved_at ASC LIMIT ?`)
    .all(limit);
}

const insertMatchResult = db.prepare(`
  INSERT INTO match_results (match_code, player_name, score, email, created_at)
  VALUES (@matchCode, @playerName, @score, @email, @createdAt)
`);

const insertLeaderboardEntry = db.prepare(`
  INSERT INTO leaderboard (name, score, achieved_at)
  VALUES (@name, @score, @achievedAt)
`);

export const persistMatchResults = db.transaction((players, matchCode = null) => {
  const now = new Date().toISOString();
  players.forEach(({ name, score }) => {
    insertMatchResult.run({ matchCode, playerName: name, score, email: null, createdAt: now });
    insertLeaderboardEntry.run({ name, score, achievedAt: now });
  });
});

function seedQuestionsIfEmpty() {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM questions").get();
  if (count > 0) return;

  const questions = JSON.parse(readFileSync(QUESTIONS_SEED_PATH, "utf-8"));
  const insert = db.prepare(`
    INSERT INTO questions (id, round, prompt, option_a, option_b, correct_option, difficulty, points, host_note, sort_order)
    VALUES (@id, @round, @prompt, @optionA, @optionB, @correctOption, @difficulty, @points, @hostNote, @sortOrder)
  `);

  const insertAll = db.transaction((rows) => {
    rows.forEach((q, index) => insert.run({ ...q, sortOrder: index }));
  });
  insertAll(questions);
}

seedQuestionsIfEmpty();
