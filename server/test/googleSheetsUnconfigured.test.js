import test from "node:test";
import assert from "node:assert/strict";

delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
delete process.env.GOOGLE_SHEET_ID;

const { isGoogleSheetsConfigured, appendPlayerRowToSheet } = await import("../src/googleSheets.js");

test("isGoogleSheetsConfigured is false when the service account/sheet env vars are unset", () => {
  assert.equal(isGoogleSheetsConfigured(), false);
});

test("appendPlayerRowToSheet no-ops (does not throw, never calls fetch) when not configured", async () => {
  let fetchCalled = false;
  const originalFetch = global.fetch;
  global.fetch = () => { fetchCalled = true; throw new Error("fetch should not have been called"); };
  try {
    await assert.doesNotReject(() => appendPlayerRowToSheet({ name: "Alice", email: "alice@example.com", score: 100 }));
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});
