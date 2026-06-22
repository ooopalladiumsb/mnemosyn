# TASK — DeepSeek (Senior Technical Executor): implement Mnemosyne L2 Recall

**From:** Lead Architect · **Date:** 2026-06-22 · **Project:** `projects/mnemosyne/`
**Agent:** `main` (deepseek-v4-pro)

**Authoritative specs (read first, in order):**
1. `README.md` — charter & invariants (the commitment line; derived index is OUT of root)
2. `docs/spec/l2-recall-v0.1-draft.md` — L2 spec (this task implements it)
3. `docs/spec/l0-spine-v0.1-draft.md` — L0 spine (what recall projects over: `object_id`, root)
4. `docs/NOTES-deepseek.md` + `docs/NOTES-deepseek-L1.md` — your own L0/L1 style + precedents

You implement **bodies and tests**. The architect owns the **contracts**. The skeleton already
typechecks with `TODO`/`throw` stubs (`npm run typecheck` passes). Replace every stub with a real
implementation. When done, all gates in §3 must pass.

---

## 0. Rules of engagement (hard constraints)

1. DO NOT change frozen contracts — type names, field names, signatures. Frozen for L2:
   - `src/recall/embedding.ts` — `Embedding`, `EmbeddingProvider`, `HashEmbedder` constructor +
     `embed` signature
   - `src/recall/recall-index.ts` — `ScoredHit`, `RecallIndex`, `LocalRecallIndex` signatures
   - `src/recall/recall.ts` — `RecallSource`, `RecallHit`, `Recall`, `createRecall` signature
   - **What "frozen" means:** the EXISTING names/shapes/signatures are immutable. Adding a NEW
     export or private helper is allowed; altering or reordering a declared one is not.
2. **OUT-OF-ROOT IS ABSOLUTE.** L2 must not change ANY hashed value. Do NOT edit `src/spine/**`,
   `src/canonical/**`, `src/crypto/**`, or `src/canonical/domains.ts`. L2 hashes nothing and adds no
   domain tag. `recall` imports the spine's TYPES only (and only if needed) — never the reverse.
3. L2 NEVER decrypts and NEVER holds a KEK. The caller supplies plaintext or a precomputed vector
   (`RecallSource`). Do not import or call `crypto/encryption`.
4. If you think a contract is wrong, STOP and write the objection in `docs/NOTES-deepseek-L2.md` — do
   not silently "fix" it. (Your L0 `created_at` objection is the model.)
