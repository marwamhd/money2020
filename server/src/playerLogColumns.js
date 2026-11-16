// The columns every players log has, in order: the local players.xlsx, the live Google Sheet and
// the git-committed players-log.csv all write the same ones, so a row means the same thing
// everywhere. The first five predate ENG-576 and keep their positions, so older rows (which stop
// at "Submitted At") still line up under the same headers.
export const PLAYER_LOG_HEADERS = [
  "Name",
  "Email",
  "Score",
  "Time Played",
  "Submitted At",
  "Result", // Winner, Runner-up or Tie
  "Opponent",
  "Opponent Score",
  "Match ID", // shared by the two players of one match, to group their rows
];

// The ENG-576 columns, in order, for one row. Blank (not "undefined") when a value isn't known,
// e.g. an opponent who was never recorded.
export function matchCells({ result, opponentName, opponentScore, matchId }) {
  return [result ?? "", opponentName ?? "", opponentScore ?? "", matchId ?? ""];
}
