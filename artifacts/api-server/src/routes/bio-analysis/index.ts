import { Router } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

router.post("/bio-analysis", async (req, res) => {
  try {
    const { molName, smiles, indication, layer1, layer2, layer3 } = req.body as {
      molName: string;
      smiles: string;
      indication: string;
      layer1: Record<string, unknown>;
      layer2?: Record<string, unknown> | null;
      layer3?: Record<string, unknown> | null;
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
      qed?: number;
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

    const systemPrompt = `You are an expert pharmaceutical scientist and clinical pharmacologist with deep expertise in drug discovery, ADMET profiling, PBPK modelling, and clinical trial design. You provide rigorous, evidence-based analysis of computational drug development data.

Always respond in structured JSON with exactly these keys:
{
  "molecularOverview": "<2-3 sentence summary of the molecule's drug-likeness and key physicochemical properties>",
  "safetyNarrative": "<clinical safety interpretation of ADMET scores and toxicity alerts, with specific concern flags>",
  "pkAnalysis": "<pharmacokinetic interpretation: absorption, distribution, half-life, clearance — clinical dosing implications>",
  "targetEngagement": "<binding affinity interpretation, selectivity profile, therapeutic window estimate>",
  "cohortInsights": "<Layer 2 patient population insights, responder segmentation, dose-response interpretation — or 'Layer 2 not yet run' if absent>",
  "trialDesignRationale": "<Layer 3 trial design evaluation, adaptive strategy assessment, power/cost trade-offs — or 'Layer 3 not yet run' if absent>",
  "competitiveContext": "<how this compound compares to existing drugs in its class based on the similar drugs listed>",
  "riskMitigations": ["<specific risk 1 with mitigation>", "<specific risk 2 with mitigation>", "<specific risk 3>"],
  "goNogoRationale": "<scientific justification for the GO/WATCH/NO-GO recommendation>",
  "nextSteps": ["<immediate next experiment or study>", "<second priority action>", "<third priority action>"]
}`;

    const userMessage = `Analyze this drug candidate:

**Molecule:** ${molName}
**SMILES:** ${smiles}
**Indication:** ${indication}

## Layer 1 — Molecular Properties & ADMET
${JSON.stringify({
  lipinskiRO5: l1.lipinski,
  admetScores: l1.admet,
  qed: l1.qed,
  saScore: l1.saScore,
  targetBinding: l1.binding,
  toxicityAlerts: l1.toxAlerts,
  similarDrugs: l1.similarDrugs,
  goNogo: l1.goNogo,
  confidence: `${((l1.confidence ?? 0.85) * 100).toFixed(0)}%`,
  systemRecommendation: l1.recommendation,
}, null, 2)}

${l2 ? `## Layer 2 — Patient Cohort PBPK Simulation
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
}, null, 2)}` : "## Layer 2 — Not yet simulated"}

${l3 ? `## Layer 3 — Clinical Trial Digital Twin
${JSON.stringify({
  statisticalPower_pct: l3.power,
  successProbability_pct: l3.successProb,
  expectedDuration_months: l3.expectedDuration,
  expectedCost_M_USD: l3.expectedCost,
  sampleSizePerArm: l3.nArm,
  primaryEndpoint: l3.primaryEndpoint,
  adaptiveDesign: l3.adaptiveEnabled,
}, null, 2)}` : "## Layer 3 — Not yet simulated"}

Provide your expert biomedical analysis as structured JSON.`;

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
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
