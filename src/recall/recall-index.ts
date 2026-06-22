/**
 * L2 Recall — vector index seam (D6). DERIVED, REBUILDABLE, OUT OF ROOT.
 *
 * A `RecallIndex` is an owner-private vector store keyed by `object_id`. It is a rebuildable
 * projection of the spine — the spine NEVER reads from it, and nothing it holds is ever hashed or
 * anchored. `LocalRecallIndex` is the in-memory brute-force cosine reference backend (philosophy:
 * `LocalCAS` for storage): correct and deterministic, not optimized.
 *
 * ARCHITECT-OWNED CONTRACT. Interfaces + `LocalRecallIndex` SIGNATURES are FROZEN; DeepSeek
 * implements the bodies (docs/TASK-deepseek-L2.md). New exports allowed; declared shapes are not.
 */
import type { Embedding } from "./embedding.js";

/** One ranked recall hit. `score` is cosine similarity in [-1, 1] (1 = identical direction). */
export interface ScoredHit {
  readonly objectId: string;
  readonly score: number;
}

/**
 * Derived vector store over object ids. All vectors share one fixed `dimension`; adding a vector
 * of a different length is an error (`[RECALL_DIM_MISMATCH]`). `query` returns the top-k by cosine
 * similarity with a DETERMINISTIC tie-break: score descending, then `objectId` ascending (byte
 * order). A re-`add` of an existing `objectId` replaces its vector (no duplicate entry).
 */
export interface RecallIndex {
  readonly dimension: number;
  add(objectId: string, vector: Embedding): void;
  remove(objectId: string): void;
  has(objectId: string): boolean;
  size(): number;
  /** Top-k by cosine similarity, deterministic tie-break (score desc, then objectId asc). */
  query(vector: Embedding, k: number): readonly ScoredHit[];
  clear(): void;
}

/** In-memory brute-force cosine reference index. Deterministic; correctness over speed. */
export class LocalRecallIndex implements RecallIndex {
  readonly dimension: number;
  private readonly store = new Map<string, Embedding>();

  constructor(dimension: number) {
    this.dimension = dimension;
  }

  add(objectId: string, vector: Embedding): void {
    if (vector.length !== this.dimension) {
      throw new Error(
        `[RECALL_DIM_MISMATCH] expected dimension ${this.dimension}, got ${vector.length}`,
      );
    }
    this.store.set(objectId, vector);
  }

  remove(objectId: string): void {
    this.store.delete(objectId);
  }

  has(objectId: string): boolean {
    return this.store.has(objectId);
  }

  size(): number {
    return this.store.size;
  }

  /** Top-k by cosine similarity, deterministic tie-break (score desc, then objectId asc). */
  query(vector: Embedding, k: number): readonly ScoredHit[] {
    if (vector.length !== this.dimension) {
      throw new Error(
        `[RECALL_DIM_MISMATCH] expected dimension ${this.dimension}, got ${vector.length}`,
      );
    }
    if (k <= 0) return [];

    // Precompute query norm.
    let queryNormSq = 0;
    for (let i = 0; i < this.dimension; i++) {
      queryNormSq += vector[i]! * vector[i]!;
    }
    const queryNorm = Math.sqrt(queryNormSq);

    const hits: ScoredHit[] = [];
    for (const [objectId, stored] of this.store) {
      // Dot product.
      let dot = 0;
      for (let i = 0; i < this.dimension; i++) {
        dot += vector[i]! * stored[i]!;
      }

      // Cosine: store norm.
      let storeNormSq = 0;
      for (let i = 0; i < this.dimension; i++) {
        storeNormSq += stored[i]! * stored[i]!;
      }
      const storeNorm = Math.sqrt(storeNormSq);

      let score: number;
      if (queryNorm === 0 || storeNorm === 0) {
        score = 0;
      } else {
        score = dot / (queryNorm * storeNorm);
      }
      hits.push({ objectId, score });
    }

    // Sort: score desc, then objectId asc (deterministic tie-break).
    hits.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      // objectId ascending (string byte-order comparison)
      if (a.objectId < b.objectId) return -1;
      if (a.objectId > b.objectId) return 1;
      return 0;
    });

    const limit = k < hits.length ? k : hits.length;
    return hits.slice(0, limit);
  }

  clear(): void {
    this.store.clear();
  }
}
