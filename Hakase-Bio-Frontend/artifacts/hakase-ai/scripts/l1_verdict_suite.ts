/**
 * L1 VERDICT REGRESSION SUITE — real, CI-gated decision-logic tests.
 * ─────────────────────────────────────────────────────────────────────────
 * Replaces the inert `_l1regression.mts` stub. Every case below builds REAL
 * SimResults / InVitroResults via the actual L1 engines (runAdmetSimulation /
 * runInVitroSimulation) and a controlled MlOverlay, then asserts the verdict
 * `computeL1Scorecard` produces. No hand-faked scorecard structures, no random
 * inputs — the molecular-property fixtures are fixed physchem descriptors and
 * the overlays are fixed probability vectors, so each case is deterministic.
 *
 * These lock in the invariants a buyer's diligence would probe:
 *   • known approved → GO ; known withdrawn → KNOWN-LIABILITY-NO-GO
 *   • deterministic chemistry (reactive metabolite / gross Ro5) → NO-GO with ML off
 *   • clean + FULL ML safety → GO ; clean + NO ML safety → INSUFFICIENT-EVIDENCE (STRICT)
 *   • in-domain strong hERG → not GO (real liability caught)
 *   • OUT-of-domain strong hERG → not a hard NO-GO (no false stop on extrapolation)
 *   • IVIVE PK is WATCH-only: a high-first-pass readout flags + downgrades GO→WATCH
 *     but never vetoes; an insufficient-input PK readout raises nothing
 *   • determinism: same input → identical verdict/score
 *
 * Run:  pnpm -C artifacts/hakase-ai exec tsx scripts/l1_verdict_suite.ts
 * Exit code is non-zero on any failure (CI-gateable).
 */

import { runAdmetSimulation } from "../src/lib/admet";
import { runInVitroSimulation } from "../src/lib/inVitroSim";
import { emptyOverlay, type MlOverlay } from "../src/lib/mlOverlay";
import { computeL1Scorecard, type L1ScorecardInput, type KnownDrugLookup, type ApplicabilityDomain } from "../src/lib/l1Scorecard";
import type { MolecularProperties } from "../src/lib/chemistry";

// ── fixtures ────────────────────────────────────────────────────────────────
function props(p: Partial<MolecularProperties>): MolecularProperties {
  return {
    mw: 350, logP: 2.5, tpsa: 75, hbd: 1, hba: 5, rotBonds: 5,
    numAromaticRings: 2, fsp3: 0.35, heavyAtoms: 25,
    chi1v: 3, kappa2: 4, crippenMR: 90, numHeterocycles: 1,
    labuteASA: 120, numRings: 2, numSpiroAtoms: 0,
    numBridgeheadAtoms: 0, numStereoCenters: 0,
    numAliphaticRings: 0, numHeteroatoms: 4,
    qed_approx: 0.7, lipinskiPass: true, isValid: true,
    ...p,
  } as MolecularProperties;
}

const SMI = "COc1cc2c(Nc3ccc(Br)cc3F)ncnc2cc1OCC1CCN(C)CC1"; // generic drug-like scaffold
const DRUGLIKE = props({});

/** FULL ML safety overlay (all 5 gates present → mlSafetyAvailable=true), benign. */
function cleanFullSafety(): MlOverlay {
  return {
    ...emptyOverlay(),
    caco2_Papp_1e6_cm_s: 30, hia_probability: 0.95, bioavailability_F: 0.7, pgp_substrate_prob: 0.2,
    bbb_probability: 0.2, ppb_fu_fraction: 0.2, vd_l_per_kg: 1.5,
    hepatocyte_clint_ul_min_1e6_cells: 8, half_life_h: 10,
    cyp1a2_inhibitor_prob: 0.1, cyp2c9_inhibitor_prob: 0.1, cyp2c19_inhibitor_prob: 0.1,
    cyp2d6_inhibitor_prob: 0.1, cyp3a4_inhibitor_prob: 0.15,
    herg_blocker_prob: 0.1, ames_prob: 0.08, dili_prob: 0.1, dili_risk_class: "Low",
    clintox_prob: 0.05, carcinogen_prob: 0.06, skin_reaction_prob: 0.04, ld50_mg_per_kg: 3000,
    sr_mmp_prob: 0.1, sr_atad5_prob: 0.08, sr_p53_prob: 0.07, sr_are_prob: 0.1, sr_hse_prob: 0.08,
    nr_ar_prob: 0.1, nr_ar_lbd_prob: 0.1, nr_ahr_prob: 0.1, nr_aromatase_prob: 0.1,
    nr_er_prob: 0.1, nr_er_lbd_prob: 0.1, nr_ppar_gamma_prob: 0.1,
    logS: -3.0,
  };
}

const AD_IN: ApplicabilityDomain = { adScore: 0.8, adLabel: "In-domain", adConfidence: "High", nnSimilarity: 0.8, coverageNote: "in-domain" };
const AD_OUT: ApplicabilityDomain = { adScore: 0.1, adLabel: "Out-of-domain", adConfidence: "Low", nnSimilarity: 0.2, coverageNote: "extrapolation" };

