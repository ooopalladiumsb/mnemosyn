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

import { createHash } from "node:crypto";

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
 *
 * ## Derivation (documented for golden reproducibility)
 *
 * 1. Compute `SHA-256(UTF-8(text))` → 32 bytes.
 * 2. If `dimension * 4 > 32`, expand via counter-hashing: for counter i = 1, 2, …,
 *    append `SHA-256(UTF-8(text) || uint32be(i))`. uint32be is a 4-byte big-endian unsigned integer.
 * 3. Take the first `dimension * 4` bytes from the concatenated hash stream.
 * 4. Interpret every 4-byte chunk as a **big-endian** IEEE 754 single-precision float via DataView.
 * 5. L2-normalize: divide every component by the Euclidean norm √(∑ vᵢ²).
 *    If the norm is 0 (empty text or vanishingly unlikely collision), return the zero vector.
 */
export class HashEmbedder implements EmbeddingProvider {
  readonly name = "hash-embedder-v1";
  readonly dimension: number;

  constructor(dimension = 64) {
    this.dimension = dimension;
  }

  async embed(text: string): Promise<Embedding> {
    const neededBytes = this.dimension * 4; // 4 bytes per float32
    const textBytes = new TextEncoder().encode(text);

    // Collect enough raw hash bytes via counter-hashing.
    const raw = new Uint8Array(neededBytes);
    let offset = 0;
    let counter = 0;
    while (offset < neededBytes) {
      let input: Uint8Array;
      if (counter === 0) {
        input = textBytes;
      } else {
        // text || uint32be(counter)
        input = new Uint8Array(textBytes.length + 4);
        input.set(textBytes, 0);
        const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
        view.setUint32(textBytes.length, counter, false); // big-endian
      }
      const hash = new Uint8Array(
        createHash("sha256").update(input).digest(),
      );
      const take = Math.min(hash.length, neededBytes - offset);
      raw.set(hash.subarray(0, take), offset);
      offset += take;
      counter++;
    }

    // Interpret 4-byte chunks as big-endian float32.
    const vec = new Float32Array(this.dimension);
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let i = 0; i < this.dimension; i++) {
      // false = big-endian → identical interpretation across platforms
      let f = dv.getFloat32(i * 4, false);
      // Normalise degenerate values (NaN, ±Infinity) to 0 so the norm is well-defined.
      if (!Number.isFinite(f)) f = 0;
      vec[i] = f;
    }

    // L2-normalize.
    let normSq = 0;
    for (let i = 0; i < this.dimension; i++) {
      normSq += vec[i]! * vec[i]!;
    }
    const norm = Math.sqrt(normSq);
    if (norm === 0) {
      return vec; // all zeros already
    }
    for (let i = 0; i < this.dimension; i++) {
      vec[i] = vec[i]! / norm;
    }
    return vec;
  }
}
