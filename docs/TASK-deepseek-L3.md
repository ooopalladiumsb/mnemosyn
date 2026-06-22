# TASK — DeepSeek (Senior Technical Executor): implement Mnemosyne L3 Semantic

**From:** Lead Architect · **Date:** 2026-06-22 · **Project:** `projects/mnemosyne/`
**Agent:** `main` (deepseek-v4-pro)

**Authoritative specs (read first, in order):**
1. `README.md` — charter & invariants (the commitment line; derived index is OUT of root)
2. `docs/spec/l3-semantic-v0.1-draft.md` — L3 spec (this task implements it)
3. `docs/spec/l0-spine-v0.1-draft.md` — L0 spine (what the graph projects over: `object_id`, root)
4. `docs/NOTES-deepseek-L2.md` — your own L2 precedents (out-of-root invariant, golden, style)

You implement **bodies and tests**. The architect owns the **contracts**. The skeleton already
typechecks with `TODO`/`throw` stubs (`npm run typecheck` passes). Replace every stub with a real
implementation. When done, all gates in §3 must pass.

---

## 0. Rules of engagement (hard constraints)

1. DO NOT change frozen contracts — type names, field names, signatures. Frozen for L3:
   - `src/semantic/fact.ts` — `Triple`, `Fact`, `FactExtractor`, `DelimitedExtractor` ctor + `extract`
   - `src/semantic/knowledge-graph.ts` — `TriplePattern`, `KnowledgeGraph`, `LocalKnowledgeGraph` sigs
   - `src/semantic/semantic.ts` — `SemanticSource`, `Semantic`, `createSemantic` signature
   - **What "frozen" means:** the EXISTING names/shapes/signatures are immutable. Adding a NEW export
     or private helper is allowed; altering or reordering a declared one is not.
2. **OUT-OF-ROOT IS ABSOLUTE.** L3 must not change ANY hashed value. Do NOT edit `src/spine/**`,
   `src/canonical/**`, `src/crypto/**`, or `src/canonical/domains.ts`. L3 hashes nothing and adds no
   domain tag. `semantic` imports the spine's TYPES only (and only if needed) — never the reverse.
3. L3 NEVER decrypts and NEVER holds a KEK (the D6 boundary). The caller supplies plaintext or
   triples (`SemanticSource`). Do not import or call `crypto/encryption`.
4. If you think a contract is wrong, STOP and write the objection in `docs/NOTES-deepseek-L3.md` — do
   not silently "fix" it.
5. No new runtime dependencies. Node 22 built-ins only. Dev-only `tsx`/`typescript` already present.
6. Determinism where it matters: `DelimitedExtractor` parsing and all graph ordering must be
   reproducible (no `Math.random`, no wall-clock; fixed canonical sort).

---

## 1. Bodies to implement

`src/semantic/fact.ts` — `DelimitedExtractor`
- `extract(text)`: split `text` on `\n`; for each line, split on `this.delimiter` into fields; trim
  each; if EXACTLY three non-empty fields → a `Triple {subject, predicate, object}`; otherwise skip
  the line. Preserve line order in the returned array. No throw on malformed lines. Document the
  exact rule in NOTES.

`src/semantic/knowledge-graph.ts` — `LocalKnowledgeGraph`
- Store facts deduped by identity `(subject, predicate, object, sourceObjectId)`; re-`addFact` of an
  identical fact is a no-op. `size()` = distinct fact count.
- `removeBySource(id)`: drop every fact whose `sourceObjectId === id`.
- `match(pattern)`: return facts where each PRESENT pattern field equals the fact's field (omitted =
  wildcard; all-empty pattern → all facts), in canonical order.
- `neighbors(entity)`: facts where `entity` equals the subject OR the object, canonical order.
- `entities()`: distinct subjects ∪ objects, ascending.
- **Canonical order:** ascending by `(subject, predicate, object, sourceObjectId)` using string
  comparison (`<`/`>`). Apply the same order everywhere results are returned.

`src/semantic/semantic.ts` — `createSemantic({ extractor, graph })`
- `ingestObject(objectId, source)`: resolve `source` to triples (`extractor.extract(text)` or the
  given `triples`), `graph.addFact({triple, sourceObjectId: objectId})` for each; return the number
  of facts added (count of triples ingested).
