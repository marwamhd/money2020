import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const tmpDir = mkdtempSync(path.join(os.tmpdir(), "m2020-valuation-refresh-"));
process.env.M2020_DB_PATH = path.join(tmpDir, "test.db");

// First import creates and seeds the DB (already carrying the refreshed values).
const first = await import("../src/db.js?first");

test.after(() => {
  first.db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

const row = (id) => first.db.prepare("SELECT correct_option AS c, prompt, option_a AS a, host_note AS n FROM questions WHERE id = ?").get(id);

test("an existing DB with stale valuation answers gets the refreshed values once", async () => {
  // Simulate a DB persisted before the refresh: stale answers and no marker row.
  first.db.prepare("UPDATE questions SET correct_option = 'A' WHERE id = 'R2-4'").run();
  first.db.prepare("UPDATE questions SET prompt = 'Which has the higher valuation: xAI or Databricks?', option_a = 'xAI' WHERE id = 'R2-6'").run();
  first.db.prepare("DELETE FROM applied_data_refreshes").run();

  await import("../src/db.js?second");

  assert.equal(row("R2-4").c, "B");
  assert.equal(row("R2-6").prompt, "Which has the higher valuation: OpenAI or Databricks?");
  assert.equal(row("R2-6").a, "OpenAI");
  assert.match(row("R2-4").n, /23 Nov 2026/);
});

test("the refresh does not run again, so later admin edits survive a restart", async () => {
  first.db.prepare("UPDATE questions SET correct_option = 'A' WHERE id = 'R2-4'").run();
  await import("../src/db.js?third");
  assert.equal(row("R2-4").c, "A");
});
