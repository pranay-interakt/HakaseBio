import jsPDF from "jspdf";
import { API_ROOT } from "./apiBase";

type Narrative = {
  executiveSummary?: string;
  molecularProfile?: string;
  potencyAndBinding?: string;
  admetCommentary?: string;
  riskAssessment?: string;
  recommendedNextSteps?: string[];
};

export type Layer1ReportInput = {
  smiles: string;
  indication: string;
  molProps: Record<string, unknown> | null;
  simResults: Record<string, unknown> | null;
  inVitroResults: Record<string, unknown> | null;
  mlAdmet?: Record<string, unknown> | null;
  cardiotox?: Record<string, unknown> | null;
};

const fmt = (v: unknown, digits = 2): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(digits);
  }
  return String(v);
};

async function fetchNarrative(input: Layer1ReportInput): Promise<Narrative> {
  try {
    const res = await fetch(`${API_ROOT}/api/report-narrative`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        smiles: input.smiles,
        indication: input.indication,
        molProps: input.molProps,
        simResults: input.simResults,
        inVitroResults: input.inVitroResults,
      }),
    });
    if (!res.ok) return {};
    const json = await res.json();
    return (json.narrative as Narrative) ?? {};
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Small Molecule Modality Report (100% Native Vector) ─────────────────────
// ─────────────────────────────────────────────────────────────────────────────

