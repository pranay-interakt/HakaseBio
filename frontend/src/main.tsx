import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyPrefs, loadPrefs } from "./lib/prefs";
import "./styles.css";

// before the first paint, so the chosen theme never flashes the other one
applyPrefs(loadPrefs());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
