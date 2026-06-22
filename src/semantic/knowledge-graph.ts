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
  /** Fact identity: compound key (subject, predicate, object, sourceObjectId). */
  private readonly facts = new Map<string, Fact>();

  private factKey(f: Fact): string {
    return `${f.triple.subject}\x00${f.triple.predicate}\x00${f.triple.object}\x00${f.sourceObjectId}`;
  }

  /** Canonical order: ascending by (subject, predicate, object, sourceObjectId). */
  private canonicalOrder(fs: Fact[]): Fact[] {
    fs.sort((a, b) => {
      const cmp = this.compareStr(a.triple.subject, b.triple.subject);
      if (cmp !== 0) return cmp;
      const cmpP = this.compareStr(a.triple.predicate, b.triple.predicate);
      if (cmpP !== 0) return cmpP;
      const cmpO = this.compareStr(a.triple.object, b.triple.object);
      if (cmpO !== 0) return cmpO;
      return this.compareStr(a.sourceObjectId, b.sourceObjectId);
    });
    return fs;
  }

  private compareStr(a: string, b: string): number {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  addFact(fact: Fact): void {
    this.facts.set(this.factKey(fact), fact);
  }

  removeBySource(sourceObjectId: string): void {
    for (const [key, fact] of this.facts) {
      if (fact.sourceObjectId === sourceObjectId) {
        this.facts.delete(key);
      }
    }
  }

  match(pattern: TriplePattern): readonly Fact[] {
    const all = [...this.facts.values()];
    const filtered = all.filter((f) => {
      if (pattern.subject !== undefined && pattern.subject !== f.triple.subject) return false;
      if (pattern.predicate !== undefined && pattern.predicate !== f.triple.predicate) return false;
      if (pattern.object !== undefined && pattern.object !== f.triple.object) return false;
      return true;
    });
    return this.canonicalOrder(filtered);
  }

  neighbors(entity: string): readonly Fact[] {
    const all = [...this.facts.values()];
    const filtered = all.filter(
      (f) => f.triple.subject === entity || f.triple.object === entity,
    );
    return this.canonicalOrder(filtered);
  }

  entities(): readonly string[] {
    const set = new Set<string>();
    for (const f of this.facts.values()) {
      set.add(f.triple.subject);
      set.add(f.triple.object);
    }
    const arr = [...set];
    arr.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return arr;
  }

  size(): number {
    return this.facts.size;
  }

  clear(): void {
    this.facts.clear();
  }
}
