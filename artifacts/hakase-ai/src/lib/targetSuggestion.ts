import type { MolecularProperties } from "./chemistry";

export interface TargetSuggestion {
  uniprotId:   string;
  geneName:    string;
  fullName:    string;
  targetClass: string;
  confidence:  number;       // 0–1 after normalisation
  rationale:   string[];     // short bullet reasons
  area:        string;       // therapeutic area label
  color:       "violet" | "blue" | "emerald" | "amber" | "red" | "cyan";
}

// ── helpers ──────────────────────────────────────────────────────────────────

function inRange(v: number, lo: number, hi: number): boolean { return v >= lo && v <= hi; }
function smHas(smiles: string, sub: string): boolean { return smiles.includes(sub); }
// count occurrences of a plain substring
function smCount(smiles: string, sub: string): number {
  let n = 0, pos = 0;
  while ((pos = smiles.indexOf(sub, pos)) !== -1) { n++; pos += sub.length; }
  return n;
}
// aromatic nitrogen count (lower-case n)
function aromaticN(smiles: string): number { return (smiles.match(/n/g) ?? []).length; }
// aliphatic basic nitrogen count (upper-case N not bound to C=O)
function basicN(smiles: string): number {
  return (smiles.match(/N(?![H]?\(=O\)|=O)/g) ?? []).length;
}
// has Michael acceptor (C=CC=O or C=CS=O) – covalent warhead
function hasMichaelAcceptor(smiles: string): boolean {
  return /C=CC(=O)|C=CS(=O)/.test(smiles);
}
// has zinc-binding group (thiol, hydroxamic acid, carboxylic acid adjacent to sp3)
function hasZincBinder(smiles: string): boolean {
  return /C\(=O\)O|C\(=O\)\[OH\]|S$|SH/.test(smiles);
}
// sulfonamide / sulfone present
function hasSulfonyl(smiles: string): boolean { return smiles.includes("S(=O)(=O)"); }
// simple hinge-binder proxy: 2+ aromatic N in SMILES → heteroaromatic scaffold
function hasHingeBinder(smiles: string): boolean { return aromaticN(smiles) >= 2; }
// steroid-like: 4 fused rings, high logP
function steroidLike(p: MolecularProperties): boolean {
  return p.numRings >= 4 && p.logP > 3;
}
// BBB penetrant proxy
function bbbOK(p: MolecularProperties): boolean {
  return p.tpsa < 90 && p.mw < 450 && p.logP > 0.5;
}
// peptidomimetic: many rotatable bonds + many HBA
function peptidomimetic(p: MolecularProperties): boolean {
  return p.rotBonds >= 6 && p.hba >= 6;
}

// ── target catalogue ─────────────────────────────────────────────────────────
// Each target has:
//  - metadata
//  - score(smiles, props): raw 0–10 raw score
//  - rationale(smiles, props): string[] of why it was suggested

interface TargetEntry {
  uniprotId:   string;
  geneName:    string;
  fullName:    string;
  targetClass: string;
  area:        string;
  color:       TargetSuggestion["color"];
  score:       (s: string, p: MolecularProperties) => number;
  rationale:   (s: string, p: MolecularProperties) => string[];
}

