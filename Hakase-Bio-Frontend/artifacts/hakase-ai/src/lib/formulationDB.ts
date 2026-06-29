// ── Formulation & BCS Database ─────────────────────────────────────────────
// BCS Classification (FDA 2017 guidance) + formulation bioavailability modifiers
// FDA Inactive Ingredient Database (IIG) curated excipient subset
// https://www.accessdata.fda.gov/scripts/cder/iig/

export type BCSClass = "I" | "II" | "III" | "IV";

export interface BCSResult {
  class:       BCSClass;
  label:       string;
  solubility:  "High" | "Low";
  permeability:"High" | "Low";
  logS:        number;         // Estimated log aqueous solubility (mol/L) — ESOL model
  challenge:   string;
  strategy:    string;
}

export type FormulationType =
  | "plain"
  | "lipid"
  | "amorphous"
  | "nanoparticle"
  | "cyclodextrin"
  | "enteric";

export interface FormulationDef {
  id:          FormulationType;
  label:       string;
  description: string;
  keyExcipients: string[];      // From FDA IIG curated subset
  // Per-BCS-class absorption multipliers (relative to plain tablet baseline)
  multiplier:  Record<BCSClass, number>;
  fAbsMax:     number;          // Hard cap on oral F% after formulation
  bestFor:     BCSClass[];
  note:        string;
}

export interface FormulationResult {
  bcs:          BCSResult;
  formulation:  FormulationDef;
  baseF:        number;         // Bioavailability before formulation (0–1)
  formulatedF:  number;         // After formulation modifier applied (0–1)
  enhancement:  number;         // Fold-improvement
  impactLabel:  string;         // e.g. "High (2.4× F% improvement)"
}

// ── ESOL logS model (Delaney 2004, recalibrated) ────────────────────────────
// logS (mol/L) = 0.16 − 0.638·clogP − 0.0062·MW + 0.066·nAr − 0.74·frot
function esol(logP: number, mw: number, numAromaticRings: number, rotBonds: number): number {
  return 0.16 - 0.638 * logP - 0.0062 * mw + 0.066 * numAromaticRings - 0.74 * (rotBonds / 10);
}

// ── Permeability prediction from LogP + TPSA ─────────────────────────────────
// High permeability: clogP > 1 AND TPSA < 120 Å² AND MW < 500
function isHighPermeability(logP: number, tpsa: number, mw: number, hbd: number): boolean {
  return logP > 1 && tpsa < 120 && mw < 500 && hbd <= 5;
}

// ── BCS Classifier ───────────────────────────────────────────────────────────
// Dose number threshold: Dn < 1 for high solubility (FDA: dose ≤ 250 mg in 250 mL at pH 1–7.5)
// We use logS > −4 (log mol/L) as the practical solubility threshold (250 μg/mL for MW~250)
export function classifyBCS(
  logP: number,
  tpsa: number,
  mw: number,
  hbd: number,
  numAromaticRings: number,
  rotBonds: number,
): BCSResult {
  const logS = esol(logP, mw, numAromaticRings, rotBonds);
  // Adjust solubility threshold by MW (FDA dose-based number)
  const solubilityThreshold = -4 + Math.log10(250 / Math.max(mw, 100));
  const highSol  = logS > solubilityThreshold;
  const highPerm = isHighPermeability(logP, tpsa, mw, hbd);

  let cls: BCSClass;
  let label: string;
  let challenge: string;
  let strategy: string;

  if (highSol && highPerm) {
    cls = "I";
    label = "Class I — High Solubility / High Permeability";
    challenge = "Formulation-independent absorption; plain tablet appropriate";
    strategy = "Immediate-release tablet or hard gelatin capsule";
  } else if (!highSol && highPerm) {
    cls = "II";
    label = "Class II — Low Solubility / High Permeability";
    challenge = "Dissolution-rate limited; formulation is the key driver of bioavailability";
    strategy = "Lipid-based LBDDS/SMEDDS, amorphous solid dispersion, or nanosuspension recommended";
  } else if (highSol && !highPerm) {
    cls = "III";
    label = "Class III — High Solubility / Low Permeability";
    challenge = "Permeability-limited; rapid dissolution but poor membrane crossing";
    strategy = "Permeation enhancers, prodrug strategy, or modified release";
  } else {
    cls = "IV";
    label = "Class IV — Low Solubility / Low Permeability";
    challenge = "Both solubility and permeability limited — challenging candidate";
    strategy = "SMEDDS, lipid nanoparticles, or formulation combination strategy";
  }

  return {
    class: cls,
    label,
    solubility:   highSol  ? "High" : "Low",
    permeability: highPerm ? "High" : "Low",
    logS,
    challenge,
    strategy,
  };
}

