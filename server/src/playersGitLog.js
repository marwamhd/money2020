// Commits every player's row directly into the GitHub repo itself via the Contents API —
// deliberately NOT local disk, NOT even a Render persistent Disk. The whole point is that
// this survives no matter what happens to the Render service (wiped disk, redeploy, the
// service deleted entirely) because it lives in git history on GitHub, independent of
// anything running on Render. See players.xlsx (playersExport.js) for the local, same-disk
// copy and googleSheets.js for the live, no-export-needed copy — this is the third,
// most durable one, matching Marwa's explicit "saved here in the codebase as well".
//
// Configured entirely via env vars (set in Render's dashboard, not committed anywhere):
//   GITHUB_TOKEN              - a GitHub Personal Access Token with 'contents: write' on the repo
//   GITHUB_REPO               - "owner/repo", e.g. "Tanami-Capital/money2020-game"
//   GITHUB_BRANCH             - defaults to "main"
//   GITHUB_PLAYERS_LOG_PATH   - defaults to "server/data/players-log.csv"
// If GITHUB_TOKEN or GITHUB_REPO aren't set, this silently no-ops (logged once) rather
// than breaking email submission for an organizer who hasn't set this up (e.g. local dev).

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const GITHUB_PLAYERS_LOG_PATH = process.env.GITHUB_PLAYERS_LOG_PATH || "server/data/players-log.csv";

const CSV_HEADER = "Name,Email,Score,Time Played,Submitted At";

let warnedNotConfigured = false;

export function isGitLogConfigured() {
  return Boolean(GITHUB_TOKEN && GITHUB_REPO);
}

function formatDuration(ms) {
  if (ms == null) return "";
  const t = Math.round(ms / 1000);
  return t >= 60 ? `${Math.floor(t / 60)}m ${t % 60}s` : `${t}s`;
}

function csvCell(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function apiUrl(path) {
  return `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`;
}

function githubHeaders() {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
}

// GET returns 404 the very first time (file doesn't exist yet) — that's expected, not
// an error, and means we're creating the file fresh with just the header + this row.
async function getCurrentFile() {
  const res = await fetch(apiUrl(GITHUB_PLAYERS_LOG_PATH) + `?ref=${GITHUB_BRANCH}`, { headers: githubHeaders() });
  if (res.status === 404) return { content: CSV_HEADER + "\n", sha: null };
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return { content: Buffer.from(json.content, "base64").toString("utf8"), sha: json.sha };
}

async function putFile(newContent, sha, commitMessage) {
  const res = await fetch(apiUrl(GITHUB_PLAYERS_LOG_PATH), {
    method: "PUT",
    headers: githubHeaders(),
    body: JSON.stringify({
      message: commitMessage,
      content: Buffer.from(newContent, "utf8").toString("base64"),
      branch: GITHUB_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw new Error(`GitHub PUT failed: ${res.status} ${await res.text()}`);
}

// Serialized through a single promise chain (same pattern as playersExport.js) — two
// players submitting near-simultaneously both need a read-modify-write of the same file,
// and the GitHub API itself also rejects a stale sha (409) if something else touched the
// file in between, so one retry re-fetches the latest sha and tries again once.
let queue = Promise.resolve();

export function appendPlayerRowToGit({ name, email, score, timeSpentMs }) {
  if (!isGitLogConfigured()) {
    if (!warnedNotConfigured) {
      console.warn("[playersGitLog] GITHUB_TOKEN/GITHUB_REPO not set — skipping the in-codebase players log.");
      warnedNotConfigured = true;
    }
    return Promise.resolve();
  }

  const row = [name || "", email, score, formatDuration(timeSpentMs), new Date().toISOString()].map(csvCell).join(",");

  queue = queue.then(() => appendWithRetry(row)).catch((err) => {
    console.error("[playersGitLog] failed to commit player row:", err);
  });
  return queue;
}

async function appendWithRetry(row, attempt = 0) {
  const { content, sha } = await getCurrentFile();
  const newContent = content.endsWith("\n") ? content + row + "\n" : content + "\n" + row + "\n";
  try {
    await putFile(newContent, sha, `Add player submission (${row.split(",")[0]})`);
  } catch (err) {
    if (attempt === 0 && String(err.message).includes("409")) {
      return appendWithRetry(row, attempt + 1);
    }
    throw err;
  }
}
