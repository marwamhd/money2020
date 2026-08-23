# Money20/20 Booth Trivia Game

Two-player head-to-head trivia game for the Money20/20 booth.

## Stack

- **Backend:** Node, Express, Socket.io, SQLite (`better-sqlite3`)
- **Frontend:** React + Vite, `/play/:code`, `/screen/:code`, `/admin`

## Setup

```bash
cd server && npm install
```

## Run

```bash
cd server && npm start
```

Serves on `http://localhost:3000` (override with `PORT`). Admin API needs an `x-admin-token` header, printed on startup or set via `M2020_ADMIN_TOKEN`.

## Test

```bash
cd server && npm test
```

## Config

Optional env vars: `M2020_COUNTDOWN_MS`, `M2020_SECTION_DURATION_MS`, `M2020_QUESTION_TIMEOUT_MS`, `M2020_RUNNER_UP_POINTS`. Also settable live via the admin API.
