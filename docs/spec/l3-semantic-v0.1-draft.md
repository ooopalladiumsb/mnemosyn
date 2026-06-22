# Mnemosyne L3 — Derived Semantic Memory (facts + knowledge graph)

**Version:** v0.1-draft · **Status:** DRAFT (migration-hard surface; review before code)
**Depends on:** L0 Spine v0.1 (`MemoryObject`, `object_id`, `vault_memory_root`). Independent of L1/L2.

L2 makes memory findable by similarity; **L3 makes it queryable by structure.** It extracts
provenance-tagged triples `(subject, predicate, object)` from object plaintext and assembles them
into an owner-private knowledge graph. Like L2 it is the second layer ABOVE the commitment line, and
its defining property is the same: **nothing in L3 ever reaches a hashed or anchored byte.**

---

## 1. The commitment line (why L3 is special)

```
  Brain → MemoryObject → deterministic Spine → vault_memory_root → anchor
                              │
                              └→ (derived, NEVER feeds back up)
                                 Embeddings (L2) · Facts + Knowledge Graph (L3)
```

L3 is a **rebuildable projection** of the spine. The spine reads nothing from L3; L3 reads only the
spine's immutable output (via the caller). Every fact carries the `object_id` it came from
(provenance), so the whole graph can be re-derived by re-extracting from plaintext. Facts are
owner-private (like L2 vectors and the keyed Content-Identity HMAC): **never** committed, **never**
anchored.

---

## 2. What L3 adds (and deliberately does not)

Adds:
- A **`FactExtractor`** seam — plaintext → triples (the fact "Brain"; non-deterministic, model-backed
  implementations ship later) + a **deterministic `DelimitedExtractor`** reference.
- A **`KnowledgeGraph`** seam — an owner-private provenance-tagged triple store + an in-memory
  reference, **`LocalKnowledgeGraph`**.
- A **`Semantic`** facade — `ingestObject` / `rebuild` / `query` / `neighbors` / `removeObject`.
- The **out-of-root invariant** as L3's primary acceptance gate (see §6).

Out of scope (later/never): multi-hop traversal / path queries (v1 is triple `match` + 1-hop
`neighbors`); entity typing / relation attributes (D7 fixes the model at PLAIN triples — a richer
model is a future Decision Record, not a silent extension); ranking/inference over the graph;
persistence (the graph is rebuildable by design); any decryption (see §4).

No new domain tag. **L3 hashes nothing**, so `src/canonical/domains.ts` is NOT touched — the absence
of an L3 domain tag is itself a statement that L3 is out-of-root.

---

## 3. Fact model (D7 — plain triples)

```
interface Triple { subject: string; predicate: string; object: string }   // entities = plain strings
interface Fact   { triple: Triple; sourceObjectId: string }               // provenance
```

A `Fact` is identified by `(subject, predicate, object, sourceObjectId)`. The SAME triple asserted by
TWO objects is TWO facts (provenance is part of identity); re-adding an identical fact is a no-op.

```
interface FactExtractor { name: string; extract(text): Promise<Triple[]> }
```

- Real extractors are non-deterministic and model-dependent → an **untested seam** in L3.
- **`DelimitedExtractor`** (reference): parses each line `subject<delim>predicate<delim>object`
  (default delim = TAB) into a triple; a line that does not split into exactly three non-empty
  (trimmed) fields is skipped; order is preserved. NOT real NLP — it exists so graph mechanics are
  byte-reproducible and golden-pinnable (exactly as L0 used fixed ciphertext, L2 used `HashEmbedder`).
  Same text → same ordered triples, across runs and platforms. Document the exact parse in NOTES.

---

## 4. Source — caller supplies plaintext (inherits D6)

Extraction needs plaintext; the spine stores ciphertext only. **L3 never decrypts and never holds a
KEK** (the L2/D6 boundary). The caller — who has the plaintext at ingest — supplies it (or triples):

```
type SemanticSource = { text: string } | { triples: Triple[] }
Semantic.ingestObject(objectId, source)   // extract/accept triples, add with provenance = objectId
Semantic.rebuild(asyncIterable<{objectId, text}>)   // re-derive whole graph from a caller stream
Semantic.query(pattern) / neighbors(entity) / removeObject(objectId)
```

`rebuild` makes "rebuildable projection" concrete — the caller streams plaintext back over the
spine's objects; `removeObject` drops one object's facts via `removeBySource`.

