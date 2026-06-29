import Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic client wrapper with first-class DUMMY/bypass support.
 *
 * Production policy:
 *   - When ANTHROPIC_API_KEY is set to a real key AND ANTHROPIC_BYPASS != "force",
 *     `anthropic` is a live `Anthropic` SDK instance. All routes call Claude.
 *   - When the key is missing OR equal to "DUMMY" OR ANTHROPIC_BYPASS == "force",
 *     `anthropic` is a *bypass surface* that mimics the same callable shape
 *     (`messages.create`, `messages.stream`) and returns canned responses so
 *     the frontend's Layer-1 → IVIVE pipeline still completes end-to-end
 *     without throwing.
 *   - ANTHROPIC_BYPASS=off forces a hard failure if no key is set (useful
 *     in production to catch missing-secret deploys).
 *
 * The bypass is process-local and never makes network calls.
 */

const apiKey =
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
const baseURL =
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
const bypassMode = (process.env.ANTHROPIC_BYPASS ?? "auto").toLowerCase();

function shouldBypass(): boolean {
  if (bypassMode === "force") return true;
  if (bypassMode === "off") return false;
  // auto
  return !apiKey || apiKey === "DUMMY" || apiKey.startsWith("DUMMY");
}

// ── Bypass message surface ────────────────────────────────────────────────
interface BypassDelta {
  type: "text";
  text: string;
}

function bypassNarrative(messages: Array<{ role: string; content: string }>): string {
  const userMsg = [...messages].reverse().find((m) => m.role === "user");
  const tail = userMsg?.content?.slice(0, 240) ?? "the provided input";
  return [
    "**[ANTHROPIC BYPASS — DUMMY MODE]**",
    "",
    "Claude analysis is disabled because `ANTHROPIC_API_KEY` is unset or set to",
    "`DUMMY`. The Layer-1 → IVIVE pipeline still completed end-to-end; this",
    "narrative is a deterministic placeholder so the downstream UI can render.",
    "",
    `Echo of latest user prompt: ${tail}`,
    "",
    "Set a real key in `backend/.env` (or set `ANTHROPIC_BYPASS=off` to fail",
    "loud) to receive live Claude reports.",
  ].join("\n");
}

interface BypassStreamHandle {
  on: (event: "text" | "error" | "end", cb: (chunk: string) => void) => BypassStreamHandle;
  finalMessage: () => Promise<{
    content: BypassDelta[];
    role: "assistant";
    stop_reason: string;
  }>;
}

function bypassClient() {
  const make = (full: string) => {
    const listeners: Record<string, Array<(arg?: unknown) => void>> = {
      text: [],
      end: [],
      error: [],
    };
    queueMicrotask(() => {
      // Single-chunk stream (the message is short and deterministic).
      for (const cb of listeners.text) cb(full);
      for (const cb of listeners.end) cb();
    });
    const handle: BypassStreamHandle = {
      on(evt, cb) {
        listeners[evt].push(cb as (arg?: unknown) => void);
        return handle;
      },
      finalMessage: async () => ({
        content: [{ type: "text", text: full }],
        role: "assistant",
        stop_reason: "end_turn",
      }),
    };
    return handle;
  };

  return {
    __bypass: true,
    messages: {
      create: async (req: {
        messages: Array<{ role: string; content: string }>;
        system?: string;
        model?: string;
        max_tokens?: number;
      }) => ({
        id: `bypass-${Date.now()}`,
        model: req.model ?? "bypass",
        role: "assistant" as const,
        content: [{ type: "text", text: bypassNarrative(req.messages ?? []) }],
        stop_reason: "end_turn" as const,
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
      stream: (req: {
        messages: Array<{ role: string; content: string }>;
        system?: string;
        model?: string;
        max_tokens?: number;
      }) => make(bypassNarrative(req.messages ?? [])),
    },
  };
}

let exported: ReturnType<typeof bypassClient> | Anthropic;

if (shouldBypass()) {
  console.warn(
    "[anthropic] DUMMY/bypass mode active — Claude calls return canned text. " +
      "Set ANTHROPIC_API_KEY (and optionally ANTHROPIC_BYPASS=off) to go live.",
  );
  exported = bypassClient();
} else if (!apiKey) {
  throw new Error(
    "Anthropic API key is not set and ANTHROPIC_BYPASS=off. Set ANTHROPIC_API_KEY in your .env",
  );
} else {
  exported = new Anthropic({ apiKey, baseURL });
}

export const anthropic = exported as unknown as Anthropic;
export const anthropicBypassActive = shouldBypass();
