import { Router } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

const FOCUSED_PROMPTS: Record<string, { system: string; label: string }> = {
  molecular: {
    label: "Molecular & ADMET",
    system: `You are an expert medicinal chemist and ADMET scientist specializing in early-stage drug discovery. Your role is to provide a rigorous, evidence-based molecular assessment focused purely on the physicochemical profile, ADMET characteristics, structural liabilities, and target engagement of the compound.

Always respond in structured JSON with exactly these keys:
{
  "molecularOverview": "<2-3 sentence physicochemical profile: MW, LogP, TPSA, HBD/HBA, QED — drug-likeness verdict and Lipinski compliance>",
  "safetyNarrative": "<interpretation of all 5 ADMET axes — specific absorption limitations, distribution concerns, metabolic vulnerabilities, excretion pathway, toxicity flags — clinical implications of each>",
  "targetEngagement": "<binding affinity (IC50/Kd/Ki) interpretation — therapeutic window estimate — selectivity profile — target class relevance — dose-response implications>",
  "structuralAlerts": "<structural liability analysis — hERG pharmacophore features — Ames mutagenicity structural basis — reactive group concerns — CYP inhibition scaffold risks — mitigation options>",
  "competitiveContext": "<head-to-head comparison with listed reference compounds — differentiation opportunities — liability comparison>",
  "riskMitigations": ["<specific structural risk 1 and concrete mitigation strategy>", "<specific risk 2 and mitigation>", "<specific risk 3>"],
  "nextSteps": ["<highest-priority in vitro experiment with rationale>", "<second priority assay>", "<third priority structural optimization goal>"]
}`,
  },

  clinical: {
    label: "Clinical PK/PD & Cohort",
    system: `You are an expert clinical pharmacologist and PBPK modelling specialist. Your role is to provide a rigorous interpretation of the patient cohort simulation, focusing on pharmacokinetics, pharmacodynamics, population variability, and adverse event signals.

Always respond in structured JSON with exactly these keys:
{
  "pkAnalysis": "<PBPK profile deep dive: half-life interpretation (dosing interval implication), Cmax risk (toxicity threshold proximity), Tmax clinical meaning, AUC exposure adequacy, Vdss distribution characteristics — if a concentration-time curve is provided, interpret onset, peak shape, and terminal phase>",
  "cohortInsights": "<virtual population analysis — responder vs non-responder rate clinical meaning — exposure-response relationship — patient subgroup considerations — biomarker stratification recommendations>",
  "adverseEventInterpretation": "<FAERS-calibrated AE signal clinical context — grade 3+ rate interpretation relative to standard of care — label warning implications — monitoring recommendations>",
  "dosingRecommendation": "<Phase I/II dose selection rationale — starting dose justification based on Cmax and safety margin — dose escalation strategy — food effect risk>",
  "drugInteractionRisk": "<CYP-mediated DDI risk — transporter interactions — protein binding displacement risk — dose adjustment requirement for hepatic/renal impairment>",
  "riskMitigations": ["<PK risk and monitoring strategy>", "<AE risk and dose management mitigation>", "<DDI risk and contraindication recommendation>"],
  "nextSteps": ["<highest-priority Phase I clinical study design element>", "<second priority PK study>", "<third priority biomarker or DDI study>"]
}`,
  },

  trial: {
    label: "Trial Design & Regulatory",
    system: `You are an expert clinical trial statistician and regulatory strategist with deep experience in FDA and EMA submissions. Your role is to provide a rigorous evaluation of the trial digital twin design and recommend an evidence-based regulatory pathway.

Always respond in structured JSON with exactly these keys:
{
  "trialDesignRationale": "<evaluation of the simulated trial design — sample size justification vs. comparable precedent — endpoint appropriateness — adaptive strategy assessment — key design assumptions and vulnerabilities>",
  "powerAnalysis": "<statistical power interpretation — success probability context — Type I/II error trade-off — sensitivity to effect size assumptions — interim analysis strategy effectiveness>",
  "regulatoryPathway": "<recommended FDA pathway (NDA 505b1/b2, BLA) — Priority Review vs Standard — Accelerated Approval eligibility — Breakthrough Therapy rationale based on HR and power — Orphan Drug designation applicability — key IND-enabling requirements before Phase I>",
  "goNogoRationale": "<scientific and statistical GO/WATCH/NO-GO justification — the three most critical decision criteria — comparison to historical success rates for this indication class>",
  "costBenefitAssessment": "<trial cost interpretation — cost per patient relative to industry average ($50k-$150k Phase III) — site optimization opportunities — timeline compression strategies>",
  "riskMitigations": ["<primary trial design risk and contingency plan>", "<primary regulatory risk and mitigation strategy>", "<primary enrollment risk and site selection mitigation>"],
  "nextSteps": ["<most critical pre-IND meeting or protocol amendment>", "<second priority regulatory submission action>", "<third priority — Phase II-III bridging strategy>"]
}`,
  },

  full: {
    label: "Full Integrated Analysis",
    system: `You are an expert pharmaceutical scientist and clinical pharmacologist with deep expertise in drug discovery, ADMET profiling, PBPK modelling, and clinical trial design. You provide rigorous, evidence-based analysis of computational drug development data.

Always respond in structured JSON with exactly these keys:
{
  "molecularOverview": "<2-3 sentence summary of the molecule's drug-likeness and key physicochemical properties>",
  "safetyNarrative": "<clinical safety interpretation of ADMET scores and toxicity alerts, with specific concern flags>",
  "pkAnalysis": "<pharmacokinetic interpretation: absorption, distribution, half-life, clearance — clinical dosing implications. If a PBPK curve is provided, interpret the shape, onset, and peak characteristics.>",
  "targetEngagement": "<binding affinity interpretation, selectivity profile, therapeutic window estimate. Reference gene/protein biology if target info provided.>",
  "cohortInsights": "<Layer 2 patient population insights, responder segmentation, dose-response interpretation. Reference real AE signals if FAERS data is present. — or 'Layer 2 not yet run' if absent>",
  "trialDesignRationale": "<Layer 3 trial design evaluation, adaptive strategy assessment including interim analysis decisions if available, power/cost trade-offs — or 'Layer 3 not yet run' if absent>",
  "competitiveContext": "<how this compound compares to existing drugs in its class based on the similar drugs listed>",
  "regulatoryPathway": "<recommended FDA/EMA regulatory strategy: application type (NDA/BLA), likely pathway (standard/priority/accelerated/breakthrough), IND-enabling study priorities, Phase I starting dose rationale based on binding IC50 and ADMET, breakthrough therapy or fast track eligibility reasoning, and key regulatory risk factors>",
  "riskMitigations": ["<specific risk 1 with mitigation>", "<specific risk 2 with mitigation>", "<specific risk 3>"],
  "goNogoRationale": "<scientific justification for the GO/WATCH/NO-GO recommendation>",
  "nextSteps": ["<immediate next experiment or study>", "<second priority action>", "<third priority action>"]
}`,
  },
};

