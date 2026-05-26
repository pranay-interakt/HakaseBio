import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";

if (!apiKey) {
  throw new Error(
    "Anthropic API key is not set. Please set ANTHROPIC_API_KEY in your .env",
  );
}

export const anthropic = new Anthropic({
  apiKey,
  baseURL,
});