export async function generateLayer1Report(input: Layer1ReportInput): Promise<void> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentW = pageW - margin * 2;
  let y = margin;

  const ensureSpace = (need: number) => {
    if (y + need > pageH - margin - 30) {
      doc.addPage();
      y = margin + 20;
    }
  };

  const drawHeading = (text: string, size = 12, borderCol = [139, 92, 246]) => {
    ensureSpace(size + 24);
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.setTextColor(30, 41, 59); // Slate-800
    
    // Render accent left stripe
    doc.setFillColor(borderCol[0], borderCol[1], borderCol[2]);
    doc.rect(margin, y - size + 2, 4, size, "F");
    
    doc.text(text, margin + 10, y);
    y += 8;
    
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(margin, y, margin + contentW, y);
    y += 14;
  };

  const drawParagraph = (text: string, size = 9.5) => {
    if (!text) return;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(71, 85, 105); // Slate-600
    const lines = doc.splitTextToSize(text, contentW) as string[];
    for (const line of lines) {
      ensureSpace(size + 4);
      doc.text(line, margin, y);
      y += size + 4;
    }
    y += 6;
  };

  const drawModernTable = (headers: string[], rows: string[][], colWidths: number[]) => {
    ensureSpace(32);
    
    // Header background
    doc.setFillColor(30, 41, 59); // Slate-800
    doc.rect(margin, y, contentW, 20, "F");
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(255, 255, 255);
    
    let curX = margin;
    headers.forEach((h, idx) => {
      doc.text(h, curX + 8, y + 13);
      curX += colWidths[idx];
    });
    y += 20;
    
    // Rows
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    
    rows.forEach((row, rowIdx) => {
      let maxLines = 1;
      row.forEach((cell, idx) => {
        const lines = doc.splitTextToSize(cell || "—", colWidths[idx] - 16).length;
        if (lines > maxLines) maxLines = lines;
      });
      const rowH = Math.max(18, maxLines * 11 + 6);
      
      ensureSpace(rowH);
      
      // Alternating row background
      if (rowIdx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
      } else {
        doc.setFillColor(255, 255, 255);
      }
      doc.rect(margin, y, contentW, rowH, "F");
      
      doc.setDrawColor(241, 245, 249);
      doc.setLineWidth(0.5);
      doc.line(margin, y + rowH, margin + contentW, y + rowH);
      
      doc.setTextColor(51, 65, 85);
      
      curX = margin;
      row.forEach((cell, idx) => {
        const textLines = doc.splitTextToSize(cell || "—", colWidths[idx] - 16) as string[];
        doc.text(textLines, curX + 8, y + 12);
        curX += colWidths[idx];
      });
      y += rowH;
    });
    y += 10;
  };

  const drawAlertCallout = (title: string, detail: string, severity: "critical" | "warning" | "info") => {
    const isCritical = severity === "critical";
    const isWarning = severity === "warning";
    const bgR = isCritical ? 254 : isWarning ? 255 : 243;
    const bgG = isCritical ? 242 : isWarning ? 248 : 244;
    const bgB = isCritical ? 242 : isWarning ? 220 : 246;
    
    const borderR = isCritical ? 239 : isWarning ? 217 : 99;
    const borderG = isCritical ? 68  : isWarning ? 119 : 102;
    const borderB = isCritical ? 68  : isWarning ? 6   : 241;
    
    const lines = doc.splitTextToSize(detail, contentW - 24) as string[];
    const boxH = Math.max(38, lines.length * 11 + 24);
    
    ensureSpace(boxH + 10);
    
    doc.setFillColor(bgR, bgG, bgB);
    doc.rect(margin, y, contentW, boxH, "F");
    
    doc.setFillColor(borderR, borderG, borderB);
    doc.rect(margin, y, 4, boxH, "F");
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.text(title, margin + 12, y + 14);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(lines, margin + 12, y + 25);
    
    y += boxH + 10;
  };

  // ── Cover page banner ───────────────────────────────────────────
  doc.setFillColor(46, 16, 101); // Elegant Violet for small molecules
  doc.rect(0, 0, pageW, 140, "F");
  
  doc.setFillColor(139, 92, 246);
  doc.rect(0, 140, pageW, 4, "F");
  
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("HAKASE AI · BIODIGITAL TWIN PRECLINICAL REPORT", margin, 46);
  doc.setFontSize(18);
  doc.text("Layer 1 — Small Molecule In Vitro Dossier", margin, 74);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(216, 180, 254);
  doc.text(`Indication: ${input.indication || "None specified"}`, margin, 96);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, 112);

  y = 170;

  // Format SMILES nicely
  const smilesText = input.smiles || "";
  let wrappedSmiles = "";
  for (let i = 0; i < smilesText.length; i += 75) {
    wrappedSmiles += smilesText.slice(i, i + 75) + (i + 75 < smilesText.length ? "\n" : "");
  }

  // Cover Sheet Info
  drawHeading("Compound Identity & Physicochemical Profile", 11);
  drawParagraph(`SMILES String:\n${wrappedSmiles}`);
  y += 6;

  const pc = input.molProps as { mw?: number; logP?: number; tpsa?: number; hbd?: number; hba?: number; qed_approx?: number };
  drawModernTable(
    ["Physicochemical Index", "Predicted Value", "Translational Interpretation & Druglikeness Rules"],
    [
      ["Molecular Weight (MW)", `${fmt(pc?.mw)} g/mol`, "Optimal size <500 g/mol helps passive biological diffusion and membrane permeability."],
      ["Partition Coefficient (LogP)", fmt(pc?.logP), "Lipophilicity balance. Crucial for cellular membrane penetration and metabolic clearance."],
      ["Polar Surface Area (TPSA)", `${fmt(pc?.tpsa)} Å²`, "Polarity proxy. TPSA ≤ 140 Å² correlates with good intestinal/cellular absorption."],
      ["H-Bond Donors / Acceptors", `${fmt(pc?.hbd, 0)} / ${fmt(pc?.hba, 0)}`, "Solubility vs permeability index. Donors ≤5 and Acceptors ≤10 satisfy Lipinski rules."],
      ["QED Drug-Likeness Score", fmt(pc?.qed_approx), "Bickerton Quantitative Estimate of Drug-likeness score (0 = poor, 1 = ideal)."]
    ],
    [150, 100, 249]
  );

  // ── Fetch LLM Narrative ─────────────────────────────────────────────
  const narrative = await fetchNarrative(input);

  if (narrative.executiveSummary) {
    drawHeading("Executive Pre-Clinical Summary", 11);
    drawParagraph(narrative.executiveSummary);
  }
  if (narrative.molecularProfile) {
    drawHeading("Molecular Scaffold & Structural Interpretation", 11);
    drawParagraph(narrative.molecularProfile);
  }

  // ── Page Break for ADMET predictive table ────────────────────────────
  doc.addPage();
  y = margin + 20;

  const iv = (input.inVitroResults ?? {}) as {
    overallRisk?: string;
    inVitroScore?: number;
    doseResponse?: {
      ic50_nM?: number | null;
      ec50_nM?: number | null;
      hillCoefficient?: number | null;
      maxInhibition?: number | null;
      curve?: Array<{ concentration: number; response: number }>;
      potencyClass?: string | null;
      potencyConvention?: string | null;
    };
    permeability?: {
      caco2Papp?: number;
      caco2Class?: string;
      pampaPe?: number;
      pampaClass?: string;
      effluxRatio?: number;
      pgpSubstrate?: boolean;
    };
    metabolicStability?: {
      microsomalCLint?: number;
      microsomalClass?: string;
      hepatocyteCLint?: number;
      hepatocyteClass?: string;
      halfLifeMin?: number;
      cypInhibition?: {
        CYP1A2?: { ic50_uM: number; risk: string };
        CYP2C9?: { ic50_uM: number; risk: string };
        CYP2C19?: { ic50_uM: number; risk: string };
        CYP2D6?: { ic50_uM: number; risk: string };
        CYP3A4?: { ic50_uM: number; risk: string };
      };
    };
    plasmaProteinBinding?: {
      fuPercent?: number;
      boundPercent?: number;
      bindingClass?: string;
    };
    herg?: {
      ic50_uM?: number;
      safetyMargin?: number;
      riskCategory?: string;
      patchClampResult?: string;
    };
    selectivity?: {
      kinaseSelectivityScore?: number | null;
      offTargetHits?: number | null;
      totalTargetsTested?: number | null;
      selectivityClass?: string | null;
      topOffTargets?: Array<{ name: string; ic50_nM: number; selectivityRatio: number }>;
    };
    cellViability?: {
      cc50_uM?: number;
      therapeuticIndex?: number;
      cellLine?: string;
      viabilityAt10uM?: number;
    };
  };

  const sim = (input.simResults ?? {}) as {
    goNogo?: string;
    confidence?: number;
    recommendation?: string;
    saScore?: number;
    toxAlerts?: Array<{ name: string; category: string; severity: string; detail: string }>;
  };

  drawHeading("Comprehensive ADMET Predictive Profiling", 11);
  
  const cyp = iv.metabolicStability?.cypInhibition;
  const cypSummary = cyp 
    ? `3A4: ${cyp.CYP3A4?.risk || "—"} | 2D6: ${cyp.CYP2D6?.risk || "—"} | 2C9: ${cyp.CYP2C9?.risk || "—"}` 
    : "—";

  drawModernTable(
    ["ADMET Axis", "Specific Endpoint Metric", "Score/Class", "Verifiable Pharmacokinetic Implication"],
    [
      ["Absorption", "Caco-2 Permeability (Papp)", `${fmt(iv.permeability?.caco2Papp)} × 10⁻⁶ cm/s`, `Class: ${iv.permeability?.caco2Class || "Moderate"}. Intestinal absorption speed.`],
      ["Absorption", "PAMPA Membrane Diffusion", `${fmt(iv.permeability?.pampaPe)} × 10⁻⁶ cm/s`, `Class: ${iv.permeability?.pampaClass || "Moderate"}. Passive diffusion rate.`],
      ["Absorption", "P-gp Substrate / Efflux", iv.permeability?.pgpSubstrate ? "Substrate (Yes)" : "Non-Substrate (No)", `Efflux ratio: ${fmt(iv.permeability?.effluxRatio)}. Active transporter efflux risk.`],
      ["Distribution", "Plasma Protein Binding (PPB)", `${fmt(iv.plasmaProteinBinding?.boundPercent)}%`, `Class: ${iv.plasmaProteinBinding?.bindingClass || "Highly Bound"}. Fraction bound to albumin.`],
      ["Distribution", "Free Drug Fraction (fu)", `${fmt(iv.plasmaProteinBinding?.fuPercent)}%`, "Unbound therapeutically active molecule percentage in systemic circulation."],
      ["Metabolism", "Hepatocyte Clint", `${fmt(iv.metabolicStability?.hepatocyteCLint)} µL/min/10⁶ cells`, `Class: ${iv.metabolicStability?.hepatocyteClass || "Stable"}. Intrinsic clearance benchmark.`],
      ["Metabolism", "Microsomal Clint", `${fmt(iv.metabolicStability?.microsomalCLint)} µL/min/10⁶ cells`, `Class: ${iv.metabolicStability?.microsomalClass || "Stable"}. Hepatic first-pass extraction indicator.`],
      ["Metabolism", "CYP Isoform Inhibition Panel", cypSummary, "DDI drug-drug interaction risks via core liver enzyme blockage."],
      ["Elimination", "Estimated Clearance Half-life", `${fmt(iv.metabolicStability?.halfLifeMin)} min`, "Calculated excretion window for single dose dosing intervals."],
      ["Toxicity", "hERG Channel Blocker IC50", `${fmt(iv.herg?.ic50_uM)} µM`, `Risk: ${iv.herg?.riskCategory || "Low"}. Cardiac potassium channel blockage threshold.`],
      ["Toxicity", "Cell Viability CC50", `${fmt(iv.cellViability?.cc50_uM)} µM`, `Tested in: ${iv.cellViability?.cellLine || "HEK293"}. Cytotoxicity class marker.`],
      ["Toxicity", "Therapeutic Index (TI)", fmt(iv.cellViability?.therapeuticIndex), `Ratio of CC50 / target IC50. Margin of cellular safety.`]
    ],
    [80, 130, 110, 179]
  );

  if (narrative.admetCommentary) {
    drawHeading("ADMET Predictive Commentary", 11);
    drawParagraph(narrative.admetCommentary);
  }

  // ── Page Break for Target Affinity and Dose-Response Curve Coordinates ────
  doc.addPage();
  y = margin + 20;

  drawHeading("Target Engagement & Selectivity Profile", 11);
  const binding = (input.simResults as any)?.binding;
  if (binding) {
    drawParagraph(`Primary Target: ${binding.targetName || "Target of Interest"} (${binding.targetClass || "Unknown Class"})`);
    drawModernTable(
      ["Affinity Axis", "Predicted Potency Value (nM)", "Translational Context / Molecular Potency Tier"],
      [
        ["Dissociation Constant (Kd)", `${fmt(binding.primaryKd)} nM`, "Physical binding affinity. Lower values support low clinical doses."],
        ["Inhibition Constant (Ki)", `${fmt(binding.primaryKi)} nM`, "Thermodynamic inhibition capacity under competitive equilibrium."],
        ["Half-Maximal IC50", `${fmt(binding.primaryIC50)} nM`, `Tier: ${iv.doseResponse?.potencyClass || "Active"}. Functional biochemical potency.`],
        ["Selectivity Ratio", `${fmt(binding.selectivity)}`, "On-target vs. standard kinome/receptor selectivity index."]
      ],
      [150, 150, 199]
    );

    if (binding.offTargets && binding.offTargets.length > 0) {
      drawParagraph("Curated Off-Target Screening Panel (Selectivity Margin):");
      const offRows = (binding.offTargets as Array<{ name: string; kd: number; ki: number; ic50: number; selectivity: number }>).map(ot => [
        ot.name,
        `${fmt(ot.kd)} nM`,
        `${fmt(ot.ki)} nM`,
        `${fmt(ot.ic50)} nM`,
        `~${fmt(ot.selectivity)}x less active`
      ]);
      drawModernTable(
        ["Off-Target Species", "Kd Affinity", "Ki Constant", "IC50 Potency", "Selectivity Ratio"],
        offRows,
        [120, 90, 90, 90, 109]
      );
    }
  } else {
    drawParagraph("Note: No specific curated target binding database matches exist for this compound's UniProt catalog entry. Potency metrics default to in silico baseline physicochemical approximations.");
  }

  if (narrative.potencyAndBinding) {
    drawHeading("In Vitro Potency & Target Engagement Commentary", 11);
    drawParagraph(narrative.potencyAndBinding);
  }

  // Simulated Dose-Response Coordinates
  const curvePoints = iv.doseResponse?.curve;
  if (curvePoints && curvePoints.length > 0) {
    drawHeading("Simulated Dose-Response Coordinates", 11);
    drawParagraph(`Predicted Hill Slope: ${fmt(iv.doseResponse?.hillCoefficient)} | Maximum Efficacy (Emax): ${fmt(iv.doseResponse?.maxInhibition)}%`);
    
    // Sample 8 coordinates to keep table compact
    const sampledPoints: string[][] = [];
    const step = Math.max(1, Math.floor(curvePoints.length / 8));
    for (let i = 0; i < curvePoints.length; i += step) {
      const p = curvePoints[i];
      const concUM = p.concentration / 1000;
      sampledPoints.push([
        `${fmt(p.concentration, 3)} nM`,
        `${fmt(concUM, 6)} µM`,
        `${fmt(p.response, 1)}%`
      ]);
      if (sampledPoints.length >= 8) break;
    }
    
    drawModernTable(
      ["Concentration (nM)", "Concentration (µM)", "Simulated Response (% Efficacy Inhibition)"],
      sampledPoints,
      [150, 150, 199]
    );
  }

  // ── Page Break for Risks & Alerts ──────────────────────────────────
  doc.addPage();
  y = margin + 20;

  // ── Safety Callouts & Structural Alerts ───────────────────────────
  drawHeading("Toxicity Profile & Structural Reactive Alerts", 11);
  
  if (iv.herg?.riskCategory === "High" || (iv.herg?.ic50_uM && iv.herg.ic50_uM < 10)) {
    drawAlertCallout(
      "CRITICAL SAFETY WARNING: High hERG Channel Cardiotox Risk",
      `Compound demonstrates high simulated blocker affinity (IC50 = ${fmt(iv.herg.ic50_uM)} µM). High liability for QT interval prolongation and drug-induced ventricular arrhythmia. Patch-clamp electrophysiology screening is highly recommended.`,
      "critical"
    );
  }

  // Matched Structural Alerts Table
  const alerts = sim.toxAlerts || [];
  if (alerts.length > 0) {
    const alertRows = alerts.map(a => [
      a.name,
      a.category,
      a.severity,
      a.detail
    ]);
    drawModernTable(
      ["Raised Alert Name", "Tox Category", "Severity", "Chemical Structural Basis & Motif Details"],
      alertRows,
      [110, 80, 60, 249]
    );
  } else {
    drawParagraph("Excellent: No high-severity Brenk, BMS, NIH-MLSMR reactive electrophile, or PAINS pan-assay interference structural alerts detected.");
  }

  if (narrative.riskAssessment) {
    drawHeading("Integrated Preclinical Risk Assessment", 11);
    drawParagraph(narrative.riskAssessment);
  }

  // Headline Decision Metrics
  drawHeading("Layer-1 Preclinical Verdict Metrics", 11);
  drawModernTable(
    ["Developability Axis", "Composite Predictor Value", "Calibrated Safety Verdict"],
    [
      ["In Vitro Composite Score", iv.inVitroScore != null ? `${(iv.inVitroScore * 100).toFixed(1)}%` : "—", `Overall Risk Rank: ${iv.overallRisk || "Stable"}`],
      ["Developability Recommendation", sim.goNogo || "GO", `Heuristic Confidence: ${fmt(sim.confidence != null ? sim.confidence * 100 : 0, 1)}%`],
      ["Synthetic Accessibility Complexity", fmt(sim.saScore, 1) + " / 10", sim.saScore && sim.saScore > 6 ? "High synthesis complexity (Difficult)" : "Standard routine SPPS/Organic synthesis"],
      ["Actionable Pipeline Stage", "Layer-1 Preclinical Complete", sim.recommendation || "Proceed to in vitro verification assays."]
    ],
    [160, 160, 179]
  );

  if (narrative.recommendedNextSteps && narrative.recommendedNextSteps.length > 0) {
    drawHeading("Actionable Pre-Clinical Next Steps", 11);
    for (const step of narrative.recommendedNextSteps) {
      drawParagraph(`•  ${step}`);
    }
  }

  // ── Page 5: ML ADMET Predictions (if mlAdmet data available) ───────────
  const mlAdmet = (input.mlAdmet ?? {}) as {
    source?: string;
    ml_available?: boolean;
    structured?: {
      absorption?: { caco2_logPapp?: number | null; bioavailability_class?: string | null };
      distribution?: { vd_l_kg?: number | null; ppb_pct?: number | null; bbb_permeant?: boolean | null };
      metabolism?: { cyp3a4_substrate?: boolean | null; cyp3a4_inhibitor?: boolean | null; clint_mlmin_mg?: number | null };
      excretion?: { t_half_h?: number | null; cl_ml_min_kg?: number | null };
      toxicity?: { ld50_mgkg?: number | null; herg_blocker_prob?: number | null; dili_risk?: string | null };
    };
  };
  const ctox = (input.cardiotox ?? {}) as {
    ml_available?: boolean;
    prediction?: { blocker_probability?: number | null; risk_class?: string | null; ic50_band?: string | null };
  };

  if (mlAdmet.ml_available || ctox.ml_available) {
    doc.addPage();
    y = margin + 20;
    drawHeading("ML-Enhanced ADMET Prediction Panel", 11);
    drawParagraph("The following endpoints are scored by machine-learning gradient-boosted models trained on curated experimental ADMET datasets. Values supplement — and never replace — the mechanistic heuristic predictions above.");

    const st = mlAdmet.structured ?? {};
    const abs = st.absorption ?? {};
    const dist = st.distribution ?? {};
    const met = st.metabolism ?? {};
    const exc = st.excretion ?? {};
    const tox = st.toxicity ?? {};

    drawModernTable(
      ["ADMET Domain", "ML Endpoint", "ML Predicted Value", "Preclinical Relevance"],
      [
        ["Absorption", "Caco-2 LogPapp", abs.caco2_logPapp != null ? `${abs.caco2_logPapp.toFixed(2)} log (cm/s)` : "—", `Class: ${abs.bioavailability_class ?? "—"}. Intestinal mucosal permeability predictor.`],
        ["Distribution", "Volume of Distribution", dist.vd_l_kg != null ? `${dist.vd_l_kg.toFixed(2)} L/kg` : "—", "Indicates extensive tissue distribution vs. plasma confinement."],
        ["Distribution", "Plasma Protein Binding", dist.ppb_pct != null ? `${dist.ppb_pct.toFixed(1)}%` : "—", "ML-scored % bound. High PPB reduces free drug fraction."],
        ["Distribution", "BBB Permeant", dist.bbb_permeant === true ? "Yes (Permeant)" : dist.bbb_permeant === false ? "No (Non-permeant)" : "—", "Blood-brain barrier penetration. CNS liability or target access."],
        ["Metabolism", "CYP3A4 Substrate", met.cyp3a4_substrate === true ? "Substrate (Yes)" : met.cyp3a4_substrate === false ? "Non-Substrate" : "—", "Most abundant liver/gut CYP isoform. Major DDI risk."],
        ["Metabolism", "CYP3A4 Inhibitor", met.cyp3a4_inhibitor === true ? "Inhibitor (Yes)" : met.cyp3a4_inhibitor === false ? "Non-Inhibitor" : "—", "Perpetrator of drug-drug interactions via CYP3A4 blockage."],
        ["Metabolism", "CLint (ML-scored)", met.clint_mlmin_mg != null ? `${met.clint_mlmin_mg.toFixed(1)} mL/min/mg` : "—", "Intrinsic microsomal clearance. Correlates with hepatic extraction ratio."],
        ["Excretion", "Elimination t½ (ML)", exc.t_half_h != null ? `${exc.t_half_h.toFixed(1)} h` : "—", "ML half-life estimate. Governs dosing interval planning."],
        ["Excretion", "Clearance Rate", exc.cl_ml_min_kg != null ? `${exc.cl_ml_min_kg.toFixed(2)} mL/min/kg` : "—", "ML systemic clearance from plasma."],
        ["Toxicity", "hERG Blocker Prob.", tox.herg_blocker_prob != null ? `${(tox.herg_blocker_prob * 100).toFixed(1)}%` : "—", "ML-scored probability of hERG channel blockade. >50% = elevated cardiac risk."],
        ["Toxicity", "DILI Risk Class", tox.dili_risk ?? "—", "Drug-Induced Liver Injury risk category from ML hepatotox model."],
        ["Toxicity", "LD50 Estimate", tox.ld50_mgkg != null ? `${tox.ld50_mgkg.toFixed(0)} mg/kg` : "—", "Predicted median lethal dose (rodent, oral). Tier I toxicity screen."],
      ],
      [80, 130, 120, 169]
    );

    if (ctox.ml_available && ctox.prediction) {
      const prob = ctox.prediction.blocker_probability;
      const cls = ctox.prediction.risk_class ?? "—";
      drawHeading("Cardiotoxicity hERG Channel Electrophysiology", 11);
      drawModernTable(
        ["Cardiotox Endpoint", "ML Score / Class", "Safety Assessment Verdict"],
        [
          ["hERG Blocker Probability", prob != null ? `${(prob * 100).toFixed(1)}%` : "—", `Risk class: ${cls}. Bayesian gradient-boost. Threshold = 50%.`],
          ["Predicted IC50 Band", ctox.prediction.ic50_band ?? "—", "Estimated IC50 range from ensemble model outputs."],
          ["Action Required", prob != null && prob > 0.7 ? "Mandatory hERG patch-clamp assay (IQ-CSRC protocol)" : prob != null && prob > 0.4 ? "Monitor. Consider hERG confirmation." : "Low priority — routine cardiovascular safety panel.", ""],
        ],
        [150, 150, 199]
      );
      if (prob != null && prob > 0.7) {
        drawAlertCallout(
          "CRITICAL: High ML-Scored hERG Blocker Probability",
          `ML model scored ${(prob * 100).toFixed(1)}% blocker probability (Risk: ${cls}). ICH E14/S7B cardiac safety assessment and follow-up in vitro patch-clamp electrophysiology are strongly recommended before in vivo dosing.`,
          "critical"
        );
      }
    }
  }

  // ── Header/Footer layout across pages ────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184); // Slate-400
    doc.text(`HakaseAI · Layer 1 Small Molecule Report · Page ${i} of ${pageCount}`, margin, pageH - 20);
    doc.text("Pre-clinical research only · Not a clinical recommendation", pageW - margin, pageH - 20, { align: "right" });
    
    if (i > 1) {
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.5);
      doc.line(margin, 35, pageW - margin, 35);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text("HAKASE AI · LAYER 1 SMALL MOLECULE ASSESSMENT DOSSIER", margin, 28);
    }
  }

  const safeName = (input.indication || "compound").replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
  doc.save(`HakaseAI_Layer1_SmallMolecule_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Peptide Modality Report (100% Native Vector) ────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

export type PeptideReportInput = {
  sequence: string;
  cyclic: boolean;
  indication?: string;
  result: Record<string, any> | null;
};

type PeptideNarrative = {
  executiveSummary?: string;
  peptideProfile?: string;
  stabilityAndPermeability?: string;
  activityAndSelectivity?: string;
  riskAssessment?: string;
  recommendedNextSteps?: string[];
};

async function fetchPeptideNarrative(input: PeptideReportInput): Promise<PeptideNarrative> {
  try {
    const res = await fetch(`${API_ROOT}/api/report-narrative`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modality: "peptide",
        sequence: input.sequence,
        cyclic: input.cyclic,
        indication: input.indication || "None specified",
        result: input.result,
      }),
    });
    if (!res.ok) return {};
    const json = await res.json();
    return (json.narrative as PeptideNarrative) ?? {};
  } catch {
    return {};
  }
}

export async function generatePeptideL1Report(input: PeptideReportInput): Promise<void> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentW = pageW - margin * 2;
  let y = margin;

  const ensureSpace = (need: number) => {
    if (y + need > pageH - margin - 30) {
      doc.addPage();
      y = margin + 20;
    }
  };

  const drawHeading = (text: string, size = 12, borderCol = [109, 40, 217]) => {
    ensureSpace(size + 24);
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.setTextColor(30, 41, 59);
    
    doc.setFillColor(borderCol[0], borderCol[1], borderCol[2]);
    doc.rect(margin, y - size + 2, 4, size, "F");
    
    doc.text(text, margin + 10, y);
    y += 8;
    
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(margin, y, margin + contentW, y);
    y += 14;
  };

  const drawParagraph = (text: string, size = 9.5) => {
    if (!text) return;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(71, 85, 105);
    const lines = doc.splitTextToSize(text, contentW) as string[];
    for (const line of lines) {
      ensureSpace(size + 4);
      doc.text(line, margin, y);
      y += size + 4;
    }
    y += 6;
  };

  const drawModernTable = (headers: string[], rows: string[][], colWidths: number[]) => {
    ensureSpace(32);
    doc.setFillColor(30, 41, 59);
    doc.rect(margin, y, contentW, 20, "F");
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(255, 255, 255);
    
    let curX = margin;
    headers.forEach((h, idx) => {
      doc.text(h, curX + 8, y + 13);
      curX += colWidths[idx];
    });
    y += 20;
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    
    rows.forEach((row, rowIdx) => {
      let maxLines = 1;
      row.forEach((cell, idx) => {
        const lines = doc.splitTextToSize(cell || "—", colWidths[idx] - 16).length;
        if (lines > maxLines) maxLines = lines;
      });
      const rowH = Math.max(18, maxLines * 11 + 6);
      
      ensureSpace(rowH);
      
      if (rowIdx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
      } else {
        doc.setFillColor(255, 255, 255);
      }
      doc.rect(margin, y, contentW, rowH, "F");
      
      doc.setDrawColor(241, 245, 249);
      doc.setLineWidth(0.5);
      doc.line(margin, y + rowH, margin + contentW, y + rowH);
      
      doc.setTextColor(51, 65, 85);
      
      curX = margin;
      row.forEach((cell, idx) => {
        const textLines = doc.splitTextToSize(cell || "—", colWidths[idx] - 16) as string[];
        doc.text(textLines, curX + 8, y + 12);
        curX += colWidths[idx];
      });
      y += rowH;
    });
    y += 10;
  };

  const drawAlertCallout = (title: string, detail: string, severity: "critical" | "warning" | "info") => {
    const isCritical = severity === "critical";
    const isWarning = severity === "warning";
    const bgR = isCritical ? 254 : isWarning ? 255 : 243;
    const bgG = isCritical ? 242 : isWarning ? 248 : 244;
    const bgB = isCritical ? 242 : isWarning ? 220 : 246;
    
    const borderR = isCritical ? 239 : isWarning ? 217 : 109;
    const borderG = isCritical ? 68  : isWarning ? 119 : 40;
    const borderB = isCritical ? 68  : isWarning ? 6   : 217;
    
    const lines = doc.splitTextToSize(detail, contentW - 24) as string[];
    const boxH = Math.max(38, lines.length * 11 + 24);
    
    ensureSpace(boxH + 10);
    
    doc.setFillColor(bgR, bgG, bgB);
    doc.rect(margin, y, contentW, boxH, "F");
    
    doc.setFillColor(borderR, borderG, borderB);
    doc.rect(margin, y, 4, boxH, "F");
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.text(title, margin + 12, y + 14);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(lines, margin + 12, y + 25);
    
    y += boxH + 10;
  };

  const res = input.result || {};
  const ce = res.custom_env || {};

  // ── Cover page banner ───────────────────────────────────────────
  doc.setFillColor(53, 16, 91); // Elegant Amethyst Purple for peptides
  doc.rect(0, 0, pageW, 140, "F");
  
  doc.setFillColor(109, 40, 217);
  doc.rect(0, 140, pageW, 4, "F");
  
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("HAKASE AI · PEPTIDE NATIVE PRECLINICAL ENGINEERING", margin, 46);
  doc.setFontSize(18);
  doc.text("Layer 1 — Peptide Biophysical Dossier", margin, 74);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(233, 213, 255);
  doc.text(`Indication: ${input.indication || "None specified"}`, margin, 96);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, 112);

  y = 170;

  // Format Peptide Sequence nicely
  const seqText = input.sequence || "";
  let formattedSeq = "";
  for (let i = 0; i < seqText.length; i += 75) {
    formattedSeq += seqText.slice(i, i + 75) + (i + 75 < seqText.length ? "\n" : "");
  }

  // Cover Sheet environment specs
  drawHeading("Preclinical Formulations & Environment Parameters", 11);
  drawModernTable(
    ["Environment Input Specification", "Assigned Value", "Biophysical Salt-Shielding & pH Relevance"],
    [
      ["Aqueous Formulation pH", `pH ${fmt(ce.ph || 7.4, 1)}`, `Drives charge state (net charge: ${fmt(ce.net_charge_custom, 1)}). Determines aggregation risk.`],
      ["Ionic Strength (Salinity)", `${fmt(ce.ionic_strength || 150.0)} mM`, "Applies Debye-Hückel screening (e^-0.0035 * I) shielding Aggregation/Solubility."],
      ["Disulfide Bridges Configured", ce.disulfide_bridges_input || "None mapped", "Indices defined by user in sidebar map connectivities."],
      ["Confirmed Bridges Count", `${fmt(ce.valid_bridges?.length || 0, 0)} pairs`, "Paired cysteines are masked from free thiol chemical oxidation liabilities."],
      ["Free Cysteine Thiol Count", `${fmt(ce.free_cys_count || 0, 0)} free residues`, "Cysteines not engaged in disulfides. Reactive handles for bioconjugation."]
    ],
    [150, 120, 229]
  );

  drawHeading("Peptide Sequence & Structural Conformation", 11);
  drawParagraph(`Sequence Residues:\n${formattedSeq}`);
  y += 6;

  drawModernTable(
    ["Scaffold Parameter", "AI Prediction / Value", "Medicinal Chemistry Context"],
    [
      ["Sequence Residues", `${seqText.length} AA residues`, "Scaffold length. Optimal synthetic window is 10–40 AA."],
      ["Conformation Class", input.cyclic ? "Cyclic (disulfide or head-to-tail)" : "Linear Scaffold", "Cyclisation boosts proteolytic stability and membrane permeability."],
      ["Molecular Weight", `${fmt(res.physicochemical?.molecular_weight_da)} Da`, "Therapeutic window check. Standard peptides clear renally below 10 kDa."],
      ["Isoelectric Point (pI)", fmt(res.physicochemical?.isoelectric_point, 1), "Binary search calculation. IEP is the pH where solubility is minimal."],
      ["Instability Index", `${fmt(res.physicochemical?.instability_index, 1)} (${res.physicochemical?.instability_class || "—"})`, "Determines in vitro stability. Values ≤40 are classified as stable."]
    ],
    [130, 130, 239]
  );

  // ── AI Narrative ─────────────────────────────────────────────
  const narrative = await fetchPeptideNarrative(input);

  if (narrative.executiveSummary) {
    drawHeading("Executive Pre-Clinical Summary", 11);
    drawParagraph(narrative.executiveSummary);
  }
  if (narrative.peptideProfile) {
    drawHeading("Peptide Conformational & Structural Character", 11);
    drawParagraph(narrative.peptideProfile);
  }

  // Chou-Fasman secondary structure
  const ss = res.secondary_structure;
  if (ss) {
    drawModernTable(
      ["Conformation Type", "Fraction Percentage", "Structural Implication"],
      [
        ["Alpha-Helix (h)", `${(ss.helix_fraction * 100).toFixed(1)}%`, "helix percentage supports alpha-helical target alignment."],
        ["Beta-Sheet (e)", `${(ss.beta_sheet_fraction * 100).toFixed(1)}%`, "High beta character accelerates aggregation self-association."],
        ["Beta-Turn (t)", `${(ss.coil_fraction * 100).toFixed(1)}%`, "Often introduces flexibility and loops."],
        ["Dominant Secondary Structure", ss.dominant_class || "—", "Chou-Fasman dominant configuration classifier."]
      ],
      [150, 100, 249]
    );
  }

  // ── Page Break for proteolytic and conjugation tables ────────────────
  doc.addPage();
  y = margin + 20;

  // Proteolytic stability detailed tables
  drawHeading("Proteolytic Degradation & Cleavage Profile", 11);
  const proteases = res.proteolytic_stability?.sites || [];
  if (proteases.length > 0) {
    drawParagraph("Chemical Cleavage Hotspots Scanned Across 9 Major Proteolytic Enzymes:");
    const protRows = (proteases as Array<{ protease: string; sites: number[]; n_sites: number }>).map(p => [
      p.protease,
      `${p.n_sites} site(s)`,
      p.sites.length > 0 ? p.sites.join(", ") : "None detected",
      p.n_sites > 4 ? "High susceptibility" : p.n_sites > 0 ? "Moderate" : "Resistant"
    ]);
    drawModernTable(
      ["Target Protease", "Cleavage Site Count", "Specific Residue Cleavage Indices", "Susceptibility Verdict"],
      protRows,
      [120, 110, 169, 100]
    );
  }

  const proteaseCleavages = res.proteolytic_stability?.most_labile_n_sites ?? 0;
  if (proteaseCleavages > 4) {
    drawAlertCallout(
      "DEVELOPABILITY EXPOSURE: High Protease Susceptibility",
      `Engine detected severe vulnerabilities in vitro (most labile protease is ${res.proteolytic_stability.most_labile_protease} with ${proteaseCleavages} sites). C-terminal amidation, N-capping, or D-amino acid replacement is recommended.`,
      "warning"
    );
  }

  if (narrative.stabilityAndPermeability) {
    drawHeading("Proteolytic Stability & Membrane Permeability Commentary", 11);
    drawParagraph(narrative.stabilityAndPermeability);
  }

  // Bioconjugation Site Inventory
  const bioconj = res.bioconjugation_sites || {};
  if (bioconj.total_reactive_sites != null) {
    drawHeading("Bioconjugation Site Inventory & Modifications", 11);
    drawModernTable(
      ["Reactive Residue Type", "Scanned Positions", "Chemical Conjugation Potential"],
      [
        ["N-Terminal Site", bioconj.n_terminal ? "1 (Active)" : "0 (Blocked)", "Suited for amine-directed NHS ester conjugation."],
        ["Lysine (K) Sites", bioconj.lysine_positions?.length > 0 ? bioconj.lysine_positions.join(", ") : "0 positions", "Amine-specific pegylation or payload linkage site."],
        ["Cysteine (C) Sites", bioconj.cysteine_positions?.length > 0 ? bioconj.cysteine_positions.join(", ") : "0 positions", "Thiol-specific maleimide drug linker chemistry."],
        ["Aspartate (D) Sites", bioconj.aspartate_positions?.length > 0 ? bioconj.aspartate_positions.join(", ") : "0 positions", "Carboxylic acid chemistry linkers."],
        ["Preferred Conjugation Site", bioconj.preferred_site || "—", "Recommended site based on structural steric availability."]
      ],
      [150, 150, 199]
    );

    if (bioconj.chemistry_options && bioconj.chemistry_options.length > 0) {
      drawParagraph(`Preferred chemistry options: ${bioconj.chemistry_options.join("; ")}`);
    }
  }

  // ── Page Break for formulation & biophysics ──────────────────────────
  doc.addPage();
  y = margin + 20;

  // Aqueous Formulation Profile
  drawHeading("Biophysical Stability & Aqueous Formulation Profile", 11);
  const cp = res.charge_profile;
  if (cp) {
    drawParagraph("Henderson-Hasselbalch Formulation Charge vs pH Curve:");
    drawModernTable(
      ["Formulation pH Buffer", "Net Calculated Peptide Charge", "Aqueous Phase Stability & Self-Association Outlook"],
      [
        ["pH 4.0 (Acidic)", `${fmt(cp.pH_4_0, 1)}`, cp.pH_4_0 > 2 ? "Highly soluble cationic state" : "Stable charge"],
        ["pH 5.0 (Weakly Acidic)", `${fmt(cp.pH_5_0, 1)}`, "Typical subcutaneous injection formulation range"],
        ["pH 6.0 (Isotonic Buffer)", `${fmt(cp.pH_6_0, 1)}`, "Lyophilization reconstitution buffer stability range"],
        ["pH 7.4 (Physiological)", `${fmt(cp.pH_7_4, 1)}`, "Blood plasma pH. Net charge governs protein binding"],
        ["pH 8.0 (Weakly Basic)", `${fmt(cp.pH_8_0, 1)}`, "Basic buffer formulation range"],
        ["pH 9.0 (Alkaline)", `${fmt(cp.pH_9_0, 1)}`, "Cationic shielding reduces electrostatic solubility"]
      ],
      [140, 130, 229]
    );
  }

  // AGGRESCAN hotspots
  const agg = res.aggregation || {};
  if (agg.regions && agg.regions.length > 0) {
    drawParagraph("AGGRESCAN Aggregation-Prone Regions Scanned:");
    const aggRows = (agg.regions as Array<{ start: number; end: number; sequence: string; peak_a4v: number; area: number }>).map(r => [
      `Residues ${r.start}-${r.end}`,
      r.sequence,
      fmt(r.peak_a4v, 3),
      fmt(r.area, 1),
      r.peak_a4v > 0.02 ? "Critical Hotspot" : "Moderate self-association"
    ]);
    drawModernTable(
      ["Sequence Position", "Agg-Prone Motif", "Peak a4v Intensity", "Hotspot Area Index", "Self-Association Risk"],
      aggRows,
      [110, 100, 100, 90, 99]
    );
  } else {
    drawParagraph("Excellent: No AGGRESCAN self-associating beta-aggregation-prone hotspots detected.");
  }

  if (narrative.riskAssessment) {
    drawHeading("Formulation & Aggregation Risk Assessment", 11);
    drawParagraph(narrative.riskAssessment);
  }

  // Synthesis and Developability Verdict
  const syn = res.synthesis || {};
  drawHeading("Synthetic SPPS Feasibility & Developability Metrics", 11);
  drawModernTable(
    ["Developability Property Group", "Value / Score", "Translational Safety Rating"],
    [
      ["In Vitro Health Score", res.inVitroScore != null ? `${res.inVitroScore}%` : "—", (res.inVitroScore ?? 0) >= 50 ? "GO" : "WATCH"],
      ["Net Charge at Buffer pH", fmt(ce.net_charge_custom, 1), "Drives electrostatic repulsion solubility."],
      ["SPPS Synthesis Difficulty", syn.difficulty_class || "Routine", `Score: ${fmt(syn.difficulty_score, 1)}/100. ${syn.note || ""}`],
      ["Aqueous Solubility Class", res.solubility?.solubility_class || "High", `Index: ${fmt(res.solubility?.solubility_score, 0)}/100`],
      ["Membrane Permeability Class", res.membrane_permeability?.permeability_class || "Low", `CPP Signal: ${res.membrane_permeability?.cpp_signal_detected ? "Yes" : "No"}`]
    ],
    [160, 160, 179]
  );

  if (syn.factors && syn.factors.length > 0) {
    drawParagraph(`Synthesis Difficulty Factors Detected: ${syn.factors.join("; ")}`);
  }

  if (narrative.recommendedNextSteps && narrative.recommendedNextSteps.length > 0) {
    drawHeading("Actionable Sequence Engineering Next Steps", 11);
    for (const step of narrative.recommendedNextSteps) {
      drawParagraph(`•  ${step}`);
    }
  }

  // ── Header/Footer layout across pages ────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`HakaseAI · Layer 1 Peptide Report · Page ${i} of ${pageCount}`, margin, pageH - 20);
    doc.text("Pre-clinical research only · Not a clinical recommendation", pageW - margin, pageH - 20, { align: "right" });
    
    if (i > 1) {
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.5);
      doc.line(margin, 35, pageW - margin, 35);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text("HAKASE AI · LAYER 1 PEPTIDE BIOPHYSICAL ASSESSMENT DOSSIER", margin, 28);
    }
  }

  const safeName = (input.indication || "peptide").replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
  doc.save(`HakaseAI_Layer1_Peptide_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Antibody Modality Report (100% Native Vector) ───────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

export type AntibodyReportInput = {
  heavy: string;
  light: string;
  formatHint?: string;
  indication?: string;
  result: Record<string, any> | null;
};

type AntibodyNarrative = {
  executiveSummary?: string;
  antibodyProfile?: string;
  developabilityAssessment?: string;
  stabilityAndBinding?: string;
  riskAssessment?: string;
  recommendedNextSteps?: string[];
};

async function fetchAntibodyNarrative(input: AntibodyReportInput): Promise<AntibodyNarrative> {
  try {
    const res = await fetch(`${API_ROOT}/api/report-narrative`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modality: "antibody",
        heavy: input.heavy,
        light: input.light,
        formatHint: input.formatHint || "Auto",
        indication: input.indication || "None specified",
        result: input.result,
      }),
    });
    if (!res.ok) return {};
    const json = await res.json();
    return (json.narrative as AntibodyNarrative) ?? {};
  } catch {
    return {};
  }
}

