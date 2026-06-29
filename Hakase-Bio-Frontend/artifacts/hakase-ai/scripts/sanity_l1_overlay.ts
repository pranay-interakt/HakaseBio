/**
 * L1 sanity check — exercises runAdmetSimulation and runInVitroSimulation
 * with and without an ML overlay on a small fixture set so we can confirm:
 *
 *   1. Off-catalog molecules with no overlay return binding=null (no fabrication)
 *      and ic50_nM=null (RF#7 dose-response gate).
 *   2. Provenance flips heuristic↔ml correctly when the overlay is supplied.
 *   3. Same SMILES → same outputs (determinism; jitter removed).
 *   4. mlEnhanced flag is true iff the overlay contains any ml signal.
 *   5. The Go/No-Go decision reflects ML probabilities when an overlay says
 *      a high DILI / hERG / AMES probability.
 *
 * Run from the repo with:
 *   pnpm -C artifacts/hakase-ai exec tsx scripts/sanity_l1_overlay.ts
 */

import { runAdmetSimulation } from "../src/lib/admet";
import { runInVitroSimulation } from "../src/lib/inVitroSim";
import { emptyOverlay, type MlOverlay } from "../src/lib/mlOverlay";
import type { MolecularProperties } from "../src/lib/chemistry";

/** Minimal MolecularProperties shape — values approximate published descriptors. */
function fakeProps(p: Partial<MolecularProperties>): MolecularProperties {
  return {
    mw: 300, logP: 2.0, tpsa: 75, hbd: 2, hba: 4, rotBonds: 4,
    numAromaticRings: 1, fsp3: 0.3, heavyAtoms: 20,
    chi1v: 3, kappa2: 4, crippenMR: 80, numHeterocycles: 1,
    labuteASA: 100, numRings: 1, numSpiroAtoms: 0,
    numBridgeheadAtoms: 0, numStereoCenters: 0,
    numAliphaticRings: 0, numHeteroatoms: 2,
    qed_approx: 0.6, lipinskiPass: true,
    isValid: true,
    ...p,
  } as MolecularProperties;
}

interface Fixture {
  name: string;
  smiles: string;
  uniprot: string;
  ta: string | null;
  props: MolecularProperties;
  overlay?: MlOverlay;
  expect: {
    bindingNullable?: boolean;     // expect binding === null without overlay?
    doseResponseNullable?: boolean;
  };
}

const fixtures: Fixture[] = [
  {
    name: "caffeine — off-catalog molecule, no UniProt",
    smiles: "CN1C=NC2=C1C(=O)N(C(=O)N2C)C",
    uniprot: "",
    ta: null,
    props: fakeProps({ mw: 194.19, logP: -0.07, tpsa: 58, hbd: 0, hba: 6,
                       rotBonds: 0, numAromaticRings: 2, heavyAtoms: 14, qed_approx: 0.55, lipinskiPass: true }),
    expect: { bindingNullable: true, doseResponseNullable: true },
  },
  {
    name: "palmitic acid — fatty acid, off-catalog scaffold",
    smiles: "CCCCCCCCCCCCCCCC(=O)O",
    uniprot: "",
    ta: null,
    props: fakeProps({ mw: 256.42, logP: 7.17, tpsa: 37, hbd: 1, hba: 2,
                       rotBonds: 14, numAromaticRings: 0, fsp3: 0.94, heavyAtoms: 18,
                       qed_approx: 0.20, lipinskiPass: false }),
    expect: { bindingNullable: true, doseResponseNullable: true },
  },
  {
    name: "EGFR-targeted kinase inhibitor — catalog target",
    smiles: "COC1=CC2=C(C=CN=C2C=C1OC)C3=CC=C(C=C3)NC(=O)C4=CC=CC=C4",
    uniprot: "P00533",   // EGFR — in TARGET_MAP and DrugCentral
    ta: "Oncology",
    props: fakeProps({ mw: 386, logP: 4.1, tpsa: 65, hbd: 1, hba: 5,
                       rotBonds: 6, numAromaticRings: 4, heavyAtoms: 29, qed_approx: 0.78, lipinskiPass: true }),
    expect: { bindingNullable: false, doseResponseNullable: false },
  },
  {
    name: "hexafluoroethane — clearly non-drug",
    smiles: "FC(F)(F)C(F)(F)F",
    uniprot: "",
    ta: null,
    props: fakeProps({ mw: 138, logP: 1.5, tpsa: 0, hbd: 0, hba: 6,
                       rotBonds: 1, numAromaticRings: 0, fsp3: 1.0, heavyAtoms: 8, qed_approx: 0.10, lipinskiPass: true }),
    expect: { bindingNullable: true, doseResponseNullable: true },
  },
];

// Build a synthetic high-toxicity overlay to test that L1 escalates Go/No-Go.
const toxicOverlay: MlOverlay = {
  ...emptyOverlay(),
  caco2_Papp_1e6_cm_s: 12,
  hia_probability: 0.85,
  bbb_probability: 0.15,
  ppb_fu_fraction: 0.10,
  vd_l_per_kg: 2.0,
  hepatocyte_clint_ul_min_1e6_cells: 30,
  half_life_h: 18,
  cyp1a2_inhibitor_prob: 0.20, cyp2c9_inhibitor_prob: 0.30,
  cyp2c19_inhibitor_prob: 0.15, cyp2d6_inhibitor_prob: 0.40,
  cyp3a4_inhibitor_prob: 0.75,
  // Toxicity signals that should drive WATCH/NO-GO
  herg_blocker_prob: 0.85,    // high cardiac risk
  herg_ic50_band_um: 0.8,
  ames_prob: 0.78,             // mutagenic
  dili_prob: 0.82, dili_risk_class: "High",
  clintox_prob: 0.55,
  carcinogen_prob: 0.40,
  skin_reaction_prob: 0.10,
  ld50_mg_per_kg: 250,
  Kd_nM: 45,                   // potent
  logS: -3.5,
};

