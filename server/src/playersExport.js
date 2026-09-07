import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same tradeoff as game.db (see db.js): gitignored, lives on whatever disk the server
// process has — ephemeral on a host with no persistent Disk attached, so a redeploy
// wipes it just like the database does.
export const PLAYERS_XLSX_PATH = process.env.M2020_PLAYERS_XLSX_PATH || path.join(__dirname, "..", "data", "players.xlsx");

const HEADERS = ["Name", "Email", "Score"];

// Every submitEmail success appends a row here — unlike the `leaderboard` DB table
// (one row per unique email, first score wins, for prize ranking), this is a plain
// append-only log of every player who finished a match and provided an email, in
// order, duplicates and all. That's a different question ("who played and gave us
// an email") than the leaderboard answers ("who has the best score, once per person").
//
// Serialized through a single promise chain: two players finishing near-simultaneously
// both trigger a read-modify-write of the same file, and without this a race could lose
// one of the two appends.
let queue = Promise.resolve();

export function appendPlayerRow({ name, email, score }) {
  queue = queue.then(() => reallyAppend({ name, email, score })).catch((err) => {
    console.error("[playersExport] failed to append row:", err);
  });
  return queue;
}

async function reallyAppend({ name, email, score }) {
  const workbook = new ExcelJS.Workbook();
  let sheet;
  try {
    await workbook.xlsx.readFile(PLAYERS_XLSX_PATH);
    sheet = workbook.getWorksheet("Players");
  } catch {
    // File doesn't exist yet (first ever submission) — start a fresh workbook.
  }
  if (!sheet) {
    sheet = workbook.addWorksheet("Players");
    sheet.addRow(HEADERS);
    sheet.getRow(1).font = { bold: true };
  }

  sheet.addRow([name || "", email, score]);
  await workbook.xlsx.writeFile(PLAYERS_XLSX_PATH);
}