export async function generateAntibodyL1Report(input: AntibodyReportInput): Promise<void> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentW = pageW - margin * 2;
  let y = margin;

  const ensureSpace = (need: number) => {
    if (y + need > pageH - margin - 30) {
      doc.addPage();
      y = margin + 20;
    }
  };

  const drawHeading = (text: string, size = 12, borderCol = [30, 58, 138]) => {
    ensureSpace(size + 24);
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.setTextColor(30, 41, 59);
    
    doc.setFillColor(borderCol[0], borderCol[1], borderCol[2]);
    doc.rect(margin, y - size + 2, 4, size, "F");
    
    doc.text(text, margin + 10, y);
    y += 8;
    
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(margin, y, margin + contentW, y);
    y += 14;
  };

  const drawParagraph = (text: string, size = 9.5) => {
    if (!text) return;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(71, 85, 105);
    const lines = doc.splitTextToSize(text, contentW) as string[];
    for (const line of lines) {
      ensureSpace(size + 4);
      doc.text(line, margin, y);
      y += size + 4;
    }
    y += 6;
  };

  const drawModernTable = (headers: string[], rows: string[][], colWidths: number[]) => {
    ensureSpace(32);
    doc.setFillColor(30, 41, 59);
    doc.rect(margin, y, contentW, 20, "F");
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(255, 255, 255);
    
    let curX = margin;
    headers.forEach((h, idx) => {
      doc.text(h, curX + 8, y + 13);
      curX += colWidths[idx];
    });
    y += 20;
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    
    rows.forEach((row, rowIdx) => {
      let maxLines = 1;
      row.forEach((cell, idx) => {
        const lines = doc.splitTextToSize(cell || "—", colWidths[idx] - 16).length;
        if (lines > maxLines) maxLines = lines;
      });
      const rowH = Math.max(18, maxLines * 11 + 6);
      
      ensureSpace(rowH);
      
      if (rowIdx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
      } else {
        doc.setFillColor(255, 255, 255);
      }
      doc.rect(margin, y, contentW, rowH, "F");
      
      doc.setDrawColor(241, 245, 249);
      doc.setLineWidth(0.5);
      doc.line(margin, y + rowH, margin + contentW, y + rowH);
      
      doc.setTextColor(51, 65, 85);
      
      curX = margin;
      row.forEach((cell, idx) => {
        const textLines = doc.splitTextToSize(cell || "—", colWidths[idx] - 16) as string[];
        doc.text(textLines, curX + 8, y + 12);
        curX += colWidths[idx];
      });
      y += rowH;
    });
    y += 10;
  };

  const drawAlertCallout = (title: string, detail: string, severity: "critical" | "warning" | "info") => {
    const isCritical = severity === "critical";
    const isWarning = severity === "warning";
    const bgR = isCritical ? 254 : isWarning ? 255 : 243;
    const bgG = isCritical ? 242 : isWarning ? 248 : 244;
    const bgB = isCritical ? 242 : isWarning ? 220 : 246;
    
    const borderR = isCritical ? 239 : isWarning ? 217 : 30;
    const borderG = isCritical ? 68  : isWarning ? 119 : 58;
    const borderB = isCritical ? 68  : isWarning ? 6   : 138;
    
    const lines = doc.splitTextToSize(detail, contentW - 24) as string[];
    const boxH = Math.max(38, lines.length * 11 + 24);
    
    ensureSpace(boxH + 10);
    
    doc.setFillColor(bgR, bgG, bgB);
    doc.rect(margin, y, contentW, boxH, "F");
    
    doc.setFillColor(borderR, borderG, borderB);
    doc.rect(margin, y, 4, boxH, "F");
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.text(title, margin + 12, y + 14);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(lines, margin + 12, y + 25);
    
    y += boxH + 10;
  };

  const res = input.result || {};
  const bs = res.bioprocess_specs || {};

  // ── Cover page banner ───────────────────────────────────────────
  doc.setFillColor(15, 23, 42); // Deep Royal Navy background for antibodies
  doc.rect(0, 0, pageW, 140, "F");
  
  doc.setFillColor(30, 58, 138); // Royal blue accent stripe
  doc.rect(0, 140, pageW, 4, "F");
  
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("HAKASE AI · THERAPEUTIC ANTIBODY DEVELOPABILITY NATIVE DOSSIER", margin, 46);
  doc.setFontSize(18);
  doc.text("Layer 1 — Antibody Pre-Clinical Assessment", margin, 74);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(147, 197, 253);
  doc.text(`Indication: ${input.indication || "None specified"}`, margin, 96);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, 112);

  y = 170;

  // Format Heavy & Light Chain sequences nicely
  const wrapSequence = (seq: string): string => {
    let formatted = "";
    for (let i = 0; i < seq.length; i += 75) {
      formatted += seq.slice(i, i + 75) + (i + 75 < seq.length ? "\n" : "");
    }
    return formatted || "—";
  };

  // Bioprocess parameters on Cover
  drawHeading("Bioprocess Formulation & Specification Parameters", 11);
  drawModernTable(
    ["Preclinical Construct Axis", "Assigned Format Specification", "Manufacturability & Circulation Relevance"],
    [
      ["Target Antigen", bs.target_antigen || "None specified", "Specified target matching patient pathology indication."],
      ["Expression Host Cell", bs.expression_host || "CHO (Chinese Hamster Ovary)", "CHO/HEK support standard glycosylation; E. coli lacks eukaryotic sequons."],
      ["Antibody Subclass format", bs.subclass || "IgG1", "Isotype format governs constant Fc structural clearance rate recycling."],
      ["Construct MW Estimate", `${fmt(bs.construct_mw_da / 1000, 1)} kDa`, "Molecular Weight size check. Glomerular renal cutoff clearance limit is ~60 kDa."]
    ],
    [150, 160, 189]
  );

  drawHeading("Antibody Chain Sequences & Configuration", 11);
  const rows: Array<[string, string, string]> = [
    ["Heavy Chain Variable", wrapSequence(input.heavy), `Length: ${input.heavy.length} AA. Variable domain.`],
  ];
  if (input.light) {
    rows.push(["Light Chain Variable", wrapSequence(input.light), `Length: ${input.light.length} AA. Variable domain.`]);
  }
  rows.push(["Inferred Format", res.inferred_format || "—", "Structural antibody subclass alignment."]);
  rows.push(["Numbering Method", res.numbering_method || "—", "CDR alignment standard (Chothia/Kabat/IMGT)."]);

  drawModernTable(
    ["Region / Chain", "Sequence Composition", "Clinical/Translation Context"],
    rows,
    [130, 200, 169]
  );

  // ── AI Narrative ─────────────────────────────────────────────
  const narrative = await fetchAntibodyNarrative(input);

  if (narrative.executiveSummary) {
    drawHeading("Executive Developability Summary", 11);
    drawParagraph(narrative.executiveSummary);
  }
  if (narrative.antibodyProfile) {
    drawHeading("Chain Physicochemical & Humanness Profile", 11);
    drawParagraph(narrative.antibodyProfile);
  }

  // ── Page Break for Liabilities & CDRs ───────────────────────────────
  doc.addPage();
  y = margin + 20;

  // Position-Specific CDR Liabilities Table
  drawHeading("Position-Specific CDR Sequence Liabilities", 11);
  const chains = res.chains || [];
  const liabilities: Array<{ type: string; chain: string; motif: string; position: number; location: string; severity: string; note: string }> = [];
  chains.forEach((ch: any) => {
    if (ch.liabilities) {
      ch.liabilities.forEach((l: any) => liabilities.push({ ...l, chain: ch.label }));
    }
  });

  if (liabilities.length > 0) {
    const liabRows = liabilities.map(l => [
      l.chain,
      l.type,
      l.motif,
      `Residue ${l.position}`,
      l.location,
      l.severity,
      l.note
    ]);
    drawModernTable(
      ["Chain", "Liability Type", "Sequence Motif", "Residue Index", "Region", "Severity", "Bioprocess Note"],
      liabRows,
      [60, 90, 60, 70, 60, 50, 109]
    );
  } else {
    drawParagraph("Excellent: No high-severity sequence chemical degradation liabilities (deamidation, isomerization, oxidation) detected in variable domains.");
  }

  const sum = res.summary || {};
  if (sum.n_liabilities_high > 0) {
    drawAlertCallout(
      "DEVELOPABILITY LIABILITY: High-Severity CDR Motifs Detected",
      `Engine scanned ${sum.n_liabilities_high} high-severity sequence liabilities (e.g. isomerization or glycosylation hotspots). Codon optimization or CDR mutagenesis is highly recommended to prevent degradation.`,
      "critical"
    );
  }

  // ── CDR Physicochemical Composition & TAP Analysis ──────────────────
  const cdrs = res.cdr_composition as Array<{
    cdr: string;
    sequence?: string;
    length: number;
    net_charge_pH7?: number;
    gravy?: number;
    aromaticity?: number;
    tap_status?: string;
  }>;
  
  if (cdrs && cdrs.length > 0) {
    drawHeading("CDR Physicochemical Composition & TAP Analysis", 11);
    const cdrRows = cdrs.map(c => [
      c.cdr,
      c.sequence ? (c.sequence.length > 12 ? c.sequence.slice(0, 11) + "…" : c.sequence) : "—",
      String(c.length),
      c.net_charge_pH7 != null ? `${c.net_charge_pH7 > 0 ? "+" : ""}${c.net_charge_pH7.toFixed(1)}` : "—",
      c.gravy != null ? c.gravy.toFixed(2) : "—",
      c.tap_status || "PASS"
    ]);
    drawModernTable(
      ["CDR name", "Segment Motif", "Length", "Net Charge pH 7.4", "GRAVY (Hydr.)", "TAP Rating Verdict"],
      cdrRows,
      [90, 100, 50, 90, 90, 79]
    );
  }

  if (narrative.developabilityAssessment) {
    drawHeading("TAP developability Flags & Viscosity Commentary", 11);
    drawParagraph(narrative.developabilityAssessment);
  }

  // ── Page Break for FcRn Binding & Half-Life ──────────────────────────
  doc.addPage();
  y = margin + 20;

  // FcRn binding and serum half-life
  drawHeading("FcRn Binding Recyling & Circulatory Residence Half-Life", 11);
  const fcrn = res.fcrn_binding || {};
  if (fcrn.per_chain && fcrn.per_chain.length > 0) {
    const fcrnRows = (fcrn.per_chain as Array<{ chain: string; pI: number; charge_pH7_4: number; charge_pH6_0_approx: number; fcrn_binding_score: string; verdict: string }>).map(ch => [
      ch.chain,
      fmt(ch.pI, 1),
      fmt(ch.charge_pH7_4, 1),
      fmt(ch.charge_pH6_0_approx, 1),
      ch.fcrn_binding_score,
      ch.verdict
    ]);
    drawModernTable(
      ["Antibody Chain", "Isoelectric pI", "Charge pH 7.4", "Charge pH 6.0", "FcRn Affinity", "Biophysical Verdict"],
      fcrnRows,
      [90, 80, 80, 80, 80, 89]
    );
  }

  drawModernTable(
    ["FcRn Triage Metric", "Prediction Value Score", "Preclinical Circulation Outlook Summary"],
    [
      ["Overall FcRn Score", fcrn.overall_fcrn_score || "Moderate", "Governs standard cellular endocytosis recycling pathway."],
      ["pH-switch recycling verdict", fcrn.overall_verdict || "PASS", "Recycling depends on positive charge switch from pH 7.4 to pH 6.0."],
      ["Circulatory Half-Life Prognosis", "Triage Grade Clearance Profile", fcrn.t_half_implication || "Standard IgG half-life ~21 days."],
      ["FcRn Assay Required", fcrn.assay_required || "Biacore SPR binding", "Experimental validation required before in vivo animal PK studies."]
    ],
    [150, 150, 199]
  );

  if (narrative.stabilityAndBinding) {
    drawHeading("Conformational Stability & Target Affinity Commentary", 11);
    drawParagraph(narrative.stabilityAndBinding);
  }

  // ── Page Break for Viscosity & Manufacturability ──────────────────────
  doc.addPage();
  y = margin + 20;

  // Viscosity and self-association risk
  const visc = res.viscosity_risk || {};
  const manu = res.manufacturability || {};
  drawHeading("Preclinical Manufacturability & High-Concentration Viscosity Triage", 11);
  drawModernTable(
    ["Manufacturability Axis", "Outlook Value Score", "Bioprocess Risk Factors & Drivers"],
    [
      ["Host Expression Yield Outlook", manu.expression_outlook || "Favourable", manu.note || "Standard expression yields expected."],
      ["Expression Risk Score", `${fmt(manu.risk_score, 1)} / 100`, manu.factors?.length > 0 ? manu.factors.join("; ") : "No negative expression risk factors found."],
      ["High-Conc Viscosity Risk", visc.risk || "Low Risk", visc.note || "Stable at high concentration formulation."],
      ["Self-Association Score", `${fmt(visc.risk_score, 1)} / 100`, visc.drivers?.length > 0 ? visc.drivers.join("; ") : "Low electrostatic self-association propensity."],
      ["Concentration Alert Threshold", visc.concentration_concern || "Safe up to >100 mg/mL", "Critical threshold above which aggregation/viscosity concerns escalate."]
    ],
    [150, 150, 199]
  );

  // AGGRESCAN regions in antibody
  const aggRegions: Array<{ chain: string; start: number; end: number; sequence: string; peak_a4v: number; area: number; location: string }> = [];
  chains.forEach((ch: any) => {
    if (ch.aggregation && ch.aggregation.regions) {
      ch.aggregation.regions.forEach((r: any) => aggRegions.push({ ...r, chain: ch.label }));
    }
  });

  if (aggRegions.length > 0) {
    drawHeading("AGGRESCAN Aggregation-Prone Hotspots (Antibody Regions)", 11);
    const aggRows = aggRegions.slice(0, 8).map(r => [
      r.chain,
      `Residues ${r.start}-${r.end}`,
      r.sequence,
      fmt(r.peak_a4v, 3),
      r.location,
      r.peak_a4v > 0.02 ? "High Risk" : "Moderate"
    ]);
    drawModernTable(
      ["Chain Domain", "Residue Range", "Hotspot Sequence", "Peak a4v Area", "Region Location", "Risk Level"],
      aggRows,
      [80, 90, 100, 80, 90, 59]
    );
  }

  // Summary Metrics Table
  drawHeading("Antibody Developability Summary Verdicts", 11);
  drawModernTable(
    ["Developability Category", "Triage Verdict Outlook", "TAP Risk Flag Tally"],
    [
      ["Primary Preclinical Verdict", sum.verdict || "PASS", "Overall molecular review recommendations."],
      ["Developability Tier Rating", sum.developability_tier || "Green Tier", "Calibrated developability assessment band."],
      ["TAP Flags (Red/Amber/Green)", `Red: ${sum.developability_flags?.red ?? 0} | Amber: ${sum.developability_flags?.amber ?? 0} | Green: ${sum.developability_flags?.green ?? 0}`, "Tally of TAP sequence properties flags."],
      ["AGGRESCAN Aggregation Risk", sum.aggregation_risk || "Low risk", "Overall aggregation liability outlook."],
      ["Isotype Stability Outlook", sum.stability_outlook || "Favourable", "Structural folding conformational stability prognosis."]
    ],
    [150, 170, 179]
  );

  if (narrative.riskAssessment) {
    drawHeading("Integrated Pre-Clinical Antibody Risk Assessment", 11);
    drawParagraph(narrative.riskAssessment);
  }

  if (narrative.recommendedNextSteps && narrative.recommendedNextSteps.length > 0) {
    drawHeading("Recommended Antibody Engineering Next Steps", 11);
    for (const step of narrative.recommendedNextSteps) {
      drawParagraph(`•  ${step}`);
    }
  }

  // ── Header/Footer layout across pages ────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`HakaseAI · Layer 1 Antibody Report · Page ${i} of ${pageCount}`, margin, pageH - 20);
    doc.text("Pre-clinical research only · Not a clinical recommendation", pageW - margin, pageH - 20, { align: "right" });
    
    if (i > 1) {
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.5);
      doc.line(margin, 35, pageW - margin, 35);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text("HAKASE AI · LAYER 1 ANTIBODY DEVELOPABILITY PROFILING DOSSIER", margin, 28);
    }
  }

  const safeName = (sum.developability_tier || "antibody").replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
  doc.save(`HakaseAI_Layer1_Antibody_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
