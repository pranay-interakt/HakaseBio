import type { MolecularProperties } from "./chemistry";

export interface AdmetScores {
  absorption:   number;
  distribution: number;
  metabolism:   number;
  excretion:    number;
  toxicity:     number;
  overall:      number;
}

export interface ToxicityAlert {
  name:     string;
  category: "hERG" | "Hepatotox" | "Genotox" | "CNS" | "Reactive" | "Ames" | "DILI";
  severity: "Low" | "Medium" | "High";
  detail:   string;
}

export interface OrganRisk {
  name:   string;
  risk:   number;
  color:  "emerald" | "yellow" | "red";
  alerts: string[];
}

export interface BindingEstimate {
  primaryKd:    number;
  primaryKi:    number;
  primaryIC50:  number;
  selectivity:  number;
  targetName:   string;
  targetClass:  string;
  offTargets: Array<{ name: string; kd: number; ki: number; ic50: number; selectivity: number }>;
}

export interface LipinskiAnalysis {
  mwPass:   boolean; mw:   number;
  logPPass: boolean; logP: number;
  hbdPass:  boolean; hbd:  number;
  hbaPass:  boolean; hba:  number;
  violations: number;
  leadLike: boolean;
  tpsa:     number;
  rotBonds: number;
}

export interface SimResults {
  admet:     AdmetScores;
  toxAlerts: ToxicityAlert[];
  organs:    OrganRisk[];
  binding:   BindingEstimate;
  lipinski:  LipinskiAnalysis;
  qed:       number;
  saScore:   number;
  goNogo:    "GO" | "WATCH" | "NO-GO";
  confidence: number;
  similarDrugs: string[];
  recommendation: string;
  molName:   string;
  smiles:    string;
  uniprotId: string;
  timestamp: string;
}

const TARGET_MAP: Record<string, { name: string; class: string; offTargets: string[]; potencyRange: [number, number] }> = {
  P00533: { name: "EGFR",  class: "Tyrosine Kinase",      offTargets: ["HER2 (P04626)", "HER3 (P21860)"],               potencyRange: [1,  200]  },
  P04626: { name: "HER2",  class: "Tyrosine Kinase",      offTargets: ["EGFR (P00533)", "HER3 (P21860)"],               potencyRange: [5,  500]  },
  P01116: { name: "KRAS",  class: "GTPase",               offTargets: ["NRAS (P01111)", "HRAS (P01112)"],               potencyRange: [50, 5000] },
  P11802: { name: "CDK4",  class: "Ser/Thr Kinase",       offTargets: ["CDK6 (Q00534)", "CDK2 (P24941)"],               potencyRange: [1,  100]  },
  Q00534: { name: "CDK6",  class: "Ser/Thr Kinase",       offTargets: ["CDK4 (P11802)", "CDK2 (P24941)"],               potencyRange: [2,  200]  },
  Q06187: { name: "BTK",   class: "Tyrosine Kinase",      offTargets: ["ITK (Q08881)",  "TEC (P42680)"],                potencyRange: [1,  150]  },
  P00519: { name: "ABL1",  class: "Tyrosine Kinase",      offTargets: ["SRC (P12931)", "KIT (P10721)"],                 potencyRange: [1,  100]  },
  P15056: { name: "BRAF",  class: "Ser/Thr Kinase",       offTargets: ["CRAF (P04049)", "MAP2K1 (Q02750)"],             potencyRange: [1,  300]  },
};

interface AdmetTherapeuticModifiers {
  absorptionBonus: number;
  metabolismPenalty: number;
  toxicitySensitivity: number;
  hergSensitivity: number;
  hepatoSensitivity: number;
  cnsSensitivity: number;
  renalSensitivity: number;
  similarDrugsOverride: string[];
}

