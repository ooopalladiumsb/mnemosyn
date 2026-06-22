/**
 * L2 Recall — facade (D6). Wires an `EmbeddingProvider` + a `RecallIndex` into a small semantic
 * recall API. DERIVED, OUT OF ROOT: this module imports the spine's TYPES only; it never calls
 * `append`/`checkpoint`, never touches encryption/KEK, and the spine never imports this module.
 * The caller supplies plaintext (or a precomputed vector) — Recall does not decrypt.
 *
 * ARCHITECT-OWNED CONTRACT. The `Recall` interface, `RecallSource`, and the `createRecall`
 * signature are FROZEN; DeepSeek implements the bodies (docs/TASK-deepseek-L2.md).
 */
import type { Embedding, EmbeddingProvider } from "./embedding.js";
import type { RecallIndex } from "./recall-index.js";

/** Either raw plaintext to embed, or an already-computed vector (caller-supplied; no decryption). */
export type RecallSource = { readonly text: string } | { readonly vector: Embedding };

/** One recall result: the object id to fetch via `spine.recallById`, plus its similarity score. */
export interface RecallHit {
  readonly objectId: string;
  readonly score: number;
}

/**
 * Semantic recall over a vault's objects. `indexObject` adds/updates one object's vector;
 * `recall` returns the top-k object ids for a query; `rebuild` re-derives the whole index from a
 * caller-supplied plaintext source (the index is a rebuildable projection); `remove` drops one.
 */
export interface Recall {
  indexObject(objectId: string, source: RecallSource): Promise<void>;
  recall(query: RecallSource, k: number): Promise<readonly RecallHit[]>;
  /** Re-derive the index from scratch over a caller-supplied (objectId, text) stream. Returns count. */
  rebuild(objects: AsyncIterable<{ objectId: string; text: string }>): Promise<number>;
  remove(objectId: string): void;
}

/** Construct a Recall facade over a provider + index. Their `dimension`s MUST match. */
export function createRecall(deps: {
  embedder: EmbeddingProvider;
  index: RecallIndex;
}): Recall {
  if (deps.embedder.dimension !== deps.index.dimension) {
    throw new Error(
      `[RECALL_DIM_MISMATCH] embedder dimension ${deps.embedder.dimension} ≠ index dimension ${deps.index.dimension}`,
    );
  }

  const { embedder, index } = deps;

  /** Resolve a RecallSource to an Embedding. If `{text}`, embed it; if `{vector}`, use it. */
  async function resolve(source: RecallSource): Promise<Embedding> {
    if ("text" in source) {
      return embedder.embed(source.text);
    }
    return source.vector;
  }

  return {
    async indexObject(objectId: string, source: RecallSource): Promise<void> {
      const vec = await resolve(source);
      index.add(objectId, vec);
    },

    async recall(query: RecallSource, k: number): Promise<readonly RecallHit[]> {
      const vec = await resolve(query);
      return index.query(vec, k).map((h) => ({ objectId: h.objectId, score: h.score }));
    },

    async rebuild(
      objects: AsyncIterable<{ objectId: string; text: string }>,
    ): Promise<number> {
      index.clear();
      let count = 0;
      for await (const { objectId, text } of objects) {
        const vec = await embedder.embed(text);
        index.add(objectId, vec);
        count++;
      }
      return count;
    },

    remove(objectId: string): void {
      index.remove(objectId);
    },
  };
}
