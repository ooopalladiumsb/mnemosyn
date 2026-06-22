# Mnemosyne L2 — Derived Semantic Recall

**Version:** v0.1-draft · **Status:** DRAFT (migration-hard surface; review before code)
**Depends on:** L0 Spine v0.1 (`MemoryObject`, `object_id`, `vault_memory_root`). Independent of L1.

L0 commits memory; L1 anchors its history. **L2 makes memory findable** — a semantic recall layer
that maps a query to the `object_id`s most similar to it, so a caller can then `spine.recallById`
each. L2 is the first layer ABOVE the commitment line, and its single defining property is what it
must NOT do: **nothing in L2 ever reaches a hashed or anchored byte.**

---

## 1. The commitment line (why L2 is special)

```
  Brain → MemoryObject → deterministic Spine → vault_memory_root → anchor
                              │
                              └→ (derived, NEVER feeds back up)
                                 Embeddings · Recall index           ← L2 lives here
```

L2 is a **rebuildable projection** of the spine. The spine reads nothing from L2; L2 reads only the
spine's immutable output. Break this and "verifiable memory" collapses into ordinary AI memory with
cryptographic decoration. Concretely, L2 holds owner-private embedding vectors (the recall analogue
of the keyed Content-Identity HMAC): useful locally, **never** committed, **never** anchored.

---

## 2. What L2 adds (and deliberately does not)

Adds:
- An **`EmbeddingProvider`** seam — plaintext → dense vector (the recall "Brain"; non-deterministic,
  model-backed implementations ship later) + a **deterministic `HashEmbedder`** reference.
- A **`RecallIndex`** seam — an owner-private vector store keyed by `object_id` + an in-memory
  brute-force cosine reference, **`LocalRecallIndex`**.
- A **`Recall`** facade — `indexObject` / `recall(query, k)` / `rebuild` / `remove`.
- The **out-of-root invariant** as L2's primary acceptance gate (see §6).

Out of scope (later layers): fact extraction / knowledge graph (L3); multi-writer delegation (L4);
ANN/HNSW or on-disk vector backends (a future `RecallIndex` impl behind the same seam); persisting
or syncing the index (it is rebuildable by design); any decryption (see §4).

No new domain tag. **L2 hashes nothing**, so `src/canonical/domains.ts` is NOT touched — the absence
of an L2 domain tag is itself a statement that L2 is out-of-root.

---

## 3. Embedding seam

```
type Embedding = Float32Array            // owner-private, derived, never anchored

interface EmbeddingProvider {
  name: string
  dimension: number                      // fixed; every embed() result has exactly this length
  embed(text): Promise<Embedding>
}
```

- Real providers are non-deterministic and model-dependent → an **untested seam** in L2.
- **`HashEmbedder`** (reference): a fixed, L2-normalized pseudo-vector derived from `SHA-256(text)`.
  NOT semantic — it exists so recall mechanics are byte-reproducible and golden-pinnable (exactly as
  L0 used fixed ciphertext). Same text → same vector, across runs and platforms. The derivation MUST
  be specified deterministically (byte order, normalization) so the golden reproduces everywhere.

---

## 4. Embedding source — caller supplies plaintext (D6)

Embeddings need plaintext; the spine stores ciphertext only. **L2 never decrypts and never holds a
KEK.** The caller — who already has the plaintext at ingest — supplies it (or a precomputed vector):

```
type RecallSource = { text: string } | { vector: Embedding }
Recall.indexObject(objectId, source)     // embed text, or take vector; add under objectId
Recall.recall(query, k)                  // embed query, or take vector; top-k object ids
Recall.rebuild(asyncIterable<{objectId, text}>)   // re-derive whole index from a caller stream
```

This keeps the L2 trust surface minimal: Recall depends on the spine's **types** only, touches no
encryption, and the index stays a pure function of (provider, supplied text/vectors). `rebuild`
makes "rebuildable projection" concrete — the caller streams plaintext back over the spine's objects.

---

