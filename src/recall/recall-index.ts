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

  constructor(dimension: number) {
    this.dimension = dimension;
  }

  add(_objectId: string, _vector: Embedding): void {
    throw new Error("[TODO_L2] LocalRecallIndex.add not implemented");
  }

  remove(_objectId: string): void {
    throw new Error("[TODO_L2] LocalRecallIndex.remove not implemented");
  }

  has(_objectId: string): boolean {
    throw new Error("[TODO_L2] LocalRecallIndex.has not implemented");
  }

  size(): number {
    throw new Error("[TODO_L2] LocalRecallIndex.size not implemented");
  }

  query(_vector: Embedding, _k: number): readonly ScoredHit[] {
    throw new Error("[TODO_L2] LocalRecallIndex.query not implemented");
  }

  clear(): void {
    throw new Error("[TODO_L2] LocalRecallIndex.clear not implemented");
  }
}
