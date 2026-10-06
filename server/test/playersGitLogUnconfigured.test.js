import test from "node:test";
import assert from "node:assert/strict";

// Deliberately a separate file (not imported alongside the "configured" test) — the
// module reads its env vars once at import time, so this file must run with them unset
// from the start to exercise the "nobody has set this up yet" path, e.g. local dev.
delete process.env.GITHUB_TOKEN;
delete process.env.GITHUB_REPO;

const { isGitLogConfigured, appendPlayerRowToGit } = await import("../src/playersGitLog.js");

test("isGitLogConfigured is false when GITHUB_TOKEN/GITHUB_REPO are unset", () => {
  assert.equal(isGitLogConfigured(), false);
});

test("appendPlayerRowToGit no-ops (does not throw, never calls fetch) when not configured", async () => {
  let fetchCalled = false;
  const originalFetch = global.fetch;
  global.fetch = () => { fetchCalled = true; throw new Error("fetch should not have been called"); };
  try {
    await assert.doesNotReject(() => appendPlayerRowToGit({ name: "Alice", email: "alice@example.com", score: 100 }));
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});
