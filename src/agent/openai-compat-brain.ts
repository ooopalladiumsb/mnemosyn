/**
 * D12 — a LIVE `Brain` backed by any OpenAI-compatible chat API (the first real, non-`ScriptedBrain`
 * Brain). Provider-agnostic: `baseURL` + `model` + `apiKey` come from config, so the same code runs
 * on DeepSeek / Qwen / Gemini / Groq / Anthropic-compat / a local Ollama — swapping providers (e.g.
 * "free now → premium when profitable") is a CONFIG change, never a code change. Default wiring is
 * DeepSeek `deepseek-v4-flash`.
 *
 * The Brain stays a pure seam (charter): it returns plaintext `MemoryDraft`s + a reply; it NEVER
 * imports the spine, encrypts, or holds a vault key. Real network calls are non-deterministic (an
 * untested seam); the JSON-parsing of the model's reply into a `BrainTurn` is the testable surface
 * (exercised via an injected `fetchImpl` with canned responses).
 *
 * ARCHITECT-OWNED CONTRACT. `OpenAICompatBrainConfig`, `OpenAICompatBrain`, and `deepseekBrain` are
 * FROZEN; DeepSeek implements the `turn` body (docs/TASK-deepseek-D12.md). New exports may be added.
 */
import type { Brain, BrainTurn, MemoryDraft, RecalledContext, ContextHit } from "./brain.js";
import type { MemoryKind } from "../spine/types.js";

/** All valid MemoryKind values for the system prompt enumeration. */
const ALLOWED_KINDS: readonly MemoryKind[] = [
  "dialog", "code", "document", "fact", "artifact",
  "state", "event", "decision", "skill", "tool_call",
];

/** Wiring for an OpenAI-compatible chat Brain. `fetchImpl` is injectable for deterministic tests. */
export interface OpenAICompatBrainConfig {
  readonly baseURL: string; // e.g. "https://api.deepseek.com"
  readonly model: string; // e.g. "deepseek-v4-flash"
  readonly apiKey: string;
  /** Optional system-prompt override; otherwise the built-in memory-aware prompt is used. */
  readonly systemPrompt?: string;
  /** Allowed MemorySpaces the Brain may write to (hint to the model). */
  readonly spaces?: readonly string[];
  /** Injected fetch for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

// ---------------------------------------------------------------------------
// Prompt building (exported for unit-testing)
// ---------------------------------------------------------------------------

/** Build the built-in system prompt listing allowed kinds, spaces, and the JSON schema. */
export function buildSystemPrompt(spaces: readonly string[]): string {
  const kindList = ALLOWED_KINDS.map((k) => `"${k}"`).join(", ");
  const spaceList = spaces.map((s) => `"${s}"`).join(", ");
  return `You are a memory-keeping assistant. For every user message you MUST do two things:

1. Reply to the user helpfully and concisely.
2. Decide what is worth remembering from this exchange, and return it as a JSON array of memory drafts.

You MUST output ONLY a single JSON object with this exact structure:
{
  "reply": "<your reply to the user>",
  "remember": [
    {
      "kind": "<one of the allowed kinds>",
      "space": "<one of the allowed spaces>",
      "text": "<what to remember — the plaintext memory content>",
      "tags": ["optional", "string", "tags"]
    }
  ]
}

Allowed MemoryKind values: ${kindList}.
Allowed spaces: ${spaceList}.

- "remember" may be an empty array if nothing is worth remembering.
- Each draft must have a non-empty "text".`;
}

/** Format a recalled context hit for the messages. */
function formatContextHit(hit: ContextHit): string {
  return `[${hit.kind}] (score: ${hit.score.toFixed(3)}) ${hit.text}`;
}

/** Build the messages array for the chat completion request. */
export function buildMessages(
  input: string,
  context: RecalledContext,
  systemPrompt: string,
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];

  // System prompt
  messages.push({ role: "system", content: systemPrompt });

  // Recalled context (if any)
  if (context.hits.length > 0) {
    const contextBlock = context.hits.map(formatContextHit).join("\n");
    messages.push({
      role: "system",
      content: `The following are relevant prior memories that may help you:\n${contextBlock}`,
    });
  }

  // User input
  messages.push({ role: "user", content: input });

  return messages;
}

// ---------------------------------------------------------------------------
// Response parsing (exported for unit-testing)
// ---------------------------------------------------------------------------