const CATALOGUE: TargetEntry[] = [
  // ── Kinases ────────────────────────────────────────────────────────────────
  {
    uniprotId: "P00533", geneName: "EGFR", fullName: "Epidermal Growth Factor Receptor",
    targetClass: "Tyrosine Kinase", area: "Oncology", color: "violet",
    score(s, p) {
      let sc = 0;
      if (inRange(p.mw, 300, 560))       sc += 2;
      if (inRange(p.logP, 0.5, 5))       sc += 1.5;
      if (inRange(p.hbd, 1, 4))          sc += 1;
      if (p.numAromaticRings >= 2)       sc += 1.5;
      if (hasHingeBinder(s))             sc += 2;
      if (smHas(s, "c1ccnc") || smHas(s, "n1cc") || smHas(s, "c1ncc")) sc += 1.5;
      if (smHas(s, "Nc1") || smHas(s, "Nc2")) sc += 1;
      if (smHas(s, "F") || smHas(s, "Cl"))    sc += 0.5;
      if (hasMichaelAcceptor(s))         sc += 1;    // covalent EGFR inhibitors
      return sc;
    },
    rationale(s, p) {
      const r: string[] = [];
      if (inRange(p.mw, 300, 560)) r.push(`MW ${p.mw.toFixed(0)} Da fits typical EGFR inhibitor space (300–560 Da)`);
      if (p.numAromaticRings >= 2)  r.push(`${p.numAromaticRings} aromatic rings — consistent with anilinoquinazoline/pyrrolopyrimidine scaffold`);
      if (hasHingeBinder(s))        r.push("Aromatic N atoms suggest hinge-binding pharmacophore (N–H donor / acceptor pair)");
      if (hasMichaelAcceptor(s))    r.push("Electrophilic warhead detected — may covalently engage EGFR Cys797");
      return r;
    },
  },
  {
    uniprotId: "P11802", geneName: "CDK4", fullName: "Cyclin-Dependent Kinase 4",
    targetClass: "Serine/Threonine Kinase", area: "Oncology", color: "violet",
    score(s, p) {
      let sc = 0;
      if (inRange(p.mw, 380, 600))      sc += 2;
      if (inRange(p.logP, 1.5, 5))      sc += 1.5;
      if (inRange(p.hbd, 2, 5))         sc += 1.5;
      if (p.numAromaticRings >= 3)      sc += 1.5;
      if (hasHingeBinder(s))            sc += 2;
      if (smHas(s, "c1cncc") || smHas(s, "n1cnc") || smHas(s, "c2ncnc")) sc += 1.5;
      if (smHas(s, "N") && smHas(s, "=O")) sc += 0.5;
      return sc;
    },
    rationale(s, p) {
      const r: string[] = [];
      if (inRange(p.mw, 380, 600)) r.push(`MW ${p.mw.toFixed(0)} Da aligns with CDK4/6 inhibitor MW range (palbociclib 448, ribociclib 434)`);
      if (p.numAromaticRings >= 3)  r.push(`${p.numAromaticRings} fused aromatic rings — consistent with CDK4 pyrido/pyrimidine scaffolds`);
      if (inRange(p.hbd, 2, 5))     r.push(`HBD count (${p.hbd}) enables hinge and DFG-loop hydrogen bonding`);
      if (hasHingeBinder(s))        r.push("Heteroaromatic N signature matches CDK4 Glu99/His100 hinge contacts");
      return r;
    },
  },
  {
    uniprotId: "Q06187", geneName: "BTK", fullName: "Tyrosine-Protein Kinase BTK",
    targetClass: "Tyrosine Kinase", area: "Hematology / Autoimmune", color: "violet",
    score(s, p) {
      let sc = 0;
      if (inRange(p.mw, 380, 560))      sc += 2;
      if (inRange(p.logP, 1, 4.5))      sc += 1;
      if (hasHingeBinder(s))            sc += 2;
      if (hasMichaelAcceptor(s))        sc += 2.5;   // ibrutinib warhead
      if (smHas(s, "C=C") || smHas(s, "C=CC")) sc += 1.5;
      if (p.numAromaticRings >= 2)      sc += 1.5;
      return sc;
    },
    rationale(s, p) {
      const r: string[] = [];
      if (hasMichaelAcceptor(s)) r.push("Acrylamide / Michael acceptor warhead — hallmark of covalent BTK inhibitors (ibrutinib, acalabrutinib)");
      if (hasHingeBinder(s))     r.push("Heteroaromatic hinge-binding motif matches BTK Glu475/Met477 contacts");
      if (inRange(p.mw, 380, 560)) r.push(`MW ${p.mw.toFixed(0)} Da consistent with approved BTK inhibitors`);
      return r;
    },
  },
  {
    uniprotId: "O15111", geneName: "CHUK", fullName: "Inhibitor of Nuclear Factor κB Kinase α (IKKα)",
    targetClass: "Serine/Threonine Kinase", area: "Inflammation / Oncology", color: "violet",
    score(s, p) {
      let sc = 0;
      if (inRange(p.mw, 350, 550)) sc += 1.5;
      if (inRange(p.logP, 1, 4))   sc += 1;
      if (hasHingeBinder(s))       sc += 1.5;
      if (smHas(s, "S(=O)(=O)N") || smHas(s, "NS(=O)")) sc += 2;
      if (p.numAromaticRings >= 2) sc += 1;
      return sc;
    },
    rationale(s, p) {
      const r: string[] = [];
      if (hasSulfonyl(s)) r.push("Sulfonamide/sulfone group — commonly found in IKK inhibitors for NF-κB pathway targeting");
      if (hasHingeBinder(s)) r.push("Heteroaromatic hinge pharmacophore aligns with ATP-binding pocket of IKKα");
      return r;
    },
  },
  {
    uniprotId: "P35968", geneName: "KDR", fullName: "Vascular Endothelial Growth Factor Receptor 2",
    targetClass: "Tyrosine Kinase (RTK)", area: "Oncology / Angiogenesis", color: "emerald",
    score(s, p) {
      let sc = 0;
      if (inRange(p.mw, 380, 620))      sc += 1.5;
      if (inRange(p.logP, 1, 5))        sc += 1;
      if (inRange(p.hbd, 2, 5))         sc += 1.5;
      if (p.numAromaticRings >= 3)      sc += 1;
      if (hasHingeBinder(s))            sc += 2;
      if (smHas(s, "C(=O)Nc") || smHas(s, "NC(=O)c")) sc += 1.5;  // DFG-out amide
      if (smHas(s, "CF3") || smHas(s, "C(F)(F)F"))     sc += 1;
      return sc;
    },
    rationale(s, p) {
      const r: string[] = [];
      if (smHas(s, "C(=O)Nc") || smHas(s, "NC(=O)c")) r.push("Urea/amide linker — characteristic of Type II VEGFR2 inhibitors occupying DFG-out pocket (sorafenib, regorafenib)");
      if (p.numAromaticRings >= 3) r.push(`${p.numAromaticRings} rings consistent with biaryl-urea VEGFR2 chemotype`);
      if (inRange(p.mw, 380, 620)) r.push(`MW ${p.mw.toFixed(0)} Da spans approved VEGFR2 inhibitors (sorafenib 464, axitinib 386)`);
      return r;
    },
  },
  // ── GPCRs ──────────────────────────────────────────────────────────────────
  {
    uniprotId: "P14416", geneName: "DRD2", fullName: "Dopamine Receptor D2",
    targetClass: "Class A GPCR", area: "CNS / Psychiatry", color: "blue",
    score(s, p) {
      let sc = 0;
      if (inRange(p.mw, 200, 430))    sc += 2;
      if (inRange(p.logP, 1.5, 5))    sc += 1.5;
      if (bbbOK(p))                   sc += 2;
      if (basicN(s) >= 1)             sc += 2;
      if (smHas(s, "N1CC") || smHas(s, "N1CCC") || smHas(s, "N(CC")) sc += 1.5; // piperazine/piperidine
      if (p.numAromaticRings >= 1)    sc += 0.5;
      if (!hasSulfonyl(s) && !hasZincBinder(s)) sc += 0.5;
      return sc;
    },
    rationale(s, p) {
      const r: string[] = [];
      if (bbbOK(p))        r.push(`CNS-penetrant profile: TPSA ${p.tpsa.toFixed(0)} Å² < 90, MW ${p.mw.toFixed(0)} Da < 450 → BBB permeability predicted`);
      if (basicN(s) >= 1)  r.push("Basic nitrogen aligns with Asp114 salt bridge in DRD2 orthosteric binding pocket");
      if (inRange(p.mw, 200, 430)) r.push("MW and LogP in typical antipsychotic/dopaminergic ligand space");
      return r;
    },
  },
  {
    uniprotId: "P28223", geneName: "HTR2A", fullName: "5-Hydroxytryptamine Receptor 2A",
    targetClass: "Class A GPCR", area: "CNS / Psychiatry", color: "blue",
    score(s, p) {
      let sc = 0;
      if (inRange(p.mw, 250, 420))    sc += 1.5;
      if (inRange(p.logP, 1, 4.5))    sc += 1.5;
      if (bbbOK(p))                   sc += 1.5;
      if (basicN(s) >= 1)             sc += 2;
      if (smHas(s, "c1ccc") && p.numAromaticRings >= 2) sc += 1; // indole/phenyl
      if (smHas(s, "c1[nH]c2") || smHas(s, "[nH]1ccc2")) sc += 2; // indole scaffold
      return sc;
    },
    rationale(s, p) {
      const r: string[] = [];
      if (smHas(s, "c1[nH]c2") || smHas(s, "[nH]1ccc2")) r.push("Indole or indole-like scaffold — serotonergic pharmacophore core (tryptamine mimicry)");
      if (bbbOK(p)) r.push(`CNS-suitable: TPSA ${p.tpsa.toFixed(0)} Å², MW ${p.mw.toFixed(0)} Da`);
      if (basicN(s) >= 1) r.push("Basic amine provides Asp155 salt bridge required for 5-HT2A binding");
      return r;
    },
  },
  // ── Proteases ──────────────────────────────────────────────────────────────
  {
    uniprotId: "P12821", geneName: "ACE", fullName: "Angiotensin-Converting Enzyme",
    targetClass: "Zinc Metalloprotease", area: "Cardiovascular", color: "red",
    score(s, p) {
      let sc = 0;
      if (inRange(p.mw, 280, 560))    sc += 1.5;
      if (hasZincBinder(s))           sc += 3;
      if (peptidomimetic(p))          sc += 2;
      if (inRange(p.hbd, 2, 6))       sc += 1.5;
      if (smHas(s, "C(=O)O") || smHas(s, "C(O)=O")) sc += 2; // carboxylic acid
      if (smHas(s, "S(=O)") && smHas(s, "N"))        sc += 1; // captopril-like SH proxy
      return sc;
    },
    rationale(s, p) {
      const r: string[] = [];
      if (hasZincBinder(s)) r.push("Zinc-binding group (carboxylate/thiol/hydroxamate) — essential for ACE/metalloprotease inhibition (enalapril, lisinopril)");
      if (peptidomimetic(p)) r.push(`Peptidomimetic signature (${p.rotBonds} rotatable bonds, ${p.hba} HBA) — matches ACE tripeptide binding groove`);
      if (inRange(p.mw, 280, 560)) r.push(`MW ${p.mw.toFixed(0)} Da within approved ACEi range`);
      return r;
    },
  },
  {
    uniprotId: "P35354", geneName: "PTGS2", fullName: "Prostaglandin G/H Synthase 2 (COX-2)",
    targetClass: "Cyclooxygenase", area: "Inflammation / Pain", color: "amber",
    score(s, p) {
      let sc = 0;
      if (inRange(p.mw, 280, 500))    sc += 1.5;
      if (inRange(p.logP, 2, 5))      sc += 1;
      if (hasSulfonyl(s))             sc += 3;       // sulfonamide → COX-2 selectivity
      if (smHas(s, "C(=O)O") || smHas(s, "OC(=O)")) sc += 1.5; // carboxylate (naproxen)
      if (smHas(s, "c1ccc") && p.numAromaticRings >= 2) sc += 1;
      if (smHas(s, "CF3") || smHas(s, "C(F)(F)F"))  sc += 1;   // celecoxib-like
      return sc;
    },
    rationale(s, p) {
      const r: string[] = [];
      if (hasSulfonyl(s)) r.push("Sulfonamide group — hallmark of selective COX-2 inhibitors (celecoxib, rofecoxib) fitting the Val523 side pocket");
      if (smHas(s, "C(=O)O")) r.push("Carboxylic acid present — matches NSAID pharmacophore (ibuprofen, naproxen family)");
      if (p.numAromaticRings >= 2) r.push("Diaryl scaffold consistent with classical COX-2 inhibitor geometry");
      return r;
    },
  },
  // ── Nuclear receptors ──────────────────────────────────────────────────────
  {
    uniprotId: "P10275", geneName: "AR", fullName: "Androgen Receptor",
    targetClass: "Nuclear Receptor", area: "Oncology (Prostate) / Endocrinology", color: "amber",
    score(s, p) {
      let sc = 0;
      if (inRange(p.mw, 300, 560))    sc += 1.5;
      if (inRange(p.logP, 2, 6))      sc += 1.5;
      if (steroidLike(p))             sc += 2.5;
      if (smHas(s, "C(=O)[NH]") || smHas(s, "[NH]C(=O)")) sc += 1.5;  // amide linker
      if (smHas(s, "CF3") || smHas(s, "C(F)(F)F"))         sc += 1.5;  // enzalutamide CF3
      if (hasSulfonyl(s) && smHas(s, "N"))                  sc += 1;
      return sc;
    },
    rationale(s, p) {
      const r: string[] = [];
      if (steroidLike(p)) r.push(`Steroid-like ring system (${p.numRings} rings, logP ${p.logP.toFixed(1)}) — compatible with AR ligand-binding domain`);
      if (smHas(s, "CF3") || smHas(s, "C(F)(F)F")) r.push("Trifluoromethyl group — key pharmacophore in enzalutamide/darolutamide for LBD engagement");
      if (smHas(s, "C(=O)[NH]")) r.push("Amide linker bridges A-ring and B-ring equivalents in non-steroidal antiandrogen scaffold");
      return r;
    },
  },
  {
    uniprotId: "P03372", geneName: "ESR1", fullName: "Estrogen Receptor α",
    targetClass: "Nuclear Receptor", area: "Oncology (Breast) / Endocrinology", color: "red",
    score(s, p) {
      let sc = 0;
      if (inRange(p.mw, 280, 540))    sc += 1.5;
      if (inRange(p.logP, 2, 6))      sc += 1.5;
      if (steroidLike(p))             sc += 2.5;
      if (smHas(s, "Oc1ccc") || smHas(s, "c1cc(O)")) sc += 2.5;  // phenol → key pharmacophore
      if (smHas(s, "c1ccc(O)cc1"))                    sc += 1;
      return sc;
    },
    rationale(s, p) {
      const r: string[] = [];
      if (smHas(s, "Oc1ccc") || smHas(s, "c1cc(O)")) r.push("Phenolic OH — essential pharmacophore for Glu353/Arg394 hydrogen bond in ERα binding pocket (estradiol, tamoxifen metabolite)");
      if (steroidLike(p)) r.push(`Steroid-like scaffold (${p.numRings} rings) matches ERα LBD topology`);
      if (inRange(p.mw, 280, 540)) r.push(`MW ${p.mw.toFixed(0)} Da in range of SERMs/SERDs (tamoxifen 371, fulvestrant 606)`);
      return r;
    },
  },
  // ── Epigenetics ────────────────────────────────────────────────────────────
  {
    uniprotId: "Q92769", geneName: "HDAC2", fullName: "Histone Deacetylase 2",
    targetClass: "Epigenetic Enzyme (HDAC)", area: "Oncology / CNS", color: "cyan",
    score(s, p) {
      let sc = 0;
      if (inRange(p.mw, 280, 500))    sc += 1.5;
      if (inRange(p.logP, 1, 4))      sc += 1;
      if (smHas(s, "C(=O)NO") || smHas(s, "NO"))     sc += 3;   // hydroxamate
      if (smHas(s, "C(=O)N") && smCount(s, "C(=O)N") >= 2) sc += 2; // benzamide
      if (smHas(s, "c1ccc") && hasZincBinder(s))     sc += 1.5;
      return sc;
    },
    rationale(s, p) {
      const r: string[] = [];
      if (smHas(s, "C(=O)NO") || smHas(s, "NO")) r.push("Hydroxamic acid zinc-binding group — classic HDAC cap-linker-ZBG pharmacophore (vorinostat, panobinostat)");
      if (smHas(s, "C(=O)N") && smCount(s, "C(=O)N") >= 2) r.push("Multiple amide groups suggest benzamide-type HDAC inhibitor (entinostat, mocetinostat)");
      return r;
    },
  },
  // ── Immune checkpoint ──────────────────────────────────────────────────────
  {
    uniprotId: "Q15116", geneName: "PDCD1", fullName: "Programmed Cell Death Protein 1 (PD-1)",
    targetClass: "Immune Checkpoint (PPI)", area: "Immuno-Oncology", color: "emerald",
    score(s, p) {
      let sc = 0;
      if (inRange(p.mw, 400, 700))    sc += 1.5;
      if (inRange(p.logP, 1, 5))      sc += 1;
      if (p.numAromaticRings >= 4)    sc += 2;
      if (p.numRings >= 4)            sc += 1;
      if (inRange(p.hbd, 2, 6))       sc += 1;
      if (smHas(s, "C(F)(F)F") || smCount(s, "F") >= 3) sc += 1;
      // large, flat, macrocycle-like → PPI
      if (p.mw > 500 && p.numAromaticRings >= 3) sc += 1.5;
      return sc;
    },
    rationale(s, p) {
      const r: string[] = [];
      if (p.numAromaticRings >= 4) r.push(`${p.numAromaticRings} aromatic rings — large planar surface area compatible with PD-1/PD-L1 protein-protein interface burial`);
      if (p.mw > 500) r.push(`MW ${p.mw.toFixed(0)} Da — larger molecules better occupy the shallow PD-L1 groove (BMS-1166 class)`);
      r.push("Immuno-oncology small molecule PPI disruptors share extended, flat aromatic architecture");
      return r;
    },
  },
];

// ── main export ───────────────────────────────────────────────────────────────

export function suggestTargets(
  smiles: string,
  props: MolecularProperties,
  topN = 5,
): TargetSuggestion[] {
  if (!smiles || !props.isValid) return [];

  const scored = CATALOGUE.map(t => {
    const rawScore = t.score(smiles, props);
    const reasons  = t.rationale(smiles, props);
    return { ...t, rawScore, reasons };
  });

  // Sort descending by score
  scored.sort((a, b) => b.rawScore - a.rawScore);

  // Normalise confidence to top scorer
  const maxScore = scored[0]?.rawScore ?? 1;

  return scored.slice(0, topN).map(t => ({
    uniprotId:   t.uniprotId,
    geneName:    t.geneName,
    fullName:    t.fullName,
    targetClass: t.targetClass,
    confidence:  Math.min(1, t.rawScore / Math.max(maxScore, 1)),
    rationale:   t.reasons.length > 0 ? t.reasons : ["Physicochemical profile overlaps with known inhibitors of this target class"],
    area:        t.area,
    color:       t.color,
  }));
}