// ── FDA IIG Excipient Curated Subset ─────────────────────────────────────────
// Source: FDA Inactive Ingredient Database (public domain)
// https://www.accessdata.fda.gov/scripts/cder/iig/
export const FDA_IIG_EXCIPIENTS: Array<{
  name: string; category: string; maxDoseMg: number; route: string; mechanism: string;
}> = [
  { name: "Cremophor EL (PEG-35 castor oil)", category: "Surfactant",   maxDoseMg: 3000, route: "Oral", mechanism: "Micellar solubilization — increases apparent solubility 10–50×" },
  { name: "Labrasol (PEG-8 caprylic/capric glycerides)", category: "Lipid",  maxDoseMg: 2000, route: "Oral", mechanism: "Self-emulsifying; forms fine emulsion in GI fluid" },
  { name: "PEG 400 (Polyethylene glycol 400)",    category: "Co-solvent", maxDoseMg: 6000, route: "Oral", mechanism: "Co-solvent — reduces crystallization tendency" },
  { name: "HPMC-AS (Hypromellose acetate succinate)", category: "Polymer", maxDoseMg: 500, route: "Oral", mechanism: "Amorphous dispersion carrier; inhibits recrystallization" },
  { name: "PVP-VA (Povidone-vinyl acetate 64)",   category: "Polymer",    maxDoseMg: 400, route: "Oral", mechanism: "Amorphous matrix; maintains supersaturation in GI" },
  { name: "Soluplus (PEG-PCL-PVAc graft polymer)", category: "Polymer",  maxDoseMg: 600, route: "Oral", mechanism: "Solid dispersion carrier + micellar solubilizer" },
  { name: "Polysorbate 80 (Tween 80)",            category: "Surfactant", maxDoseMg: 450, route: "Oral", mechanism: "Nonionic surfactant; stabilizes nanosuspensions" },
  { name: "HPMC E5 (Hypromellose 5cP)",           category: "Polymer",    maxDoseMg: 1500, route: "Oral", mechanism: "Nanosuspension stabilizer; anti-aggregation" },
  { name: "SLS (Sodium lauryl sulfate)",          category: "Surfactant", maxDoseMg: 30,  route: "Oral", mechanism: "Ionic surfactant; wetting agent for BCS II" },
  { name: "HP-β-CD (Hydroxypropyl-beta-cyclodextrin)", category: "Cyclodextrin", maxDoseMg: 8000, route: "Oral", mechanism: "Inclusion complex; solubility increase 2–20× for hydrophobics" },
  { name: "SBE-β-CD (Sulfobutylether-beta-cyclodextrin)", category: "Cyclodextrin", maxDoseMg: 10000, route: "IV", mechanism: "Inclusion complex; clinical IV use (Captisol)" },
  { name: "Eudragit L100-55 (methacrylic acid copolymer)", category: "Enteric polymer", maxDoseMg: 300, route: "Oral", mechanism: "pH-triggered dissolution above pH 5.5 — protects acid-labile compounds" },
  { name: "HPMCP (Hydroxypropyl methylcellulose phthalate)", category: "Enteric polymer", maxDoseMg: 400, route: "Oral", mechanism: "Enteric coating; dissolves at pH ≥ 6.0" },
  { name: "Labrafac Lipophile WL 1349 (caprylic/capric triglycerides)", category: "Lipid", maxDoseMg: 3000, route: "Oral", mechanism: "Lipid vehicle component; oil phase for LBDDS" },
  { name: "Lutrol F68 (Poloxamer 188)",           category: "Surfactant", maxDoseMg: 2000, route: "Oral", mechanism: "Block copolymer; nanoparticle stabilization" },
  { name: "Glyceryl monooleate (GMO)",            category: "Lipid",      maxDoseMg: 1500, route: "Oral", mechanism: "Liquid crystal mesophase formation; sustained solubilization" },
  { name: "D-α-Tocopherol PEG 1000 succinate (TPGS)", category: "Surfactant", maxDoseMg: 1000, route: "Oral", mechanism: "P-gp inhibitor + solubilizer; increases intestinal permeation" },
  { name: "Capmul MCM (glyceryl caprylate)",      category: "Lipid",      maxDoseMg: 2000, route: "Oral", mechanism: "Lipid vehicle; SEDDS component" },
  { name: "Aerosil 200 (colloidal silica)",       category: "Carrier",    maxDoseMg: 500,  route: "Oral", mechanism: "Porous silica carrier for lipid-loaded solid dispersions" },
  { name: "MCC PH102 (microcrystalline cellulose)", category: "Filler",   maxDoseMg: 5000, route: "Oral", mechanism: "Compressible filler; standard tablet component" },
  { name: "Lactose monohydrate",                  category: "Filler",     maxDoseMg: 5000, route: "Oral", mechanism: "Soluble filler; rapid disintegration" },
  { name: "Mannitol",                             category: "Filler",     maxDoseMg: 5000, route: "Oral", mechanism: "Soluble filler; cooling mouthfeel; low hygroscopicity" },
  { name: "Croscarmellose sodium",                category: "Disintegrant",maxDoseMg: 400,  route: "Oral", mechanism: "Super-disintegrant; rapid water uptake and swelling" },
  { name: "Magnesium stearate",                   category: "Lubricant",  maxDoseMg: 30,   route: "Oral", mechanism: "Hydrophobic lubricant — avoid overuse with BCS II" },
];

