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
import type { Brain, BrainTurn, RecalledContext } from "./brain.js";

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

  async turn(_input: string, _context: RecalledContext): Promise<BrainTurn> {
    void this.config; // body (TASK-deepseek-D12) reads config (baseURL/model/apiKey/fetchImpl/…)
    throw new Error("[TODO_D12] OpenAICompatBrain.turn not implemented");
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
