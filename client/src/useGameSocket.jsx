import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

let sharedSocket = null;
function getSocket() {
  if (!sharedSocket) sharedSocket = io({ transports: ["websocket"] });
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
