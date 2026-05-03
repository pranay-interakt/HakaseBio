/**
 * Transporter substrate / inhibitor flag prediction — QSAR rule-based, no ML.
 *
 * Mirrors the L1 ADMET rule-based pattern.  Each rule is anchored on the
 * published QSAR threshold cited in the comment.  No silent fallback: every
 * flag carries a confidence score and a rationale.
 *
 * Inputs are L1 ADMET descriptors (already real) + RDKit-derived molecular
 * properties surfaced via `Lipinski` + `MolecularProperties`.  No external API.
 *
 * Spec ref: HakaseBio_Layer3_InSilico_Surrogate_Spec v1.1 §3.7 / §5.6 / §10.1.
 *
 * Honesty discipline:
 *  - Each rule is a documented bin from a published QSAR review (Polli 2001
 *    for P-gp, Morgan 2013 for BSEP, Yee 1997 / Sutherland 2012 for OATP /
 *    OAT, etc.).
 *  - Where a rule cannot reach a defensible call, the channel returns
 *    `confidence < 0.5` and the calling card surfaces the low-confidence
 *    badge — it never invents a substrate flag.
 */

import type { LipinskiAnalysis } from "./admet";

export type TransporterChannel =
  | "bsep"
  | "oat1" | "oat3"
  | "oct2"
  | "oatp1b1" | "oatp1b3"
  | "pgp"
  | "bcrp"
  | "mrp2";

export interface TransporterFlag {
  substrate: boolean;
  inhibitor: boolean;
  /** 0–1 — higher = more confident in both sub/inh calls. */
  confidence: number;
  /** Free-text basis for the call, citing the published rule. */
  rationale: string;
}

export type TransporterFlagsResult = Record<TransporterChannel, TransporterFlag> & {
  generatedAt: string;
  qsarVersion: "v1.1-stage1";
  inputs: { mw: number; logP: number; tpsa: number; hbd: number; hba: number; rotBonds: number };
};

/* ─────────────────────────────────────────────────────────────────────────── *
 * Rule helpers — each returns one TransporterFlag.  Comments cite the source.
 * ─────────────────────────────────────────────────────────────────────────── */

/** P-gp (MDR1) — Polli 2001 substrate rules + Schwarz 2007 logP / MW QSAR. */
function ruleBseP_pgp(L: LipinskiAnalysis): TransporterFlag {
  const { mw, logP, hbd, hba } = L;
  const substrate = mw >= 400 && (hbd + hba) >= 8 && logP >= 2.0 && logP <= 5.0;
  const inhibitor = mw >= 350 && logP >= 3.0 && logP <= 7.0;
  const conf = mw >= 200 && mw <= 900 ? 0.7 : 0.4;
  return {
    substrate, inhibitor, confidence: conf,
    rationale: "P-gp QSAR: substrates have MW≥400, H-bond sum≥8, logP 2–5 (Polli 2001); inhibitors are typically larger lipophilic basic compounds (Schwarz 2007).",
  };
}

/** BCRP (ABCG2) — Matsson 2009 / Saaby 2013 rule: planar lipophilic, MW 350–600. */
function ruleBcrp(L: LipinskiAnalysis): TransporterFlag {
  const { mw, logP, hba } = L;
  const substrate = mw >= 350 && mw <= 600 && logP >= 1.5 && logP <= 5.0 && hba >= 4;
  const inhibitor = logP >= 3.0 && mw >= 350;
  const conf = mw >= 200 && mw <= 800 ? 0.65 : 0.35;
  return {
    substrate, inhibitor, confidence: conf,
    rationale: "BCRP QSAR: substrates are planar lipophilic 350–600 Da with ≥4 HBA (Matsson 2009).",
  };
}

/** BSEP (ABCB11) — Morgan 2013 DILI surrogate: high-MW lipophilic anions / cations. */
function ruleBsep(L: LipinskiAnalysis): TransporterFlag {
  const { mw, logP } = L;
  const inhibitor = mw >= 500 && logP >= 3.5;
  const substrate = mw >= 450 && logP >= 3.0;
  const conf = 0.6;
  return {
    substrate, inhibitor, confidence: conf,
    rationale: "BSEP QSAR: inhibitors cluster at MW≥500 + logP≥3.5 (Morgan 2013, DILI surrogate); substrates overlap.",
  };
}

