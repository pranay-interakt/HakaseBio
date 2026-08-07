import { Router, type IRouter } from "express";
import { anthropic } from "@platform/integrations";

const router: IRouter = Router();

const SMALL_MOL_SYSTEM_PROMPT = `You are a senior pre-clinical drug discovery scientist writing the narrative sections of a Layer 1 In Vitro Digital Twin report. Your audience is medicinal chemists and translational scientists. Be concise, evidence-based, and never fabricate numeric values — only interpret what is provided.

Respond with strict JSON only, matching this schema exactly:
{
  "executiveSummary": "<3-4 sentences: compound identity, indication, headline in vitro verdict, key risks>",
  "molecularProfile": "<2-3 sentences interpreting MW, LogP, TPSA, HBD/HBA, QED, Lipinski compliance>",
  "potencyAndBinding": "<2-3 sentences interpreting IC50/binding readouts and target engagement>",
  "admetCommentary": "<3-4 sentences across absorption, metabolism, hERG, selectivity, CYP liability>",
  "riskAssessment": "<2-3 sentences explaining the overall in vitro risk verdict and the dominant drivers>",
  "recommendedNextSteps": ["<step 1>", "<step 2>", "<step 3>"]
}

Do not include markdown fences, commentary, or any text outside the JSON object.`;

const PEPTIDE_SYSTEM_PROMPT = `You are a senior peptide drug discovery scientist writing the narrative sections of a Layer 1 In Silico & In Vitro Peptide report. Your audience is medicinal chemists and biophysicists. Be concise, evidence-based, and never fabricate numeric values — only interpret what is provided. Tell whether the predicted numbers/properties are good or bad, what is expected to make them nicer (modifications or changes), and provide a dynamic, highly genuine clinical and pre-clinical commentary.

Respond with strict JSON only, matching this schema exactly:
{
  "executiveSummary": "<3-4 sentences: peptide identity/sequence, conformation, headline in vitro verdict, key liabilities>",
  "peptideProfile": "<2-3 sentences interpreting physical properties like MW, pI, charge at pH 7.4, GRAVY, instability index>",
  "stabilityAndPermeability": "<2-3 sentences interpreting proteolytic stability, serum stability, half-life, and membrane permeability>",
  "activityAndSelectivity": "<2-3 sentences interpreting AMP class/score, MIC estimate (if applicable), and receptor engagement score>",
  "riskAssessment": "<2-3 sentences explaining the overall in vitro risk verdict, immunogenicity screen, aggregation hotspots, and synthesis feasibility>",
  "recommendedNextSteps": ["<step 1>", "<step 2>", "<step 3>"]
}

Do not include markdown fences, commentary, or any text outside the JSON object.`;

const ANTIBODY_SYSTEM_PROMPT = `You are a senior antibody developability scientist writing the narrative sections of a Layer 1 Antibody Developability report. Your audience is antibody engineers and translational scientists. Be concise, evidence-based, and never fabricate numeric values — only interpret what is provided. Tell whether the predicted numbers/properties are good or bad, what is expected to make them nicer, and provide a dynamic, highly genuine developability and pre-clinical engineering commentary.

Respond with strict JSON only, matching this schema exactly:
{
  "executiveSummary": "<3-4 sentences: antibody/format identity, headline developability verdict, key risk tiers/flags>",
  "antibodyProfile": "<2-3 sentences interpreting heavy/light chain properties, CDR compositions, and humanness/immunogenicity screen>",
  "developabilityAssessment": "<2-3 sentences interpreting TAP-style liabilities, aggregation hotspots, and viscosity risks>",
  "stabilityAndBinding": "<2-3 sentences interpreting conformational stability, manufacturability, and FcRn binding>",
  "riskAssessment": "<2-3 sentences explaining the overall developability tier and the dominant structural drivers>",
  "recommendedNextSteps": ["<step 1>", "<step 2>", "<step 3>"]
}

Do not include markdown fences, commentary, or any text outside the JSON object.`;

router.post("/api/report-narrative", async (req, res) => {
  try {
    const {
      modality,
      smiles,
      indication,
      molProps,
      simResults,
      inVitroResults,
      // Peptide payload
      sequence,
      cyclic,
      result: peptideResult,
      // Antibody payload
      heavy,
      light,
      formatHint,
      result: antibodyResult,
    } = req.body ?? {};

    let systemPrompt = SMALL_MOL_SYSTEM_PROMPT;
    let userPayload: unknown = { smiles, indication, molProps, simResults, inVitroResults };
    let promptSubject = "compound";

    // Determine modality and choose prompt
    if (modality === "peptide" || (sequence && !smiles)) {
      systemPrompt = PEPTIDE_SYSTEM_PROMPT;
      userPayload = { sequence, cyclic, indication, result: peptideResult };
      promptSubject = "peptide sequence";
    } else if (modality === "antibody" || (heavy && !smiles)) {
      systemPrompt = ANTIBODY_SYSTEM_PROMPT;
      userPayload = { heavy, light, formatHint, result: antibodyResult };
      promptSubject = "antibody construct";
    }

    const userMessage = `Write the Layer 1 In Vitro report narrative for this ${promptSubject}. Use only the values provided — if a field is null or missing, say "not measured" rather than inventing a number.\n\n${JSON.stringify(userPayload, null, 2)}`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";

    let parsed: unknown = null;
    try {
      const cleaned = raw.replace(/^```json\s*|\s*```$/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { executiveSummary: raw };
    }

    res.json({ narrative: parsed });
  } catch (err) {
    console.error("[report-narrative] error:", err);
    res.status(500).json({ error: "Report narrative generation failed" });
  }
});

export default router;
