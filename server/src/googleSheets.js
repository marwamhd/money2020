import { JWT } from "google-auth-library";

// The "quickly get the data" copy — every player who submits an email gets a row
// appended directly to a real Google Sheet Marwa owns, reachable from any browser or
// phone with zero exports, admin tokens, or Render access needed. Lives entirely in
// Google's infrastructure, so it's unaffected by anything happening to the Render
// service (disk wipes, redeploys, restarts, even the service being deleted).
//
// Configured via env vars (set in Render's dashboard, not committed anywhere):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL        - the service account's client_email
//   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY  - its private_key (with literal \n sequences —
//                                         Render env vars are single-line; this unescapes them)
//   GOOGLE_SHEET_ID                     - the target spreadsheet's id (from its URL)
//   GOOGLE_SHEET_TAB_NAME               - defaults to "Players"
// The target sheet must be shared with the service account's email as an Editor, or
// every append will fail with a permission error.
// If any of the first three aren't set, this silently no-ops (logged once) rather than
// breaking email submission for an organizer who hasn't set this up (e.g. local dev).

const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PRIVATE_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_TAB_NAME = process.env.GOOGLE_SHEET_TAB_NAME || "Players";

let warnedNotConfigured = false;
let client = null;

export function isGoogleSheetsConfigured() {
  return Boolean(SERVICE_ACCOUNT_EMAIL && PRIVATE_KEY && SHEET_ID);
}

function getClient() {
  if (!client) {
    client = new JWT({
      email: SERVICE_ACCOUNT_EMAIL,
      key: PRIVATE_KEY,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }
  return client;
}

function formatDuration(ms) {
  if (ms == null) return "";
  const t = Math.round(ms / 1000);
  return t >= 60 ? `${Math.floor(t / 60)}m ${t % 60}s` : `${t}s`;
}

export async function appendPlayerRowToSheet({ name, email, score, timeSpentMs }) {
  if (!isGoogleSheetsConfigured()) {
    if (!warnedNotConfigured) {
      console.warn("[googleSheets] GOOGLE_SERVICE_ACCOUNT_EMAIL/PRIVATE_KEY/GOOGLE_SHEET_ID not set — skipping the live Google Sheet log.");
      warnedNotConfigured = true;
    }
    return;
  }

  try {
    const row = [name || "", email, score, formatDuration(timeSpentMs), new Date().toISOString()];
    const range = `${SHEET_TAB_NAME}!A:E`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
    const { token } = await getClient().getAccessToken();
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [row] }),
    });
    if (!res.ok) throw new Error(`Sheets API append failed: ${res.status} ${await res.text()}`);
  } catch (err) {
    console.error("[googleSheets] failed to append player row:", err);
  }
}