router.post("/bio-analysis", async (req, res) => {
  try {
    const {
      molName, smiles, indication,
      layer1, layer2, layer3,
      proteinInfo, pkCurve, adverseEvents, interimAnalyses,
      focus = "full",
    } = req.body as {
      molName:    string;
      smiles:     string;
      indication: string;
      layer1:     Record<string, unknown>;
      layer2?:    Record<string, unknown> | null;
      layer3?:    Record<string, unknown> | null;
      focus?:     string;
      proteinInfo?: {
        name: string; gene: string; organism: string;
        sequenceLength: number; activeSites: number; bindingSites: number;
        pdbIds: string[]; alphafoldId: string | null;
      } | null;
      pkCurve?: Array<{ time: number; conc: number }> | null;
      adverseEvents?: Array<{ name: string; anyGrade: number; grade3Plus: number }> | null;
      interimAnalyses?: Array<{ planned: number; alpha: number; boundary: number; decision: string }> | null;
    };

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const l1 = layer1 as {
      admet?: { absorption?: number; distribution?: number; metabolism?: number; excretion?: number; toxicity?: number; overall?: number };
      lipinski?: { mw?: number; logP?: number; hbd?: number; hba?: number; violations?: number; tpsa?: number; rotBonds?: number };
      binding?: { primaryKd?: number; primaryKi?: number; primaryIC50?: number; targetName?: string; targetClass?: string };
      toxAlerts?: Array<{ name: string; category: string; severity: string; detail: string }>;
      goNogo?: string;
      qed_approx?: number;
      saScore?: number;
      confidence?: number;
      recommendation?: string;
      similarDrugs?: string[];
    };

    const l2 = layer2 as {
      halfLifeHr?: number; cmax?: number; cmaxSD?: number; tmax?: number; auc?: number;
      vdss?: number; responderRate?: number; nonResponderRate?: number; adverseRate?: number;
      cohortSize?: number;
    } | null | undefined;

    const l3 = layer3 as {
      power?: number; successProb?: number; expectedDuration?: number; expectedCost?: number;
      nArm?: number; primaryEndpoint?: string; adaptiveEnabled?: boolean;
    } | null | undefined;

    const proteinBlock = proteinInfo
      ? `## Target Protein (UniProt)
Gene: ${proteinInfo.gene}  |  Protein: ${proteinInfo.name}  |  Organism: ${proteinInfo.organism}
Sequence length: ${proteinInfo.sequenceLength} aa  |  Active sites: ${proteinInfo.activeSites}  |  Binding sites: ${proteinInfo.bindingSites}
Experimental structures (PDB): ${proteinInfo.pdbIds.length > 0 ? proteinInfo.pdbIds.slice(0, 5).join(", ") : "none"}
AlphaFold model: ${proteinInfo.alphafoldId ?? "not available"}`
      : "";

    const pkCurveBlock = pkCurve && pkCurve.length > 0
      ? `## PBPK Concentration-Time Profile (sampled)
Time (h) → Conc (ng/mL): ${pkCurve.map(p => `${p.time}h→${p.conc}`).join(", ")}`
      : "";

    const aeBlock = adverseEvents && adverseEvents.length > 0
      ? `## Adverse Event Signals (FAERS-calibrated)
${adverseEvents.map(ae =>
  `  ${ae.name}: any-grade ${ae.anyGrade.toFixed(1)}%, grade-3+ ${ae.grade3Plus.toFixed(1)}%`
).join("\n")}`
      : "";

    const interimBlock = interimAnalyses && interimAnalyses.length > 0
      ? `## Adaptive Trial Interim Analyses
${interimAnalyses.map((ia, i) =>
  `  Look ${i + 1} at n=${ia.planned}: alpha-spent=${ia.alpha.toFixed(4)}, z-boundary=${ia.boundary.toFixed(3)} → Decision: ${ia.decision}`
).join("\n")}`
      : "";

    const { system: systemPrompt } = FOCUSED_PROMPTS[focus] ?? FOCUSED_PROMPTS.full;

    const l1Block = `## Layer 1 — Molecular Properties & ADMET
${JSON.stringify({
  lipinskiRO5: l1.lipinski,
  admetScores: l1.admet,
  qed_approx: l1.qed_approx,
  saScore: l1.saScore,
  targetBinding: l1.binding,
  toxicityAlerts: l1.toxAlerts,
  similarDrugs: l1.similarDrugs,
  goNogo: l1.goNogo,
  confidence: `${((l1.confidence ?? 0.85) * 100).toFixed(0)}%`,
  systemRecommendation: l1.recommendation,
}, null, 2)}`;

    const l2Block = l2
      ? `## Layer 2 — Patient Cohort PBPK Simulation
${JSON.stringify({
  halfLife_hr: l2.halfLifeHr,
  Cmax_ngPerMl: l2.cmax,
  Cmax_SD: l2.cmaxSD,
  Tmax_hr: l2.tmax,
  AUC_ngHrPerMl: l2.auc,
  Vdss_LPerKg: l2.vdss,
  responderRate_pct: l2.responderRate,
  nonResponderRate_pct: l2.nonResponderRate,
  adverseEventRate_pct: l2.adverseRate,
  cohortSize: l2.cohortSize,
}, null, 2)}`
      : "## Layer 2 — Not yet simulated";

    const l3Block = l3
      ? `## Layer 3 — Clinical Trial Digital Twin
${JSON.stringify({
  statisticalPower_pct: l3.power,
  successProbability_pct: l3.successProb,
  expectedDuration_months: l3.expectedDuration,
  expectedCost_M_USD: l3.expectedCost,
  sampleSizePerArm: l3.nArm,
  primaryEndpoint: l3.primaryEndpoint,
  adaptiveDesign: l3.adaptiveEnabled,
}, null, 2)}`
      : "## Layer 3 — Not yet simulated";

    const focusedDataBlocks =
      focus === "molecular"
        ? `${l1Block}\n\n${proteinBlock}`
        : focus === "clinical"
        ? `${l1Block}\n\n${proteinBlock}\n\n${l2Block}\n\n${pkCurveBlock}\n\n${aeBlock}`
        : focus === "trial"
        ? `${l1Block}\n\n${l2Block}\n\n${l3Block}\n\n${interimBlock}`
        : `${l1Block}\n\n${proteinBlock}\n\n${l2Block}\n\n${pkCurveBlock}\n\n${aeBlock}\n\n${l3Block}\n\n${interimBlock}`;

    const userMessage = `Analyze this drug candidate:

**Molecule:** ${molName}
**SMILES:** ${smiles}
**Indication:** ${indication}

${focusedDataBlocks}

Provide your expert analysis as structured JSON.`;

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    let fullResponse = "";

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullResponse += event.delta.text;
        res.write(`data: ${JSON.stringify({ chunk: event.delta.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true, full: fullResponse })}\n\n`);
    res.end();
  } catch (err) {
    console.error("[bio-analysis] error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "AI analysis failed" });
    } else {
      res.write(`data: ${JSON.stringify({ error: "AI analysis failed" })}\n\n`);
      res.end();
    }
  }
});

export default router;
