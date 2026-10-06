import test from "node:test";
import assert from "node:assert/strict";
import { JWT } from "google-auth-library";

process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "test-bot@test-project.iam.gserviceaccount.com";
process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = "not-a-real-key"; // fine: JWT signing is bypassed below
process.env.GOOGLE_SHEET_ID = "fake-sheet-id";
process.env.GOOGLE_SHEET_TAB_NAME = "Players";

// Real OAuth (signing a JWT assertion, POSTing to Google's token endpoint) isn't
// something a unit test should attempt — this patches just the one method our code
// calls, so the real Sheets API request shape is still exercised end-to-end below.
JWT.prototype.getAccessToken = async function () {
  return { token: "fake-access-token" };
};

const { isGoogleSheetsConfigured, appendPlayerRowToSheet } = await import("../src/googleSheets.js");

test("isGoogleSheetsConfigured is true once the service account env vars and sheet id are set", () => {
  assert.equal(isGoogleSheetsConfigured(), true);
});

test("appendPlayerRowToSheet POSTs the right row to the right sheet/tab with the access token", async () => {
  let captured = null;
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 200, text: async () => "{}" };
  };
  try {
    await appendPlayerRowToSheet({ name: "Alice", email: "alice@example.com", score: 500, timeSpentMs: 65000 });
  } finally {
    global.fetch = originalFetch;
  }

  assert.match(captured.url, /\/spreadsheets\/fake-sheet-id\/values\/Players!A%3AE:append/);
  assert.match(captured.url, /valueInputOption=USER_ENTERED/);
  assert.equal(captured.opts.headers.Authorization, "Bearer fake-access-token");
  const body = JSON.parse(captured.opts.body);
  assert.deepEqual(body.values[0].slice(0, 3), ["Alice", "alice@example.com", 500]);
  assert.equal(body.values[0][3], "1m 5s");
});

test("appendPlayerRowToSheet does not throw even if the Sheets API call fails", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 403, text: async () => "Permission denied" });
  try {
    await assert.doesNotReject(() => appendPlayerRowToSheet({ name: "Bob", email: "bob@example.com", score: 50 }));
  } finally {
    global.fetch = originalFetch;
  }
});
