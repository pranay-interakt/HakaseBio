import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initChemistry } from "./lib/chemistry";

// Start loading the RDKit WASM immediately at app startup so it's ready
// (or close to ready) by the time the user navigates to the dashboard.
initChemistry().catch(() => {});

createRoot(document.getElementById("root")!).render(<App />);
