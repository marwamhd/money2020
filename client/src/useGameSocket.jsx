import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

// Which match this page belongs to is decided by its URL, and tells the server which
// station's updates to send:
//   /play/<code>     -> a phone; the match code from the QR picks the station
//   /screen/2        -> a booth TV for station 2 (typed in the URL, always wins)
//   /, /screen       -> a booth TV with no number: the server gives it the first station
//                       that has no TV yet, and this tab remembers it (see below)
// /admin never shows a match, so it just takes the default.
const STATION_KEY = "m2020_screen_station";

function isScreenPath() {
  const [, page] = window.location.pathname.split("/");
  return page !== "play" && page !== "admin";
}

function readRememberedStation() {
  try {
    return sessionStorage.getItem(STATION_KEY) || null;
  } catch {
    return null; // storage can be blocked (kiosk/private modes); just get a fresh assignment
  }
}

function stationQueryFromUrl() {
  const [, page, segment] = window.location.pathname.split("/");
  if (page === "play") return segment ? { code: segment } : {};
  if (!isScreenPath()) return {};
  if (page === "screen" && /^\d+$/.test(segment || "")) return { role: "screen", station: segment };
  // sessionStorage (not localStorage): it survives a reload of this tab but is NOT shared with
  // other tabs, so two tabs in one browser can still be two different screens.
  const remembered = readRememberedStation();
  return remembered ? { role: "screen", station: remembered } : { role: "screen" };
}

let sharedSocket = null;
function getSocket() {
  if (!sharedSocket) {
    sharedSocket = io({ transports: ["websocket"], query: stationQueryFromUrl() });

    // A screen with no number in its URL learns its station from the first state it gets.
    // Remember it, and make socket.io's own automatic reconnects ask for that exact station
    // (its query is otherwise reused as-is, which would request a fresh assignment each time
    // and could swap two TVs after a wifi blip).
    if (isScreenPath()) {
      sharedSocket.on("state", (state) => {
        if (!state?.stationId) return;
        sharedSocket.io.opts.query = { role: "screen", station: String(state.stationId) };
        try {
          sessionStorage.setItem(STATION_KEY, String(state.stationId));
        } catch {
          /* private/kiosk mode: reconnects still work from the in-memory query above */
        }
      });
    }
  }
  return sharedSocket;
}

export function useGameSocket() {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;
    setConnected(socket.connected);

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on("state", setState);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("state", setState);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  return { state, socket: socketRef.current, connected };
}

// A non-blocking banner to render whenever `connected` is false — the underlying
// screen stays visible (so it's clear this is a connection issue, not a fresh
// blank state), but the viewer knows the game is trying to reconnect.
export function ReconnectingBanner({ connected }) {
  if (connected) return null;
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        padding: "10px 16px",
        textAlign: "center",
        fontSize: 13,
        fontWeight: 700,
        fontFamily: "'Merriweather Sans',sans-serif",
        color: "#fff",
        background: "#020844",
        animation: "pulse 1.4s infinite",
      }}
    >
      Reconnecting…
    </div>
  );
}

// Ticks a re-render every `intervalMs` while counting down to `endsAt` (a server
// timestamp), so the displayed number stays in sync with the server-authoritative clock.
export function useCountdown(endsAt, intervalMs = 200) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => forceTick((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [endsAt, intervalMs]);

  if (!endsAt) return 0;
  return Math.max(0, endsAt - Date.now());
}
