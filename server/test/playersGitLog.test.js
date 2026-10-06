import test from "node:test";
import assert from "node:assert/strict";

process.env.GITHUB_TOKEN = "fake-token-for-tests";
process.env.GITHUB_REPO = "Tanami-Capital/money2020-game";
process.env.GITHUB_BRANCH = "main";
process.env.GITHUB_PLAYERS_LOG_PATH = "server/data/players-log.csv";

const { isGitLogConfigured, appendPlayerRowToGit } = await import("../src/playersGitLog.js");

function mockFetchSequence(responses) {
  let i = 0;
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return r;
  };
  return calls;
}

test("isGitLogConfigured is true once GITHUB_TOKEN/GITHUB_REPO are set", () => {
  assert.equal(isGitLogConfigured(), true);
});

test("appendPlayerRowToGit creates the file with header+row when it doesn't exist yet (GET 404)", async () => {
  const calls = mockFetchSequence([
    { ok: false, status: 404, text: async () => "Not Found" }, // GET
    { ok: true, status: 200, text: async () => "" }, // PUT
  ]);

  await appendPlayerRowToGit({ name: "Alice", email: "alice@example.com", score: 500, timeSpentMs: 65000 });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].opts.method, undefined, "GET is a plain fetch(url, {headers}) with no method override");
  const putBody = JSON.parse(calls[1].opts.body);
  const content = Buffer.from(putBody.content, "base64").toString("utf8");
  assert.match(content, /^Name,Email,Score,Time Played,Submitted At\n/);
  assert.match(content, /Alice,alice@example\.com,500,1m 5s,\d{4}-\d{2}-\d{2}T/);
  assert.match(putBody.message, /Alice/);
  assert.equal(putBody.sha, undefined, "no sha on a brand-new file");
});

test("appendPlayerRowToGit appends to existing content and passes the sha back", async () => {
  const existing = Buffer.from("Name,Email,Score,Time Played,Submitted At\nBob,bob@example.com,200,45s,2026-10-01T00:00:00.000Z\n", "utf8").toString("base64");
  const calls = mockFetchSequence([
    { ok: true, status: 200, json: async () => ({ content: existing, sha: "abc123" }) }, // GET
    { ok: true, status: 200, text: async () => "" }, // PUT
  ]);

  await appendPlayerRowToGit({ name: "Carol", email: "carol@example.com", score: 300 });

  const putBody = JSON.parse(calls[1].opts.body);
  assert.equal(putBody.sha, "abc123");
  const content = Buffer.from(putBody.content, "base64").toString("utf8");
  assert.match(content, /Bob,bob@example\.com,200,45s,2026-10-01T00:00:00\.000Z\n/);
  assert.match(content, /Carol,carol@example\.com,300,,\d{4}-\d{2}-\d{2}T/, "missing timeSpentMs formats as an empty cell, not 'undefined'");
});

test("a 409 (stale sha) retries once with a fresh GET, then succeeds", async () => {
  const calls = mockFetchSequence([
    { ok: true, status: 200, json: async () => ({ content: Buffer.from("Name,Email,Score,Time Played,Submitted At\n").toString("base64"), sha: "old-sha" }) }, // GET 1
    { ok: false, status: 409, text: async () => "Conflict" }, // PUT 1 fails
    { ok: true, status: 200, json: async () => ({ content: Buffer.from("Name,Email,Score,Time Played,Submitted At\n").toString("base64"), sha: "new-sha" }) }, // GET 2 (retry)
    { ok: true, status: 200, text: async () => "" }, // PUT 2 succeeds
  ]);

  await assert.doesNotReject(() => appendPlayerRowToGit({ name: "Dana", email: "dana@example.com", score: 150 }));
  assert.equal(calls.length, 4);
  const secondPutBody = JSON.parse(calls[3].opts.body);
  assert.equal(secondPutBody.sha, "new-sha");
});

test("names/emails with commas or quotes are CSV-escaped safely", async () => {
  const calls = mockFetchSequence([
    { ok: false, status: 404, text: async () => "Not Found" },
    { ok: true, status: 200, text: async () => "" },
  ]);
  await appendPlayerRowToGit({ name: 'Say "Hi", Bob', email: "bob@example.com", score: 10 });
  const putBody = JSON.parse(calls[1].opts.body);
  const content = Buffer.from(putBody.content, "base64").toString("utf8");
  assert.match(content, /"Say ""Hi"", Bob",bob@example\.com,10/);
});
