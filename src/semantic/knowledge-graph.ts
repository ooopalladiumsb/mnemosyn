/**
 * L3 Semantic — knowledge graph seam (D7). DERIVED, REBUILDABLE, OUT OF ROOT.
 *
 * A `KnowledgeGraph` is an owner-private store of provenance-tagged triples. It is a rebuildable
 * projection of the spine — the spine NEVER reads from it, and nothing it holds is ever hashed or
 * anchored. `LocalKnowledgeGraph` is the in-memory reference backend (philosophy: `LocalCAS` /
 * `LocalRecallIndex`): correct and deterministic, not optimized.
 *
 * ARCHITECT-OWNED CONTRACT. Interfaces + `LocalKnowledgeGraph` SIGNATURES are FROZEN; DeepSeek
 * implements the bodies (docs/TASK-deepseek-L3.md). New exports allowed; declared shapes are not.
 */
import type { Fact } from "./fact.js";

/** A partial triple; any omitted field is a wildcard that matches anything. */
export interface TriplePattern {
  readonly subject?: string;
  readonly predicate?: string;
  readonly object?: string;
}

/**
 * Provenance-tagged triple store. A `Fact` is identified by (subject, predicate, object,
 * sourceObjectId): re-adding an identical fact is a no-op; the SAME triple from a DIFFERENT source
 * is a distinct fact (provenance is part of identity). All query results are returned in a
 * DETERMINISTIC canonical order: ascending by (subject, predicate, object, sourceObjectId) — string
 * byte order. `entities()` returns the sorted-ascending distinct set of all subjects and objects.
 */
export interface KnowledgeGraph {
  addFact(fact: Fact): void;
  /** Drop every fact whose provenance is `sourceObjectId` (supports rebuild / object removal). */
  removeBySource(sourceObjectId: string): void;
  /** Facts matching a partial triple pattern (omitted fields are wildcards), canonical order. */
  match(pattern: TriplePattern): readonly Fact[];
  /** Facts where `entity` appears as subject OR object, canonical order. */
  neighbors(entity: string): readonly Fact[];
  /** Distinct subjects ∪ objects, ascending. */
  entities(): readonly string[];
  /** Number of distinct facts held. */
  size(): number;
  clear(): void;
}

/** In-memory reference knowledge graph. Deterministic; correctness over speed. */
export class LocalKnowledgeGraph implements KnowledgeGraph {
  addFact(_fact: Fact): void {
    throw new Error("[TODO_L3] LocalKnowledgeGraph.addFact not implemented");
  }

  removeBySource(_sourceObjectId: string): void {
    throw new Error("[TODO_L3] LocalKnowledgeGraph.removeBySource not implemented");
  }

  match(_pattern: TriplePattern): readonly Fact[] {
    throw new Error("[TODO_L3] LocalKnowledgeGraph.match not implemented");
  }

  neighbors(_entity: string): readonly Fact[] {
    throw new Error("[TODO_L3] LocalKnowledgeGraph.neighbors not implemented");
  }

  entities(): readonly string[] {
    throw new Error("[TODO_L3] LocalKnowledgeGraph.entities not implemented");
  }

  size(): number {
    throw new Error("[TODO_L3] LocalKnowledgeGraph.size not implemented");
  }

  clear(): void {
    throw new Error("[TODO_L3] LocalKnowledgeGraph.clear not implemented");
  }
}
