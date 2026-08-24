FROM node:20-bookworm-slim

# better-sqlite3 compiles a native binding at install time if no prebuilt binary
# matches this platform — these let that fallback succeed instead of failing the build.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

COPY client/package*.json ./client/
RUN cd client && npm ci

COPY client ./client
COPY server ./server

RUN cd client && npm run build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server/src/index.js"]