- `rebuild(asyncIterable)`: `graph.clear()`, then for each `{objectId, text}` extract + add; return
  the total number of facts in the graph afterwards.
- `query(pattern)` → `graph.match(pattern)`; `neighbors(entity)` → `graph.neighbors(entity)`;
  `removeObject(objectId)` → `graph.removeBySource(objectId)`.

---

## 2. Required tests (write these, under `test/`, e.g. `test/semantic-l3.test.ts`)

1. `DelimitedExtractor`: parses well-formed lines into ordered triples; skips blank/malformed lines
   (wrong field count, empty field); custom delimiter works; deterministic (same text → same triples).
2. `LocalKnowledgeGraph`: addFact/size/entities; dedup (re-add identical = no-op, size stable);
   same triple from two sources = two facts; `removeBySource` drops exactly that source's facts; clear.
3. `match`: each-field wildcard combinations (subject-only, predicate-only, object-only, full, empty);
   results in canonical order; non-match → `[]`.
4. `neighbors`: returns facts where entity is subject OR object; canonical order; unknown entity → `[]`.
5. **Canonical-order determinism:** facts added in a shuffled order come back in the SAME canonical
   order across runs; `entities()` ascending.
6. `createSemantic`: `ingestObject` with `{text}` and with `{triples}` both work and tag provenance;
   `query`/`neighbors` read through; `removeObject` drops one object's facts; ingest returns the count.
7. `rebuild`: from an async `{objectId, text}` stream reproduces the same graph as incremental
   `ingestObject` calls (same queries → same results); clears prior state; returns the total fact count.
8. **OUT-OF-ROOT invariant (load-bearing, §6):** run an L0 spine scenario (reuse
   `scripts/spine-scenario.ts` / the L0 helpers), record `vault_memory_root` (+ an `object_id` and
   `space_state`); run the SAME scenario while also `ingestObject`-ing every object and issuing
   queries; assert all three are byte-identical with vs without L3.
9. **OUT-OF-ROOT structural:** assert no source under `src/spine/` or `src/canonical/` imports
   `semantic` (read the files, fail on a `semantic` import). One-way dependency.

## 2.1 Semantic golden (anti-drift, PRE-NORMATIVE)

Extend the vector generator + a golden test to pin the deterministic mechanics: a FIXED
`DelimitedExtractor`, a FIXED corpus of `{objectId, text}` (text carrying delimited triples), the
extracted facts, and a FIXED set of `match`/`neighbors`/`entities` queries → the pinned canonically
ordered results. The golden test reproduces it with EXACT string comparison (no float tolerance).
Add it as `vectors/semantic/golden.json` (a fourth sibling to spine/anchor/recall); wire
`scripts/semantic-scenario.ts` + extend `scripts/generate-vectors.ts` so `npm run vectors:generate`
produces all four byte-identically. Mark `_status` PRE-NORMATIVE.

---

## 3. Acceptance gates (all must pass — do not report done on red)

```
npm run typecheck
npm test                 # all existing 103 (L0+conformance+L1+L2) stay green + new L3, 0 fail
npm run test:conformance # unchanged (the same 9 conformance tests)
npm run vectors:generate # regenerates spine + anchor + recall + semantic golden; golden tests match
```

Run the gates via the **npm scripts exactly as written** (`node:test`). Do NOT substitute
`bun test`. Also confirm by inspection: no edits under `src/spine`, `src/canonical`, `src/crypto`;
no domain tag added; no encryption/KEK use in `src/semantic`; no new runtime deps; the out-of-root
invariant (§6) holds behaviourally AND structurally.

---

## 4. NOTES (required deliverable)

Write `docs/NOTES-deepseek-L3.md`: one entry per non-obvious decision —
- the exact `DelimitedExtractor` parse rule (split, trim, skip conditions, order);
- the fact identity/dedup rule and the canonical sort key;
- how the out-of-root invariant test is constructed (what it holds equal);
- where the semantic golden lives and what queries it pins.
Then any **objection** (raise, don't silently fix). End with the gate results (counts) and the list
of files you touched.

You do not commit, push, or alter git history. Stay inside `projects/mnemosyne/`.
**Important:** finish ALL deliverables (bodies + tests + golden + NOTES) before reporting done — do
not stop at a mid-run summary; the run is complete only when `npm run vectors:generate` is green and
`docs/NOTES-deepseek-L3.md` exists.