// Build a synthetic clean overlay to test that L1 surfaces GO when ML is benign.
const cleanOverlay: MlOverlay = {
  ...emptyOverlay(),
  caco2_Papp_1e6_cm_s: 35,
  hia_probability: 0.95,
  bioavailability_F: 0.78,
  bbb_probability: 0.12,
  ppb_fu_fraction: 0.20,
  vd_l_per_kg: 1.8,
  hepatocyte_clint_ul_min_1e6_cells: 8,
  half_life_h: 12,
  cyp1a2_inhibitor_prob: 0.05, cyp2c9_inhibitor_prob: 0.10,
  cyp2c19_inhibitor_prob: 0.08, cyp2d6_inhibitor_prob: 0.12,
  cyp3a4_inhibitor_prob: 0.15,
  herg_blocker_prob: 0.12,
  ames_prob: 0.08,
  dili_prob: 0.10, dili_risk_class: "Low",
  clintox_prob: 0.05,
  carcinogen_prob: 0.06,
  skin_reaction_prob: 0.04,
  ld50_mg_per_kg: 3500,
  Kd_nM: null, logS: -2.5,
};

let failures = 0;
function check(cond: boolean, label: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}`);
    failures++;
  }
}

console.log("L1 sanity check — admet + inVitroSim under MlOverlay\n");

for (const fx of fixtures) {
  console.log(`\n[${fx.name}]`);
  // Heuristic-only path
  const heur = runAdmetSimulation(fx.props, fx.smiles, fx.name, fx.uniprot, fx.ta);
  const heurIv = runInVitroSimulation(fx.props, fx.smiles, fx.uniprot, fx.ta);
  console.log(`  heuristic: GO/NoGo=${heur.goNogo}  binding=${heur.binding ? "set" : "null"}  ic50_nM=${heurIv.doseResponse.ic50_nM}  mlEnhanced=${heur.mlEnhanced}`);
  if (fx.expect.bindingNullable === true) {
    check(heur.binding === null, "heuristic: binding is null for off-catalog target (no fabrication)");
  }
  if (fx.expect.doseResponseNullable === true) {
    check(heurIv.doseResponse.ic50_nM === null, "heuristic: IC50 is null when no validated target (RF#7)");
  }
  check(heur.mlEnhanced === false, "heuristic: mlEnhanced=false");

  // Determinism — call twice, expect identical outputs
  const heur2 = runAdmetSimulation(fx.props, fx.smiles, fx.name, fx.uniprot, fx.ta);
  check(heur.admet.overall === heur2.admet.overall, "determinism: same SMILES → same admet.overall");
  check(heur.confidence === heur2.confidence, "determinism: same SMILES → same confidence");

  // ML overlay path
  const ml = runAdmetSimulation(fx.props, fx.smiles, fx.name, fx.uniprot, fx.ta, null, cleanOverlay);
  const mlIv = runInVitroSimulation(fx.props, fx.smiles, fx.uniprot, fx.ta, false, null, null, cleanOverlay);
  console.log(`  ML overlay (clean): GO/NoGo=${ml.goNogo}  binding=${ml.binding ? "set" : "null"}  ic50_nM=${mlIv.doseResponse.ic50_nM}  mlEnhanced=${ml.mlEnhanced}`);
  check(ml.mlEnhanced === true, "ML overlay: mlEnhanced=true when ANY ML signal present");
  check(ml.provenance?.absorption === "ml", "ML overlay: absorption provenance=ml");
  check(ml.provenance?.toxicity === "ml", "ML overlay: toxicity provenance=ml");
  check(mlIv.provenance?.caco2Papp === "ml", "ML overlay: caco2Papp provenance=ml");
  check(mlIv.provenance?.cypInhibition === "ml", "ML overlay: CYP panel provenance=ml");

  // Toxic overlay path — expect escalation
  const tox = runAdmetSimulation(fx.props, fx.smiles, fx.name, fx.uniprot, fx.ta, null, toxicOverlay);
  console.log(`  ML overlay (toxic): GO/NoGo=${tox.goNogo}  highAlerts=${tox.toxAlerts.filter(a => a.severity === "High").length}`);
  check(tox.goNogo === "NO-GO" || tox.goNogo === "WATCH", "toxic overlay: GO/NoGo escalates beyond GO when DILI/hERG/AMES all high");
  check(tox.toxAlerts.some(a => a.severity === "High"), "toxic overlay: at least one High-severity tox alert");
  // hERG flag should fire (CardioTox prob 0.85)
  check(tox.toxAlerts.some(a => a.category === "hERG"), "toxic overlay: hERG alert raised");
  // AMES alert should fire (prob 0.78)
  check(tox.toxAlerts.some(a => a.category === "Ames"), "toxic overlay: Ames alert raised");
}

console.log("\n" + "=".repeat(60));
console.log(failures === 0 ? "PASS — all sanity checks succeeded" : `FAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
