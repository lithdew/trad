/**
 * Frontend entry point — mounts the React app.
 * Included via <script> in index.html.
 */
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

function start() {
  const root = createRoot(document.getElementById("root")!);
  root.render(<App />);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