// ── Formulation Library ───────────────────────────────────────────────────────
export const FORMULATION_LIBRARY: Record<FormulationType, FormulationDef> = {
  plain: {
    id: "plain",
    label: "Plain Tablet / Capsule",
    description: "Immediate-release tablet or hard gelatin capsule with standard excipients.",
    keyExcipients: ["MCC PH102 (microcrystalline cellulose)", "Lactose monohydrate", "Croscarmellose sodium", "Magnesium stearate"],
    multiplier: { "I": 1.0, "II": 1.0, "III": 1.0, "IV": 1.0 },
    fAbsMax: 0.95,
    bestFor: ["I", "III"],
    note: "Reference formulation. Appropriate for BCS I. BCS II/IV compounds will show reduced and variable bioavailability.",
  },
  lipid: {
    id: "lipid",
    label: "Lipid-Based LBDDS / SMEDDS",
    description: "Self-micro-emulsifying drug delivery system. Forms fine oil-in-water emulsion spontaneously in GI fluid.",
    keyExcipients: ["Labrasol (PEG-8 caprylic/capric glycerides)", "Labrafac Lipophile WL 1349 (caprylic/capric triglycerides)", "Cremophor EL (PEG-35 castor oil)", "Capmul MCM (glyceryl caprylate)"],
    multiplier: { "I": 1.1, "II": 3.2, "III": 1.4, "IV": 2.4 },
    fAbsMax: 0.90,
    bestFor: ["II", "IV"],
    note: "Evidence base: cyclosporine (Neoral), ritonavir (Norvir), saquinavir (Fortovase). 2–5× F% improvement typical for BCS II.",
  },
  amorphous: {
    id: "amorphous",
    label: "Amorphous Solid Dispersion (ASD)",
    description: "Hot-melt extrusion or spray-drying to create an amorphous polymer matrix. Maintains supersaturation in GI.",
    keyExcipients: ["HPMC-AS (Hypromellose acetate succinate)", "PVP-VA (Povidone-vinyl acetate 64)", "Soluplus (PEG-PCL-PVAc graft polymer)", "Aerosil 200 (colloidal silica)"],
    multiplier: { "I": 1.05, "II": 2.8, "III": 1.2, "IV": 2.0 },
    fAbsMax: 0.85,
    bestFor: ["II"],
    note: "Evidence base: itraconazole (Sporanox pellets), posaconazole (Noxafil), venetoclax (Venclexta). 2–4× improvement for BCS II common.",
  },
  nanoparticle: {
    id: "nanoparticle",
    label: "Nanosuspension / Nanoparticle",
    description: "Top-down milling or nanoprecipitation to particle size < 500 nm. Dramatically increases surface area.",
    keyExcipients: ["Polysorbate 80 (Tween 80)", "HPMC E5 (Hypromellose 5cP)", "Lutrol F68 (Poloxamer 188)", "D-α-Tocopherol PEG 1000 succinate (TPGS)"],
    multiplier: { "I": 1.05, "II": 2.2, "III": 1.1, "IV": 1.7 },
    fAbsMax: 0.85,
    bestFor: ["II"],
    note: "Evidence base: aprepitant (Emend), sirolimus (Rapamune), fenofibrate (Tricor). 1.5–3× improvement depending on compound.",
  },
  cyclodextrin: {
    id: "cyclodextrin",
    label: "Cyclodextrin Inclusion Complex",
    description: "Host-guest inclusion complex with HP-β-CD or SBE-β-CD. Increases apparent solubility without changing intrinsic properties.",
    keyExcipients: ["HP-β-CD (Hydroxypropyl-beta-cyclodextrin)", "SBE-β-CD (Sulfobutylether-beta-cyclodextrin, Captisol)"],
    multiplier: { "I": 1.1, "II": 1.9, "III": 1.3, "IV": 1.5 },
    fAbsMax: 0.80,
    bestFor: ["II", "IV"],
    note: "Evidence base: itraconazole oral solution (Sporanox), voriconazole IV, mitomycin. Limited by cavity size (MW < ~600 Da ideal).",
  },
  enteric: {
    id: "enteric",
    label: "Enteric-Coated / pH-Modified",
    description: "Enteric polymer coating. Delays release until duodenum/jejunum (pH 5.5–6.8). Protects acid-labile compounds.",
    keyExcipients: ["Eudragit L100-55 (methacrylic acid copolymer)", "HPMCP (Hydroxypropyl methylcellulose phthalate)", "MCC PH102 (microcrystalline cellulose)", "Lactose monohydrate"],
    multiplier: { "I": 1.0, "II": 1.3, "III": 1.1, "IV": 1.2 },
    fAbsMax: 0.90,
    bestFor: ["I", "III"],
    note: "Best for acid-labile compounds or drugs with gastric side effects. BCS II improvement modest unless dissolution occurs at intestinal pH. Examples: omeprazole, aspirin EC.",
  },
};

