/**
 * L3 Semantic — facade (D7). Wires a `FactExtractor` + a `KnowledgeGraph` into a small semantic
 * memory API. DERIVED, OUT OF ROOT: this module imports L3 types only; it never calls
 * `append`/`checkpoint`, never touches encryption/KEK, and the spine never imports this module.
 * The caller supplies plaintext (or precomputed triples) — Semantic does not decrypt (D6 boundary).
 *
 * ARCHITECT-OWNED CONTRACT. The `Semantic` interface, `SemanticSource`, and the `createSemantic`
 * signature are FROZEN; DeepSeek implements the bodies (docs/TASK-deepseek-L3.md).
 */
import type { Triple, Fact, FactExtractor } from "./fact.js";
import type { KnowledgeGraph, TriplePattern } from "./knowledge-graph.js";

/** Either plaintext to extract triples from, or already-computed triples (caller-supplied). */
export type SemanticSource = { readonly text: string } | { readonly triples: readonly Triple[] };

/**
 * Semantic memory over a vault's objects. `ingestObject` extracts (or accepts) triples for one
 * object and adds them with that object's id as provenance; `rebuild` re-derives the whole graph
 * from a caller-supplied plaintext stream (the graph is a rebuildable projection); `query` and
 * `neighbors` read the graph; `removeObject` drops one object's facts.
 */
export interface Semantic {
  /** Extract/accept triples for `objectId` and add them (provenance = objectId). Returns count added. */
  ingestObject(objectId: string, source: SemanticSource): Promise<number>;
  /** Re-derive the graph from a caller-supplied (objectId, text) stream. Returns total facts. */
  rebuild(objects: AsyncIterable<{ objectId: string; text: string }>): Promise<number>;
  query(pattern: TriplePattern): readonly Fact[];
  neighbors(entity: string): readonly Fact[];
  removeObject(objectId: string): void;
}

/** Construct a Semantic facade over an extractor + graph. */
export function createSemantic(_deps: {
  extractor: FactExtractor;
  graph: KnowledgeGraph;
}): Semantic {
  throw new Error("[TODO_L3] createSemantic not implemented");
}
