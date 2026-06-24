/**
 * D12.2 — a LIVE `EmbeddingProvider` over any OpenAI-compatible `/embeddings` API (the first real,
 * semantic embedder; `HashEmbedder` is the deterministic non-semantic reference). Provider-agnostic:
 * `baseURL` + `model` + `apiKey` + `dimension` from config, so Gemini / Jina / Qwen / OpenAI / a local
 * server all plug in by config — switching providers is a config change, never code. DeepSeek's API
 * has no embeddings endpoint, so this uses a separate embeddings provider (free tiers: Gemini, Jina).
 *
 * Stays out-of-root (L2/D6): embeddings are owner-private, derived, NEVER hashed/anchored; the spine
 * never reads one. Real network calls are non-deterministic (untested seam); the response-parse is the
 * testable surface (injected `fetchImpl` with canned responses).
 *
 * ARCHITECT-OWNED CONTRACT. `OpenAICompatEmbedderConfig`, `OpenAICompatEmbedder`, and the factories
 * are FROZEN; DeepSeek implements the `embed` body (docs/TASK-deepseek-D12.2.md).
 */
import type { EmbeddingProvider, Embedding } from "./embedding.js";

/** Wiring for an OpenAI-compatible `/embeddings` provider. `fetchImpl` is injectable for tests. */
export interface OpenAICompatEmbedderConfig {
  readonly baseURL: string; // e.g. "https://api.jina.ai/v1"
  readonly model: string; // e.g. "jina-embeddings-v3"
  readonly apiKey: string;
  readonly dimension: number; // MUST equal the returned vector length and the RecallIndex dimension
  readonly fetchImpl?: typeof fetch;
}

/**
 * A `EmbeddingProvider` that POSTs `{baseURL}/embeddings` and parses `data[0].embedding` into a
 * `Float32Array` of exactly `dimension` floats. Throws `[EMBED_DIM_MISMATCH]` if the API returns a
 * different length, `[EMBED_FAILED]` on a non-2xx / network / malformed response (apiKey never leaked).
 */
export class OpenAICompatEmbedder implements EmbeddingProvider {
  readonly name: string;
  readonly dimension: number;

  constructor(private readonly config: OpenAICompatEmbedderConfig) {
    this.name = `openai-compat:${config.model}`;
    this.dimension = config.dimension;
  }

  async embed(text: string): Promise<Embedding> {
    const fetchFn = this.config.fetchImpl ?? fetch;

    let response: Response;
    try {
      response = await fetchFn(`${this.config.baseURL}/embeddings`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: this.config.model, input: text }),
      });
    } catch {
      throw new Error("[EMBED_FAILED] network error — could not reach the embeddings API");
    }

    if (!response.ok) {
      let snippet = "";
      try {
        snippet = (await response.text()).slice(0, 200);
      } catch {
        // ignore
      }
      throw new Error(
        `[EMBED_FAILED] API returned ${response.status}${snippet ? ": " + snippet : ""}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error("[EMBED_FAILED] non-JSON response from embeddings API");
    }

    const obj = body as Record<string, unknown>;
    const data = obj.data;
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("[EMBED_FAILED] empty or missing data array in embeddings response");
    }

    const first = data[0] as Record<string, unknown> | undefined;
    if (!first || !Array.isArray(first.embedding)) {
      throw new Error("[EMBED_FAILED] missing or non-array embedding in response");
    }

    const vec = Float32Array.from(first.embedding as number[]);
    if (vec.length !== this.dimension) {
      throw new Error(
        `[EMBED_DIM_MISMATCH] expected dimension ${this.dimension}, got ${vec.length}`,
      );
    }

    return vec;
  }
}

/** Convenience: Google Gemini embeddings (OpenAI-compat endpoint). Free tier. Default 768-dim. */
export function geminiEmbedder(
  apiKey: string,
  model = "text-embedding-004",
  dimension = 768,
  extra?: Partial<OpenAICompatEmbedderConfig>,
): OpenAICompatEmbedder {
  return new OpenAICompatEmbedder({
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    model,
    apiKey,
    dimension,
    ...extra,
  });
}

/** Convenience: Jina AI embeddings (OpenAI-compatible). Free tier. Default 1024-dim. */
export function jinaEmbedder(
  apiKey: string,
  model = "jina-embeddings-v3",
  dimension = 1024,
  extra?: Partial<OpenAICompatEmbedderConfig>,
): OpenAICompatEmbedder {
  return new OpenAICompatEmbedder({
    baseURL: "https://api.jina.ai/v1",
    model,
    apiKey,
    dimension,
    ...extra,
  });
}
