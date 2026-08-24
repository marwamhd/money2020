import React from "react";
import ReactDOM from "react-dom/client";
import PlayPage from "./pages/PlayPage.jsx";
import ScreenPage from "./pages/ScreenPage.jsx";
import AdminPage from "./pages/AdminPage.jsx";
import "./styles.css";

function Router() {
  const path = window.location.pathname;
  if (path.startsWith("/play")) {
    // /play/:code — the match code from the booth screen's QR, required to join.
    const code = path.split("/")[2] || null;
    return <PlayPage code={code} />;
  }
  if (path.startsWith("/screen")) return <ScreenPage />;
  if (path.startsWith("/admin")) return <AdminPage />;
  return <ScreenPage />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Router />
  </React.StrictMode>
);