## 5. RecallIndex semantics

```
interface ScoredHit { objectId: string; score: number }   // score = cosine similarity in [-1, 1]
interface RecallIndex {
  dimension: number
  add(objectId, vector); remove(objectId); has(objectId); size(); clear()
  query(vector, k): ScoredHit[]          // top-k, DETERMINISTIC tie-break
}
```

- **Dimension:** every vector shares the index `dimension`; a wrong length is `[RECALL_DIM_MISMATCH]`.
- **Upsert:** re-`add` of an existing `objectId` REPLACES its vector (no duplicate entry).
- **Cosine:** `dot(a,b) / (||a|| · ||b||)`; iterate dimensions in index order so summation is fixed
  (float reproducibility). A zero-norm vector yields score 0 (define, don't divide by zero).
- **Top-k tie-break (DETERMINISTIC):** sort by `score` descending, then `objectId` ascending (string
  byte order). `k` larger than `size()` returns all; `k <= 0` returns `[]`.
- **`LocalRecallIndex`:** in-memory brute-force — correctness and determinism over speed (the
  `LocalCAS` of recall). ANN backends are a later impl behind this same seam.

---

## 6. The out-of-root invariant — L2's primary gate

Because embeddings are non-deterministic, L2 is NOT pinned by value golden vectors the way L0/L1 are.
Its load-bearing gate is an **invariant**:

> Indexing, querying, rebuilding, or removing — in any order, on any provider — leaves every spine
> commitment byte-identical. The `vault_memory_root`, every `object_id`, and every `space_state`
> computed for a scenario are EQUAL whether or not L2 ran.

Enforced two ways (both required):
1. **Behavioural:** a test runs a spine scenario, records the root; runs the same scenario while also
   `indexObject`-ing every object and issuing recalls; asserts the root is byte-identical.
2. **Structural:** `src/spine/**` and `src/canonical/**` contain NO import of `../recall` (one-way
   dependency: recall → spine types only, never the reverse). A test/asserted grep guards this.

---

## 7. Determinism boundary & the recall golden

With the deterministic `HashEmbedder`, the index mechanics are fully reproducible, so a
**PRE-NORMATIVE recall golden** pins them: a fixed corpus of texts indexed under fixed object ids,
a fixed set of queries, and for each query the pinned ranked `objectId` list + scores. This pins
cosine + top-k + tie-break (NOT semantics). Floating-point note: compare the ranked `objectId`
order EXACTLY and scores within a tight tolerance (e.g. 1e-12); fix summation order so scores are
stable. Live providers remain non-deterministic and unpinned.

---

## 8. Conformance & gates

L2 is DONE only when all pass:
1. `npm run typecheck` — clean.
2. `npm test` — L0+L1's existing tests stay green (no regression) + new L2 tests.
3. `npm run test:conformance` — unchanged.
4. **Out-of-root invariant** (§6) — behavioural (root index-independent) AND structural (no
   spine→recall import) both pass.
5. **Recall golden** (§7) — deterministic `HashEmbedder` ranking reproduces; `npm run vectors:generate`
   regenerates it byte-identically. PRE-NORMATIVE.
6. No new runtime deps; Node 22 built-ins only; L2 touches no encryption/KEK and no domain tag.

---

## 9. Decision (proposed — ratify before merge)

**D6 (L2 derived recall).** A rebuildable, owner-private semantic recall layer strictly out-of-root:
`EmbeddingProvider` (+ deterministic `HashEmbedder`) and `RecallIndex` (+ brute-force
`LocalRecallIndex`) seams under a `Recall` facade. The caller supplies plaintext/vectors; L2 never
decrypts, never holds a KEK, hashes nothing, anchors nothing, and the spine never depends on it.
Migration-hard surface frozen by D6: `Embedding`, `EmbeddingProvider`, `RecallIndex`/`ScoredHit`,
`Recall`/`RecallSource`/`RecallHit`, and the `createRecall` signature. The out-of-root invariant
(§6) is the controlling acceptance criterion.