5. No new runtime dependencies. Node 22 built-ins only (`node:crypto` for `HashEmbedder`'s SHA-256).
   Dev-only `tsx`/`typescript` already present.
6. Determinism where it matters: `HashEmbedder` and all cosine/top-k math must be reproducible
   (fixed dimension iteration order; no `Math.random`, no wall-clock). Real providers stay a seam.

---

## 1. Bodies to implement

`src/recall/embedding.ts` — `HashEmbedder`
- `embed(text)`: derive a deterministic `Float32Array` of length `this.dimension` from `SHA-256`
  of the UTF-8 text (expand via counter-hashing if `dimension*4 > 32` bytes), then **L2-normalize**
  (divide by Euclidean norm; if norm is 0, return the zero vector). Document the exact derivation in
  NOTES so the golden is reproducible. Same text → identical vector every run.

`src/recall/recall-index.ts` — `LocalRecallIndex`
- `add/remove/has/size/clear` over an internal `Map<string, Embedding>`. `add` REPLACES on an
  existing `objectId` (upsert, no duplicate). `add` throws `[RECALL_DIM_MISMATCH]` if
  `vector.length !== this.dimension`.
- `query(vector, k)`: throws `[RECALL_DIM_MISMATCH]` on wrong query length; `k <= 0` → `[]`; cosine
  similarity vs every stored vector (iterate dims in order; zero-norm → score 0); return top-k with
  tie-break **score desc, then objectId asc**. `k > size()` returns all (sorted).

`src/recall/recall.ts` — `createRecall({ embedder, index })`
- Throw `[RECALL_DIM_MISMATCH]` at construction if `embedder.dimension !== index.dimension`.
- `indexObject(objectId, source)`: resolve `source` to a vector (`embedder.embed(text)` or the given
  `vector`), then `index.add(objectId, vector)`.
- `recall(query, k)`: resolve `query` to a vector, return `index.query(...)` mapped to `RecallHit`.
- `rebuild(asyncIterable)`: `index.clear()`, then for each `{objectId, text}` embed + add; return the
  count indexed.
- `remove(objectId)`: `index.remove(objectId)`.

---

## 2. Required tests (write these, under `test/`, e.g. `test/recall-l2.test.ts`)

1. `HashEmbedder`: deterministic (same text → identical vector across two instances); correct length;
   L2-normalized (‖v‖ ≈ 1 for non-empty text) within 1e-6; different text → different vector.
2. `LocalRecallIndex`: add/has/size/remove/clear; upsert replaces (size stable, vector updated);
   `add`/`query` dim-mismatch throw `[RECALL_DIM_MISMATCH]`.
3. `query` ranking: a query identical to a stored vector ranks that object first with score ≈ 1;
   top-k respects `k`; `k<=0` → `[]`; `k>size` → all.
4. **Tie-break determinism:** two objects with identical vectors (equal score) come back in
   `objectId` ascending order, stably across runs.
5. `createRecall`: dim-mismatch embedder/index throws; `indexObject` with `{text}` and with
   `{vector}` both work; `recall` returns ranked `RecallHit`s; `remove` drops an object.
6. `rebuild`: from an async stream of `{objectId, text}` reproduces the same index as incremental
   `indexObject` calls (same query → same ranking); returns the right count; clears prior state.
7. **OUT-OF-ROOT invariant (the load-bearing test, §6 of the spec):** run an L0 spine scenario
   (reuse `scripts/spine-scenario.ts` / the L0 helpers), record `vault_memory_root` (+ an
   `object_id` and `space_state`); run the SAME scenario while also building a `Recall` over every
   object and issuing recalls; assert all three are byte-identical with vs without L2.
8. **OUT-OF-ROOT structural:** assert no source under `src/spine/` or `src/canonical/` imports
   `recall` (read the files, fail on a `recall` import). One-way dependency.

## 2.1 Recall golden (anti-drift, PRE-NORMATIVE)

Extend the vector generator + a golden test to pin the deterministic mechanics: a FIXED `HashEmbedder`
(fixed dimension), a FIXED corpus of `{objectId, text}`, and a FIXED set of queries → for each query
the pinned ranked `objectId` list and scores. The golden test reproduces it: compare the ranked
`objectId` order EXACTLY and scores within 1e-12. Add it as `vectors/recall/golden.json` (a third
sibling to `spine/` and `anchor/`); wire `scripts/recall-scenario.ts` + extend
`scripts/generate-vectors.ts` so `npm run vectors:generate` produces all three byte-identically.
Mark `_status` PRE-NORMATIVE. Document the `HashEmbedder` derivation in NOTES.

---

## 3. Acceptance gates (all must pass — do not report done on red)

```
npm run typecheck
npm test                 # all existing 72 (36 L0 + 9 conformance + 27 L1) stay green + new L2, 0 fail
npm run test:conformance # unchanged (the same 9 conformance tests)
npm run vectors:generate # regenerates spine + anchor + recall golden; golden tests then match
```

Run the gates via the **npm scripts exactly as written** (`node:test`). Do NOT substitute
`bun test`. Also confirm by inspection: no edits under `src/spine`, `src/canonical`, `src/crypto`;
no domain tag added; no encryption/KEK use in `src/recall`; no new runtime deps; the out-of-root
invariant (§6) holds behaviourally AND structurally.

---

## 4. NOTES (required deliverable)

Write `docs/NOTES-deepseek-L2.md`: one entry per non-obvious decision —
- the exact `HashEmbedder` derivation (hash → bytes → floats → normalization; counter expansion);
- cosine summation order + zero-norm handling + the tie-break;
- how the out-of-root invariant test is constructed (what it holds equal);
- where the recall golden lives and the float-comparison tolerance you chose.
Then any **objection** (raise, don't silently fix). End with the gate results (counts) and the list
of files you touched.

You do not commit, push, or alter git history. Stay inside `projects/mnemosyne/`.