function buildInputs(overlay: MlOverlay | undefined, extra: Partial<L1ScorecardInput> = {}): L1ScorecardInput {
  const admet = runAdmetSimulation(DRUGLIKE, SMI, "test", "", null, null, overlay);
  const inVitro = runInVitroSimulation(DRUGLIKE, SMI, "", null, false, null, null, overlay);
  return { admet, inVitro, overlay: overlay ?? null, ...extra };
}

// ── harness ──────────────────────────────────────────────────────────────────
let failures = 0;
function check(cond: boolean, label: string, detail = "") {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ ${label}${detail ? `  [${detail}]` : ""}`); failures++; }
}
function sec(t: string) { console.log(`\n[${t}]`); }

console.log("L1 verdict regression suite\n" + "=".repeat(60));

// 1) KNOWN APPROVED → GO
sec("known approved drug → GO");
{
  const lookup: KnownDrugLookup = { matched: true, matchType: "exact", matchConfidence: 1, tanimoto: 1,
    matchedDrugName: "caffeine", matchedDrugStatus: "approved", vetoLiabilities: [], monitorLiabilities: [] };
  const sc = computeL1Scorecard(buildInputs(undefined, { knownDrugLookup: lookup }));
  check(sc.verdict === "GO", "verdict=GO for clean approved lookup", sc.verdict);
}

// 2) KNOWN WITHDRAWN → KNOWN-LIABILITY-NO-GO
sec("known withdrawn drug → KNOWN-LIABILITY-NO-GO");
{
  const lookup: KnownDrugLookup = { matched: true, matchType: "exact", matchConfidence: 1, tanimoto: 1,
    matchedDrugName: "terfenadine", matchedDrugStatus: "withdrawn", withdrawalReason: "hERG/torsades",
    vetoLiabilities: [{ endpoint: "hERG", measured: 56, valueText: "hERG IC50 56 nM", source: "lit", severity: "veto" }],
    monitorLiabilities: [] };
  const sc = computeL1Scorecard(buildInputs(undefined, { knownDrugLookup: lookup }));
  check(sc.verdict === "KNOWN-LIABILITY-NO-GO", "verdict=KNOWN-LIABILITY-NO-GO for withdrawn drug", sc.verdict);
  check(sc.flags.some(f => f.hardNoGo && f.provenance === "experimental"), "carries an experimental hard flag");
}

// 3) REACTIVE-METABOLITE — CORROBORATION-GATED (validation-driven fix)
sec("reactive-metabolite: lone alert → not a hard veto; corroborated → NO-GO");
{
  // (a) single critical alert, no corroboration → must NOT hard-veto (was a false NO-GO before).
  const lone = computeL1Scorecard(buildInputs(undefined, { reactiveMetabolites: { critical_count: 1 } }));
  check(lone.verdict !== "NO-GO", "lone uncorroborated RM alert does NOT hard-veto", lone.verdict);
  check(lone.flags.some(f => f.id === "reactive_met_watch" && !f.hardNoGo), "raises reactive_met_watch (monitor, not veto)");
  // (b) ≥2 independent critical motifs → corroborated → NO-GO.
  const multi = computeL1Scorecard(buildInputs(undefined, { reactiveMetabolites: { critical_count: 2 } }));
  check(multi.verdict === "NO-GO", "≥2 critical motifs → NO-GO (corroborated)", multi.verdict);
  // (c) RM alert + high DILI (full ML safety) → corroborated → NO-GO.
  const od = cleanFullSafety(); od.dili_prob = 0.95; od.dili_risk_class = "High";
  const withDili = computeL1Scorecard(buildInputs(od, { applicabilityDomain: AD_IN, reactiveMetabolites: { critical_count: 1 } }));
  check(withDili.verdict === "NO-GO", "RM alert + high DILI → NO-GO (corroborated)", withDili.verdict);
  check(withDili.flags.some(f => f.id === "reactive_met_hard" && f.hardNoGo), "reactive_met_hard present when corroborated");
}

// 4) GROSS Ro5 FAILURE (small molecule, ≥3 violations) → NO-GO
sec("gross Ro5 failure (small molecule) → NO-GO");
{
  const bad = props({ mw: 680, logP: 6.2, hbd: 6, hba: 12, rotBonds: 6 }); // 3 violations, MW<700 (not bRo5)
  const admet = runAdmetSimulation(bad, SMI, "t", "", null, null, undefined);
  const inVitro = runInVitroSimulation(bad, SMI, "", null, false, null, null, undefined);
  const sc = computeL1Scorecard({ admet, inVitro, overlay: null });
  check(admet.lipinski.violations >= 3, "fixture yields ≥3 Ro5 violations", `viol=${admet.lipinski.violations}`);
  check(sc.verdict === "NO-GO", "verdict=NO-GO on gross drug-likeness failure", sc.verdict);
}

// 5) CLEAN + FULL ML SAFETY + in-domain → GO
sec("clean + full ML safety + in-domain → GO");
{
  const sc = computeL1Scorecard(buildInputs(cleanFullSafety(), { applicabilityDomain: AD_IN }));
  check(sc.verdict === "GO", "verdict=GO for clean fully-evidenced molecule", `${sc.verdict} (composite ${sc.compositeRaw}, conf ${sc.confidence})`);
}

// 6) CLEAN but NO ML SAFETY (STRICT) → INSUFFICIENT-EVIDENCE
sec("clean but ML safety stack absent → INSUFFICIENT-EVIDENCE (STRICT)");
{
  // Overlay with only ADME, no safety probs → mlSafetyAvailable=false.
  const o: MlOverlay = { ...emptyOverlay(), caco2_Papp_1e6_cm_s: 30, hia_probability: 0.95, ppb_fu_fraction: 0.2, hepatocyte_clint_ul_min_1e6_cells: 8 };
  const sc = computeL1Scorecard(buildInputs(o, { applicabilityDomain: AD_IN }));
  check(sc.verdict === "INSUFFICIENT-EVIDENCE", "verdict=INSUFFICIENT-EVIDENCE without real ML safety", sc.verdict);
}

// 7) IN-DOMAIN strong hERG → NOT GO (catches a real liability)
sec("in-domain strong hERG → not GO");
{
  const o = cleanFullSafety(); o.herg_blocker_prob = 0.98;
  const sc = computeL1Scorecard(buildInputs(o, { applicabilityDomain: AD_IN }));
  check(sc.verdict !== "GO", "strong in-domain hERG never returns GO", sc.verdict);
  check(sc.flags.some(f => /herg/i.test(f.id)), "a hERG flag is raised");
}

// 8) OUT-OF-DOMAIN strong hERG → NOT a hard NO-GO (no false stop on extrapolation)
sec("out-of-domain strong hERG → escalate, not a hard NO-GO");
{
  const o = cleanFullSafety(); o.herg_blocker_prob = 0.98;
  const sc = computeL1Scorecard(buildInputs(o, { applicabilityDomain: AD_OUT }));
  check(sc.verdict !== "NO-GO", "out-of-domain extrapolation does NOT hard-veto", sc.verdict);
  check(sc.verdictClass === "review-escalate" || sc.verdict === "WATCH", "routes to WATCH/review-escalate", `${sc.verdict}/${sc.verdictClass}`);
}

// 9) IVIVE PK — WATCH-only: high first-pass flags + downgrades GO→WATCH, never vetoes
sec("IVIVE PK high first-pass → WATCH-only flag, GO downgraded, no veto");
{
  const sc = computeL1Scorecard(buildInputs(cleanFullSafety(), {
    applicabilityDomain: AD_IN,
    pk: { available: true, extractionClass: "high", extractionRatio: 0.85, firstPassAvailability: 0.15, halfLifeH: 5, halfLifeCrosscheckAgree: true },
  }));
  check(sc.flags.some(f => f.id === "pk_high_first_pass"), "pk_high_first_pass flag raised");
  check(!sc.flags.some(f => f.id === "pk_high_first_pass" && f.hardNoGo), "PK flag is NEVER a hard veto");
  check(sc.verdict === "WATCH", "GO downgraded to WATCH by the PK flag", sc.verdict);
}

// 10) IVIVE PK insufficient-input → raises NOTHING (no fabricated PK)
sec("IVIVE PK insufficient-input → no pk flags, verdict unchanged");
{
  const base = computeL1Scorecard(buildInputs(cleanFullSafety(), { applicabilityDomain: AD_IN }));
  const withUnavail = computeL1Scorecard(buildInputs(cleanFullSafety(), { applicabilityDomain: AD_IN, pk: { available: false } }));
  check(!withUnavail.flags.some(f => f.id.startsWith("pk_")), "no pk_* flags when PK unavailable");
  check(withUnavail.verdict === base.verdict, "verdict identical to no-PK baseline", `${withUnavail.verdict} vs ${base.verdict}`);
}

// 11) IVIVE PK short half-life → WATCH flag
sec("IVIVE PK short half-life → WATCH flag");
{
  const sc = computeL1Scorecard(buildInputs(cleanFullSafety(), {
    applicabilityDomain: AD_IN,
    pk: { available: true, extractionClass: "low", extractionRatio: 0.1, firstPassAvailability: 0.9, halfLifeH: 0.5, halfLifeCrosscheckAgree: true },
  }));
  check(sc.flags.some(f => f.id === "pk_short_half_life"), "pk_short_half_life flag raised");
}

// 12) DETERMINISM — same input → identical verdict/score/flag-count
sec("determinism: same input → identical output");
{
  const i1 = buildInputs(cleanFullSafety(), { applicabilityDomain: AD_IN });
  const a = computeL1Scorecard(i1);
  const b = computeL1Scorecard(i1);
  check(a.verdict === b.verdict && a.score === b.score && a.flags.length === b.flags.length, "verdict, score, flag-count stable across runs");
}

console.log("\n" + "=".repeat(60));
console.log(failures === 0 ? `PASS — all verdict cases succeeded` : `FAIL — ${failures} assertion(s) failed`);
process.exit(failures === 0 ? 0 : 1);
