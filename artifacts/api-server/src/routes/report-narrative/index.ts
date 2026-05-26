import { Router } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

const SYSTEM_PROMPT = `You are a senior pre-clinical drug discovery scientist writing the narrative sections of a Layer 1 In Vitro Digital Twin report. Your audience is medicinal chemists and translational scientists. Be concise, evidence-based, and never fabricate numeric values — only interpret what is provided.

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

router.post("/api/report-narrative", async (req, res) => {
  try {
    const { smiles, indication, molProps, simResults, inVitroResults } = req.body ?? {};
    if (!smiles) {
      res.status(400).json({ error: "smiles required" });
      return;
    }

    const userPayload = JSON.stringify(
      { smiles, indication, molProps, simResults, inVitroResults },
      null,
      2,
    );

    const userMessage = `Write the Layer 1 In Vitro report narrative for this compound. Use only the values provided — if a field is null or missing, say "not measured" rather than inventing a number.\n\n${userPayload}`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
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