const ADMET_TA_MODIFIERS: Record<string, AdmetTherapeuticModifiers> = {
  "Oncology": {
    absorptionBonus: 0.0, metabolismPenalty: 0.0, toxicitySensitivity: 0.85,
    hergSensitivity: 1.0, hepatoSensitivity: 1.3, cnsSensitivity: 0.7, renalSensitivity: 1.0,
    similarDrugsOverride: [],
  },
  "CNS": {
    absorptionBonus: 0.05, metabolismPenalty: -0.03, toxicitySensitivity: 1.1,
    hergSensitivity: 1.5, hepatoSensitivity: 0.8, cnsSensitivity: 2.0, renalSensitivity: 0.7,
    similarDrugsOverride: ["Donepezil", "Lecanemab", "Levodopa"],
  },
  "Cardiovascular": {
    absorptionBonus: 0.03, metabolismPenalty: 0.0, toxicitySensitivity: 1.2,
    hergSensitivity: 2.5, hepatoSensitivity: 1.0, cnsSensitivity: 0.5, renalSensitivity: 1.5,
    similarDrugsOverride: ["Atorvastatin", "Entresto", "Empagliflozin"],
  },
  "Metabolic": {
    absorptionBonus: 0.04, metabolismPenalty: 0.04, toxicitySensitivity: 1.0,
    hergSensitivity: 1.0, hepatoSensitivity: 1.8, cnsSensitivity: 0.5, renalSensitivity: 1.5,
    similarDrugsOverride: ["Semaglutide", "Tirzepatide", "Metformin"],
  },
  "Rare Disease": {
    absorptionBonus: 0.0, metabolismPenalty: 0.0, toxicitySensitivity: 0.9,
    hergSensitivity: 1.2, hepatoSensitivity: 1.2, cnsSensitivity: 1.0, renalSensitivity: 1.0,
    similarDrugsOverride: ["Nusinersen", "Lumacaftor", "Migalastat"],
  },
  "Infectious Disease": {
    absorptionBonus: 0.02, metabolismPenalty: 0.03, toxicitySensitivity: 1.0,
    hergSensitivity: 1.0, hepatoSensitivity: 1.5, cnsSensitivity: 0.5, renalSensitivity: 1.3,
    similarDrugsOverride: ["Nirmatrelvir", "Remdesivir", "Dolutegravir"],
  },
  "Immunology": {
    absorptionBonus: 0.03, metabolismPenalty: 0.02, toxicitySensitivity: 1.05,
    hergSensitivity: 1.0, hepatoSensitivity: 1.3, cnsSensitivity: 0.5, renalSensitivity: 1.0,
    similarDrugsOverride: ["Tofacitinib", "Upadacitinib", "Dupilumab"],
  },
};

function getAdmetModifiers(therapeuticArea: string): AdmetTherapeuticModifiers {
  return ADMET_TA_MODIFIERS[therapeuticArea] ?? ADMET_TA_MODIFIERS["Oncology"];
}

function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

function jitter(base: number, range: number, seed: number): number {
  const pseudo = Math.sin(seed * 9301 + 49297) * 233280;
  return clamp(base + (pseudo - Math.floor(pseudo) - 0.5) * range * 2);
}

function hashSmiles(smiles: string): number {
  let h = 0;
  for (let i = 0; i < smiles.length; i++) h = (h * 31 + smiles.charCodeAt(i)) >>> 0;
  return h;
}

