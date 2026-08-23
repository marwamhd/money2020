# Money20/20 Booth Trivia Game

Two-player head-to-head trivia game for the Money20/20 booth (Linear: TAN-2239 and sub-issues).
Runs as a single local instance on the booth laptop — no internet dependency for gameplay.

## Stack

- **Backend:** Node + Express + Socket.io (server-authoritative game state/timer/scoring), SQLite (`better-sqlite3`)
- **Frontend:** React + Vite — `/play/:code`, `/screen/:code`, `/admin` (not built yet, pending design)

## Setup

```bash
cd server && npm install
```

The first install also creates and seeds the SQLite DB from `server/data/questions.json` (155 questions across R1/R2/R3, converted from the source xlsx).

## Run

```bash
cd server && npm start
```

Serves everything on `http://localhost:3000` (override with `PORT`). The admin API (`/api/admin/*`) requires an `x-admin-token` header — a random one is printed to the console on startup, or set your own via `M2020_ADMIN_TOKEN`.

## Test

```bash
cd server && npm test
```

18 automated tests covering scoring, duplicate submissions, answer ordering, state transitions, and reconnection.

## Config overrides (all optional env vars)

`M2020_COUNTDOWN_MS`, `M2020_SECTION_DURATION_MS`, `M2020_QUESTION_TIMEOUT_MS`, `M2020_RUNNER_UP_POINTS` — defaults are 3s / 60s / 25s / 30pts. These can also be set live via the admin API and persist across restarts.