/** Coerce/validate a raw memory-draft object from the LLM into a MemoryDraft. */
function coerceDraft(
  raw: unknown,
  allowedSpaces: readonly string[],
  firstSpace: string,
): MemoryDraft | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Record<string, unknown>;

  // kind: must be a string in ALLOWED_KINDS; unknown → "fact"
  let kind: MemoryKind;
  if (typeof d.kind === "string" && (ALLOWED_KINDS as readonly string[]).includes(d.kind)) {
    kind = d.kind as MemoryKind;
  } else {
    kind = "fact";
  }

  // space: must be a string in allowedSpaces; disallowed → firstSpace
  let space: string;
  if (typeof d.space === "string" && (allowedSpaces as readonly string[]).includes(d.space)) {
    space = d.space;
  } else {
    space = firstSpace;
  }

  // text: must be non-empty string; empty → drop draft
  if (typeof d.text !== "string" || d.text.trim().length === 0) {
    return null;
  }
  const text = d.text.trim();

  // tags: optional string array
  let tags: string[] | undefined;
  if (Array.isArray(d.tags)) {
    tags = d.tags.filter((t): t is string => typeof t === "string");
    if (tags.length === 0) tags = undefined;
  }

  return { kind, space, text, ...(tags !== undefined ? { tags: tags as readonly string[] } : {}) };
}

/**
 * Parse the model's JSON content string into a BrainTurn.
 * If parsing fails at any level, returns a safe fallback (reply present, remember: [], never throws).
 */
export function parseBrainTurn(
  content: string,
  allowedSpaces: readonly string[],
): BrainTurn {
  const firstSpace = allowedSpaces[0] ?? "default";
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    // Non-JSON content → safe fallback with raw text as reply.
    return {
      reply: content.trim().length > 0 ? content.slice(0, 2000) : "(no content received from model)",
      remember: [],
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return {
      reply: typeof content === "string" && content.trim().length > 0
        ? content.slice(0, 2000)
        : "(model returned non-object response)",
      remember: [],
    };
  }

  const obj = parsed as Record<string, unknown>;

  // reply: string or fallback
  let reply: string;
  if (typeof obj.reply === "string" && obj.reply.length > 0) {
    reply = obj.reply;
  } else {
    // No valid reply → safe fallback
    return {
      reply: "(model did not provide a valid reply)",
      remember: [],
    };
  }

  // remember: array or empty
  let drafts: MemoryDraft[];
  if (Array.isArray(obj.remember)) {
    drafts = obj.remember
      .map((raw) => coerceDraft(raw, allowedSpaces, firstSpace))
      .filter((d): d is MemoryDraft => d !== null);
  } else {
    drafts = [];
  }

  return { reply, remember: drafts };
}

// ---------------------------------------------------------------------------
// OpenAICompatBrain
// ---------------------------------------------------------------------------

/**
 * A `Brain` over an OpenAI-compatible `/chat/completions` endpoint. `turn` builds a memory-aware
 * prompt (system + recalled context + user input), asks the model for a JSON `{reply, remember[]}`,
 * and parses it into a `BrainTurn` (with a safe fallback on malformed output).
 */
export class OpenAICompatBrain implements Brain {
  readonly name: string;

  constructor(private readonly config: OpenAICompatBrainConfig) {
    this.name = `openai-compat:${config.model}`;
  }

  async turn(input: string, context: RecalledContext): Promise<BrainTurn> {
    const spaces = this.config.spaces ?? (["default"] as readonly string[]);
    const systemPrompt = this.config.systemPrompt ?? buildSystemPrompt(spaces);
    const messages = buildMessages(input, context, systemPrompt);
    const fetchFn = this.config.fetchImpl ?? fetch;

    let response: Response;
    try {
      response = await fetchFn(`${this.config.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          response_format: { type: "json_object" },
        }),
      });
    } catch {
      // Network error / fetch throw → safe fallback
      return safeFallback("(network error — could not reach the model)");
    }

    // Non-2xx → safe fallback (apiKey NOT included in reply)
    if (!response.ok) {
      let rawBody = "";
      try {
        rawBody = await response.text();
      } catch {
        // ignore
      }
      return safeFallback(
        `(model API error ${response.status}${rawBody ? ": " + rawBody.slice(0, 200) : ""})`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // Non-JSON response body → safe fallback
      let rawText = "";
      try {
        rawText = await response.clone().text();
      } catch {
        // ignore
      }
      return safeFallback(rawText.length > 0 ? rawText.slice(0, 2000) : "(model returned non-JSON response)");
    }

    // Extract choices[0].message.content
    const obj = body as Record<string, unknown>;
    const choices = obj.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      return safeFallback("(model returned no choices)");
    }
    const choice = choices[0] as Record<string, unknown> | undefined;
    if (!choice) {
      return safeFallback("(model returned empty choice)");
    }
    const message = choice.message as Record<string, unknown> | undefined;
    if (!message || typeof message.content !== "string") {
      return safeFallback("(model returned no message content)");
    }

    return parseBrainTurn(message.content, spaces);
  }
}

/** Convenience: a Brain backed by DeepSeek (api.deepseek.com), default model `deepseek-v4-flash`. */
export function deepseekBrain(
  apiKey: string,
  model = "deepseek-v4-flash",
  extra?: Partial<OpenAICompatBrainConfig>,
): OpenAICompatBrain {
  return new OpenAICompatBrain({ baseURL: "https://api.deepseek.com", model, apiKey, ...extra });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function safeFallback(reply: string): BrainTurn {
  return { reply, remember: [] };
}