export function runAdmetSimulation(
  molProps:     MolecularProperties,
  smiles:       string,
  molName:      string,
  uniprotId:    string,
  therapeuticArea: string = "Oncology",
): SimResults {
  const { mw, logP, hbd, hba, tpsa, rotBonds, qed } = molProps;
  const seed = hashSmiles(smiles);
  const taMod = getAdmetModifiers(therapeuticArea);

  // ── Absorption ─────────────────────────────────────────────────────────
  let abs = 0;
  if (tpsa < 60)        abs = jitter(0.88, 0.06, seed + 1);
  else if (tpsa < 90)   abs = jitter(0.78, 0.08, seed + 1);
  else if (tpsa < 120)  abs = jitter(0.60, 0.10, seed + 1);
  else                  abs = jitter(0.35, 0.12, seed + 1);
  if (logP < 0 || logP > 6)    abs -= 0.12;
  if (hbd > 5)                  abs -= 0.10;
  if (mw > 600)                 abs -= 0.08;
  if (molProps.lipinskiPass)    abs += 0.05;
  abs += taMod.absorptionBonus;
  abs = clamp(abs);

  // ── Distribution ───────────────────────────────────────────────────────
  let dist = jitter(0.65, 0.10, seed + 2);
  if (logP > 1 && logP < 4)    dist += 0.10;
  if (logP > 5)                 dist -= 0.08;
  if (mw > 500)                 dist -= 0.07;
  if (tpsa < 90 && mw < 450)   dist += 0.05;
  dist = clamp(dist);

  // ── Metabolism ──────────────────────────────────────────────────────────
  let met = jitter(0.72, 0.10, seed + 3);
  if (logP > 3)                 met -= 0.08;
  if (logP > 5)                 met -= 0.08;
  if (rotBonds > 8)             met -= 0.06;
  if (hbd < 2)                  met += 0.05;
  met -= taMod.metabolismPenalty;
  met = clamp(met);

  // ── Excretion ───────────────────────────────────────────────────────────
  let exc = jitter(0.70, 0.08, seed + 4);
  if (mw < 300)                 exc += 0.08;
  else if (mw > 500)            exc -= 0.10;
  if (logP > 4)                 exc -= 0.07;
  exc = clamp(exc);

  // ── Toxicity Safety Score (1 = very safe) ───────────────────────────────
  let tox = jitter(0.80, 0.08, seed + 5);

  const hergRisk    = logP > 4 && hbd < 2 && mw > 300;
  const hepatoRisk  = logP > 4.5 || mw > 550;
  const genoRisk    = false;
  const bbbPenetrant = tpsa < 90 && mw < 450;

  if (hergRisk)    tox -= 0.12 * taMod.hergSensitivity;
  if (hepatoRisk)  tox -= 0.08 * taMod.hepatoSensitivity;
  if (mw > 600)    tox -= 0.05;
  tox *= taMod.toxicitySensitivity;
  tox = clamp(tox);

  const overall = clamp((abs * 0.25 + dist * 0.20 + met * 0.20 + exc * 0.15 + tox * 0.20));

  // ── Toxicity Alerts ─────────────────────────────────────────────────────
  const toxAlerts: ToxicityAlert[] = [];
  if (hergRisk) {
    toxAlerts.push({
      name: "hERG Channel Inhibition", category: "hERG", severity: "Medium",
      detail: "logP > 4 with low HBD count suggests potential hERG blockade; QT monitoring recommended.",
    });
  }
  if (hepatoRisk) {
    toxAlerts.push({
      name: "Hepatotoxicity Risk", category: "Hepatotox", severity: logP > 5 ? "High" : "Low",
      detail: logP > 5
        ? "High logP may indicate DILI potential via CYP3A4 reactive metabolite formation."
        : "MW > 550 Da associated with elevated biliary excretion and hepatocyte accumulation.",
    });
  }
  if (bbbPenetrant) {
    toxAlerts.push({
      name: "BBB Penetrant", category: "CNS", severity: "Low",
      detail: "TPSA < 90 Å² and MW < 450 Da predict central nervous system penetration.",
    });
  }
  if (genoRisk) {
    toxAlerts.push({
      name: "Genotoxicity Alert", category: "Genotox", severity: "High",
      detail: "Structural motif consistent with DNA-intercalating agent.",
    });
  }

  // ── Organ Risks (weighted by therapeutic area sensitivity) ───────────────
  const liverBaseRisk = hepatoRisk ? jitter(0.22, 0.06, seed + 10) : jitter(0.07, 0.04, seed + 10);
  const heartBaseRisk = hergRisk ? jitter(0.18, 0.06, seed + 11) : jitter(0.10, 0.04, seed + 11);
  const kidneyBaseRisk = mw < 300 ? jitter(0.05, 0.03, seed + 12) : jitter(0.08, 0.04, seed + 12);
  const cnsBaseRisk = bbbPenetrant ? jitter(0.20, 0.06, seed + 13) : jitter(0.04, 0.03, seed + 13);
  const giBaseRisk = tpsa > 120 ? jitter(0.15, 0.05, seed + 14) : jitter(0.07, 0.03, seed + 14);

  const liverRisk = clamp(liverBaseRisk * taMod.hepatoSensitivity);
  const heartRisk = clamp(heartBaseRisk * taMod.hergSensitivity);
  const kidneyRisk = clamp(kidneyBaseRisk * taMod.renalSensitivity);
  const cnsRisk = clamp(cnsBaseRisk * taMod.cnsSensitivity);
  const giRisk = clamp(giBaseRisk);

  function organColor(risk: number): "emerald" | "yellow" | "red" {
    if (risk > 0.3) return "red";
    if (risk > 0.15) return "yellow";
    return "emerald";
  }

  const organs: OrganRisk[] = [
    {
      name: "Liver",
      risk: liverRisk,
      color: organColor(liverRisk),
      alerts: hepatoRisk ? ["CYP3A4 reactive metabolite risk"] : [],
    },
    {
      name: "Heart (hERG)",
      risk: heartRisk,
      color: organColor(heartRisk),
      alerts: hergRisk ? ["Minor QT prolongation risk"] : [],
    },
    {
      name: "Kidney",
      risk: kidneyRisk,
      color: organColor(kidneyRisk),
      alerts: kidneyRisk > 0.15 ? ["Elevated renal clearance burden"] : [],
    },
    {
      name: "CNS",
      risk: cnsRisk,
      color: organColor(cnsRisk),
      alerts: bbbPenetrant ? ["BBB penetrant", "CNS active class"] : [],
    },
    {
      name: "GI Tract",
      risk: giRisk,
      color: organColor(giRisk),
      alerts: tpsa > 120 ? ["Reduced oral absorption predicted"] : [],
    },
    {
      name: "Lung",
      risk: clamp(jitter(0.04, 0.03, seed + 15)),
      color: "emerald",
      alerts: [],
    },
  ];

  // ── Binding Affinity ────────────────────────────────────────────────────
  const targetInfo = TARGET_MAP[uniprotId] ?? {
    name: "Unknown Target", class: "Unknown", offTargets: [], potencyRange: [10, 1000] as [number, number],
  };

  const [pMin, pMax] = targetInfo.potencyRange;
  const drugLikenessFactor = molProps.lipinskiPass ? 0.4 : 0.7;
  const qedFactor = (1 - qed) * 0.3;
  const basePotency = pMin + (pMax - pMin) * (drugLikenessFactor + qedFactor);

  const primaryKd   = clamp(jitter(basePotency, basePotency * 0.3, seed + 20), 0.1, pMax * 2);
  const primaryKi   = clamp(primaryKd * jitter(0.85, 0.15, seed + 21), 0.1, pMax * 2);
  const primaryIC50 = clamp(primaryKd * jitter(1.20, 0.20, seed + 22), 0.1, pMax * 2);
  const selectivity = clamp(jitter(3.5, 1.5, seed + 23), 0.1, 10);

  const offTargets = targetInfo.offTargets.slice(0, 2).map((name, i) => ({
    name,
    kd:   clamp(primaryKd   * jitter(12, 6, seed + 30 + i), 0.1, 50000),
    ki:   clamp(primaryKi   * jitter(14, 6, seed + 31 + i), 0.1, 50000),
    ic50: clamp(primaryIC50 * jitter(13, 5, seed + 32 + i), 0.1, 50000),
    selectivity: clamp(jitter(0.05, 0.03, seed + 33 + i), 0.01, 0.5),
  }));

  // ── Lipinski ────────────────────────────────────────────────────────────
  const lipinski: LipinskiAnalysis = {
    mwPass:   mw <= 500,  mw,
    logPPass: logP <= 5,  logP,
    hbdPass:  hbd <= 5,   hbd,
    hbaPass:  hba <= 10,  hba,
    violations: [mw > 500, logP > 5, hbd > 5, hba > 10].filter(Boolean).length,
    leadLike: mw <= 350 && logP <= 3.5 && hbd <= 3 && hba <= 7,
    tpsa,
    rotBonds,
  };

  // ── SA Score (synthetic accessibility 1=easy, 10=hard) ─────────────────
  const saScore = parseFloat(clamp(
    jitter(2.0 + mw / 200 + (rotBonds > 6 ? 0.5 : 0) + (hba > 6 ? 0.3 : 0), 0.8, seed + 40),
    1, 10,
  ).toFixed(1));

  // ── Go/No-Go ─────────────────────────────────────────────────────────────
  const highAlerts  = toxAlerts.filter(a => a.severity === "High").length;
  const violations  = lipinski.violations;
  const overallGood = overall >= 0.65;

  let goNogo: "GO" | "WATCH" | "NO-GO";
  let recommendation: string;

  if (highAlerts > 0 || violations >= 3) {
    goNogo = "NO-GO";
    recommendation = `${highAlerts > 0 ? "Critical toxicity flags" : "Multiple Lipinski violations"} indicate high attrition risk. Consider structural optimisation before advancing.`;
  } else if (violations >= 2 || !overallGood || toxAlerts.length > 1) {
    goNogo = "WATCH";
    recommendation = "Borderline ADMET profile. Advance with close monitoring and consider analogues with improved ${violations > 0 ? 'drug-likeness' : 'safety margin'}.";
  } else {
    goNogo = "GO";
    recommendation = "Favourable ADMET profile across all dimensions. Recommend advancing to Patient Cohort Simulation.";
  }

  const confidence = parseFloat(clamp(
    overall * 0.6 + (1 - violations * 0.12) * 0.25 + (toxAlerts.length === 0 ? 0.15 : toxAlerts.length === 1 ? 0.10 : 0.05),
  ).toFixed(3));

  // ── Similar Drugs ────────────────────────────────────────────────────────
  const similarByTarget: Record<string, string[]> = {
    P00533: ["Erlotinib", "Gefitinib", "Osimertinib"],
    P04626: ["Trastuzumab", "Lapatinib", "Neratinib"],
    P01116: ["Sotorasib", "Adagrasib", "AMG-510"],
    P11802: ["Palbociclib", "Ribociclib", "Abemaciclib"],
    Q06187: ["Ibrutinib", "Zanubrutinib", "Acalabrutinib"],
    P00519: ["Imatinib", "Dasatinib", "Nilotinib"],
    P15056: ["Vemurafenib", "Dabrafenib", "Encorafenib"],
  };
  // Precedent drugs:
  //   1. Exact UniProt match → curated approved drugs for that target.
  //   2. Otherwise, fall back to the therapeutic-area override (curated, real
  //      approved drugs for the area).
  //   3. If neither matches (e.g. off-catalog UniProt + unknown TA), return an
  //      empty list. We deliberately do NOT emit a generic kinase-inhibitor
  //      fallback, because the consumer (RegulatoryInsightCard) cross-checks
  //      each name against openFDA — emitting a fabricated list would either
  //      surface fake "precedents" to the user or trigger false openFDA
  //      lookups against unrelated drugs. Empty here means the precedent panel
  //      should be hidden upstream.
  const targetDrugs  = similarByTarget[uniprotId];
  const similarDrugs = targetDrugs ?? (taMod.similarDrugsOverride.length > 0 ? taMod.similarDrugsOverride : []);

  return {
    admet: { absorption: abs, distribution: dist, metabolism: met, excretion: exc, toxicity: tox, overall },
    toxAlerts,
    organs,
    binding: { primaryKd, primaryKi, primaryIC50, selectivity, targetName: targetInfo.name, targetClass: targetInfo.class, offTargets },
    lipinski,
    qed,
    saScore,
    goNogo,
    confidence,
    similarDrugs,
    recommendation,
    molName,
    smiles,
    uniprotId,
    timestamp: new Date().toISOString(),
  };
}
