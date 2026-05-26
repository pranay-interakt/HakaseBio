import { Router } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

router.post("/bio-chat", async (req, res) => {
  try {
    const { context, messages, molName, indication } = req.body as {
      context: Record<string, unknown>;
      messages: Array<{ role: "user" | "assistant"; content: string }>;
      molName?: string;
      indication?: string;
    };

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const systemPrompt = [
      `You are HakaseAI, a biomedical AI assistant specialising in drug discovery and development.`,
      `The user has run multi-layer simulations on compound "${molName ?? "unknown"}" for "${indication ?? "unknown indication"}"`,
      `and has received an AI analysis report shown below. Answer their follow-up questions concisely and precisely,`,
      `citing specific values from the context where relevant. Stay in scientific/clinical framing.`,
      ``,
      `## AI Analysis Context`,
      JSON.stringify(context, null, 2),
    ].join("\n");

    const stream = anthropic.messages.stream({
      model: "claude-opus-4-5",
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });

    stream.on("text", (text) => {
      res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
    });

    const final = await stream.finalMessage();
    const fullText = final.content
      .filter(b => b.type === "text")
      .map(b => (b as { type: "text"; text: string }).text)
      .join("");

    res.write(`data: ${JSON.stringify({ done: true, full: fullText })}\n\n`);
    res.end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Chat failed";
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    res.end();
  }
});

export default router;