export const FORMULATION_LIST = Object.values(FORMULATION_LIBRARY);

// ── Main computation ──────────────────────────────────────────────────────────
export function computeFormulationImpact(
  logP: number,
  tpsa: number,
  mw: number,
  hbd: number,
  numAromaticRings: number,
  rotBonds: number,
  baseF: number,             // 0–1, physicochemical-only estimate
  formulationType: FormulationType,
): FormulationResult {
  const bcs         = classifyBCS(logP, tpsa, mw, hbd, numAromaticRings, rotBonds);
  const formulation = FORMULATION_LIBRARY[formulationType];
  const multiplier  = formulation.multiplier[bcs.class];
  const rawF        = Math.min(baseF * multiplier, formulation.fAbsMax);
  const formulatedF = Math.min(rawF, 0.99);
  const enhancement = formulatedF / Math.max(baseF, 0.01);

  const impactLabel =
    enhancement >= 3.0 ? `Very High (${enhancement.toFixed(1)}× improvement)` :
    enhancement >= 2.0 ? `High (${enhancement.toFixed(1)}× improvement)` :
    enhancement >= 1.3 ? `Moderate (${enhancement.toFixed(1)}× improvement)` :
    enhancement >= 1.05 ? `Low (${enhancement.toFixed(1)}× improvement)` :
    "None (plain appropriate)";

  return { bcs, formulation, baseF, formulatedF, enhancement, impactLabel };
}