---

## 5. KnowledgeGraph semantics

```
interface TriplePattern { subject?; predicate?; object? }   // omitted field = wildcard
interface KnowledgeGraph {
  addFact(fact); removeBySource(sourceObjectId); entities(); size(); clear()
  match(pattern): Fact[]          // facts matching the partial pattern
  neighbors(entity): Fact[]       // facts where entity is subject OR object
}
```

- **Dedup:** identity = `(subject, predicate, object, sourceObjectId)`; re-add is a no-op; `size()`
  counts distinct facts.
- **Canonical order (DETERMINISTIC):** every `match`/`neighbors` result is sorted ascending by
  `(subject, predicate, object, sourceObjectId)` in string byte order. `entities()` returns the
  distinct subjects ∪ objects, ascending. Determinism is what makes the golden (§7) reproducible.
- **`match` wildcards:** an omitted pattern field matches anything; an all-empty pattern returns all
  facts (canonical order).
- **`LocalKnowledgeGraph`:** in-memory reference — correctness and determinism over speed (the
  `LocalCAS` / `LocalRecallIndex` of the graph).

---

## 6. The out-of-root invariant — L3's primary gate

Because extraction is non-deterministic, L3 is NOT pinned by value golden vectors the way L0/L1 are.
Its load-bearing gate is an **invariant** (identical in spirit to L2 §6):

> Extracting, ingesting, querying, rebuilding, or removing — in any order, on any extractor — leaves
> every spine commitment byte-identical. The `vault_memory_root`, every `object_id`, and every
> `space_state` for a scenario are EQUAL whether or not L3 ran.

Enforced two ways (both required):
1. **Behavioural:** run a spine scenario, record the root (+ an `object_id` and `space_state`); run
   the same scenario while also `ingestObject`-ing every object and issuing queries; assert all three
   are byte-identical with vs without L3.
2. **Structural:** `src/spine/**` and `src/canonical/**` contain NO import of `../semantic` (one-way
   dependency: semantic → spine types only, never the reverse). A test/asserted read guards this.

---

## 7. Determinism boundary & the semantic golden

With the deterministic `DelimitedExtractor`, the graph mechanics are fully reproducible, so a
**PRE-NORMATIVE semantic golden** pins them: a fixed corpus of `{objectId, text}` (text carrying
delimited triples), the extracted facts, and for a fixed set of `match`/`neighbors`/`entities`
queries the pinned (canonically ordered) results. This pins extraction + dedup + match + ordering
(NOT semantics). All values are strings → exact comparison (no float tolerance needed). Live
extractors remain non-deterministic and unpinned.

---

## 8. Conformance & gates

L3 is DONE only when all pass:
1. `npm run typecheck` — clean.
2. `npm test` — L0+L1+L2's existing tests stay green (no regression) + new L3 tests.
3. `npm run test:conformance` — unchanged.
4. **Out-of-root invariant** (§6) — behavioural (root index-independent) AND structural (no
   spine→semantic import) both pass.
5. **Semantic golden** (§7) — deterministic `DelimitedExtractor` graph reproduces; `npm run
   vectors:generate` regenerates it byte-identically. PRE-NORMATIVE.
6. No new runtime deps; Node 22 built-ins only; L3 touches no encryption/KEK and no domain tag.

---

## 9. Decision (proposed — ratify before merge)

**D7 (L3 derived semantic memory).** A rebuildable, owner-private fact+graph layer strictly
out-of-root: `FactExtractor` (+ deterministic `DelimitedExtractor`) and `KnowledgeGraph`
(+ in-memory `LocalKnowledgeGraph`) seams under a `Semantic` facade. The fact model is **plain
triples** `(subject, predicate, object)` + `sourceObjectId` provenance; v1 query surface is
`match(pattern)` + 1-hop `neighbors` + `entities` (multi-hop traversal and entity typing are
deferred to a future Decision Record). The caller supplies plaintext/triples; L3 never decrypts,
never holds a KEK, hashes nothing, anchors nothing, and the spine never depends on it. Migration-hard
surface frozen by D7: `Triple`/`Fact`, `FactExtractor`, `KnowledgeGraph`/`TriplePattern`,
`Semantic`/`SemanticSource`, and the `createSemantic` signature. The out-of-root invariant (§6) is
the controlling acceptance criterion.
