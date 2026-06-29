/* ───────────────────────────────────────────────────────────────────────────
   LabDashboard (/lab) — the EXACT main dashboard, re-skinned.

   It renders the real <HakaseAI /> (same code, same inputs, outputs, layers,
   logic — nothing forked) and only forces the existing light theme on plus a
   cosy "lab-skin" palette refinement. The production /dashboard route is
   untouched (stays dark by default).
   ─────────────────────────────────────────────────────────────────────────── */

import { useEffect } from "react";
import { HakaseAI } from "@/pages/HakaseAI";
import "../lab/lab-skin.css";

export function LabDashboard() {
  useEffect(() => {
    const el = document.documentElement;
    const hadLight = el.classList.contains("hk-light");
    el.classList.add("hk-light", "lab-skin");
    return () => {
      el.classList.remove("lab-skin");
      if (!hadLight) el.classList.remove("hk-light");
    };
  }, []);

  return <HakaseAI />;
}

export default LabDashboard;
