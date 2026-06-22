/**
 * L2 Recall — embedding seam (D6). DERIVED, OUT OF ROOT.
 *
 * An `EmbeddingProvider` maps plaintext → a dense vector. It is the recall analogue of the Brain
 * (`LLMProvider`) seam: generally NON-DETERMINISTIC and model-dependent, and it lives ENTIRELY
 * outside the hashed root. Embeddings are owner-private (like the Content-Identity HMAC) and are
 * NEVER anchored. The spine never reads an embedding.
 *
 * ARCHITECT-OWNED CONTRACT. The interfaces and the `HashEmbedder` SIGNATURES below are FROZEN;
 * DeepSeek implements the bodies (see docs/TASK-deepseek-L2.md). New exports may be added; the
 * declared names/shapes/signatures may not change.
 */

/** A dense embedding vector. Owner-private, derived, NEVER part of any commitment. */
export type Embedding = Float32Array;

/**
 * The recall Brain seam: plaintext → dense vector. Real implementations (model/network-backed)
 * are non-deterministic and ship later; they are an untested seam in L2. `dimension` is fixed per
 * provider and every returned vector MUST have exactly that length.
 */
export interface EmbeddingProvider {
  readonly name: string;
  readonly dimension: number;
  embed(text: string): Promise<Embedding>;
}

/**
 * Deterministic reference embedder for tests / standalone wiring. Derives a fixed, L2-normalized
 * pseudo-vector from SHA-256 of the text. It is NOT semantic — it exists so recall mechanics
 * (cosine, top-k, tie-break, the out-of-root invariant) are byte-reproducible and golden-pinnable,
 * exactly as L0 used fixed ciphertext. Same text → same vector, across runs and platforms.
 */
export class HashEmbedder implements EmbeddingProvider {
  readonly name = "hash-embedder-v1";
  readonly dimension: number;

  constructor(dimension = 64) {
    this.dimension = dimension;
  }

  async embed(_text: string): Promise<Embedding> {
    throw new Error("[TODO_L2] HashEmbedder.embed not implemented");
  }
}