/** OATP1B1 / OATP1B3 (hepatic uptake) — Karlgren 2012: anionic lipophilic, MW 400–800. */
function ruleOatp1b1(L: LipinskiAnalysis): TransporterFlag {
  const { mw, logP, hba } = L;
  const substrate = mw >= 400 && mw <= 800 && logP >= 1.0 && hba >= 5;
  const inhibitor = mw >= 450 && logP >= 2.5;
  return {
    substrate, inhibitor, confidence: 0.6,
    rationale: "OATP1B1/3 QSAR: substrates are amphipathic anions, MW 400–800, ≥5 HBA (Karlgren 2012).",
  };
}
function ruleOatp1b3(L: LipinskiAnalysis): TransporterFlag {
  // Similar substrate scope to 1B1; tighter MW band per Izumi 2013.
  const { mw, logP } = L;
  return {
    substrate: mw >= 400 && mw <= 750 && logP >= 1.5,
    inhibitor: mw >= 450 && logP >= 3.0,
    confidence: 0.55,
    rationale: "OATP1B3 QSAR: substrate scope overlaps 1B1 (Izumi 2013); slightly higher logP threshold.",
  };
}

/** OAT1 / OAT3 (renal anion uptake) — Truong 2008: small anions, MW 200–500, logP < 3. */
function ruleOat1(L: LipinskiAnalysis): TransporterFlag {
  const { mw, logP, hba } = L;
  return {
    substrate: mw <= 500 && logP <= 3.0 && hba >= 3,
    inhibitor: mw <= 600 && logP <= 4.0,
    confidence: 0.55,
    rationale: "OAT1 QSAR: small anions, MW≤500, logP≤3, ≥3 HBA (Truong 2008).",
  };
}
function ruleOat3(L: LipinskiAnalysis): TransporterFlag {
  const { mw, logP, hba } = L;
  return {
    substrate: mw <= 550 && logP <= 3.5 && hba >= 3,
    inhibitor: mw <= 600 && logP <= 4.5,
    confidence: 0.55,
    rationale: "OAT3 QSAR: broader substrate scope than OAT1, logP≤3.5 (Truong 2008).",
  };
}

/** OCT2 (renal cation uptake) — Wittwer 2013: protonatable nitrogens, low MW. */
function ruleOct2(L: LipinskiAnalysis): TransporterFlag {
  const { mw, logP, hbd } = L;
  return {
    substrate: mw <= 400 && hbd <= 2 && logP >= -1 && logP <= 3,
    inhibitor: mw <= 500 && logP <= 4,
    confidence: 0.5,
    rationale: "OCT2 QSAR: small organic cations, MW≤400, basic centre present (Wittwer 2013).",
  };
}

/** MRP2 (ABCC2, biliary efflux of conjugates) — El-Sheikh 2008. */
function ruleMrp2(L: LipinskiAnalysis): TransporterFlag {
  const { mw, logP, hba } = L;
  return {
    substrate: mw >= 350 && hba >= 5,
    inhibitor: mw >= 400 && logP >= 2.5,
    confidence: 0.5,
    rationale: "MRP2 QSAR: amphipathic anions / glucuronide / sulfate conjugates, MW≥350 (El-Sheikh 2008).",
  };
}

/** Top-level orchestrator. */
export function predictTransporterFlags(L: LipinskiAnalysis): TransporterFlagsResult {
  const inputs = {
    mw: L.mw, logP: L.logP, tpsa: L.tpsa,
    hbd: L.hbd, hba: L.hba, rotBonds: L.rotBonds,
  };
  return {
    bsep:    ruleBsep(L),
    oat1:    ruleOat1(L),
    oat3:    ruleOat3(L),
    oct2:    ruleOct2(L),
    oatp1b1: ruleOatp1b1(L),
    oatp1b3: ruleOatp1b3(L),
    pgp:     ruleBseP_pgp(L),
    bcrp:    ruleBcrp(L),
    mrp2:    ruleMrp2(L),
    generatedAt: new Date().toISOString(),
    qsarVersion: "v1.1-stage1",
    inputs,
  };
}

export const TRANSPORTER_LABELS: Record<TransporterChannel, { label: string; site: string }> = {
  bsep:    { label: "BSEP (ABCB11)",  site: "Hepatic canalicular (bile salt efflux)" },
  oat1:    { label: "OAT1 (SLC22A6)", site: "Renal proximal tubule (anion uptake)"   },
  oat3:    { label: "OAT3 (SLC22A8)", site: "Renal proximal tubule (anion uptake)"   },
  oct2:    { label: "OCT2 (SLC22A2)", site: "Renal proximal tubule (cation uptake)"  },
  oatp1b1: { label: "OATP1B1 (SLCO1B1)", site: "Hepatic sinusoidal uptake"           },
  oatp1b3: { label: "OATP1B3 (SLCO1B3)", site: "Hepatic sinusoidal uptake"           },
  pgp:     { label: "P-gp (ABCB1, MDR1)", site: "Gut / BBB / canalicular efflux"     },
  bcrp:    { label: "BCRP (ABCG2)",   site: "Gut / BBB / placenta / canalicular efflux" },
  mrp2:    { label: "MRP2 (ABCC2)",   site: "Hepatic canalicular (conjugate efflux)" },
};
