# Implementation notes — DeepSeek (L2 Recall)

Executor notes for `docs/TASK-deepseek-L2.md`. Bodies and tests; no frozen contract was modified.
Every non-obvious choice the task asked me to record is below. No objection was raised — all
contracts were implementable as specified.

## Design choices

### 1. HashEmbedder derivation

The `HashEmbedder.embed(text)` algorithm, documented in `src/recall/embedding.ts` and reproduced
for the golden:

1. **Hash**: compute `SHA-256(UTF-8(text))` → 32 bytes.
2. **Counter-expand**: if `dimension * 4 > 32`, append more hash blocks via
   `SHA-256(UTF-8(text) || uint32be(counter))` for counter = 1, 2, … until enough bytes
   are collected. `uint32be(counter)` is a 4-byte big-endian unsigned integer.
3. **Take first `dimension * 4` bytes** from the concatenated stream.
4. **Interpret as big-endian float32**: each 4-byte chunk is read via
   `DataView.getFloat32(offset, false)` where `false` = big-endian. This guarantees
   cross-platform byte-identical float values.
5. **NaN/Infinity guard**: if a parsed float is `NaN`, `+Infinity`, or `-Infinity`, it is
   replaced with `0.0`. Arbitrary byte sequences can produce IEEE 754 specials; without this
   guard the L2 norm would be non-finite and normalization would fail.
6. **L2-normalize**: compute Euclidean norm `√(∑ vᵢ²)`. If norm === 0, return the zero vector
   (defensive — SHA-256 won't produce all-zero floats, but this guards the division).
   Otherwise divide each component by the norm, producing a unit vector.

The SHA-256 counter-expansion uses concatenation of **raw bytes**, not hex, to match how
crypto inputs work: `hash.update(textBytes); hash.update(counterBE)`.

**Cross-platform determinism**: using `DataView.getFloat32(_, false)` ensures the same bytes
produce the same JavaScript `Number` regardless of platform endianness. The resulting values
are stored in a `Float32Array` (which uses native byte order internally), but the *values*
are identical across platforms since they were parsed with explicit big-endian.

### 2. Cosine summation order + zero-norm handling + tie-break

**Cosine**: `dot(a, b) / (||a|| * ||b||)` computed by iterating dimensions 0..d-1 in fixed
order. Both the dot product and the norms sum over the same order, guaranteeing
floating-point reproducibility across calls.

**Zero-norm**: if either `||a|| === 0` or `||b|| === 0`, return score 0. This avoids division
by zero and is well-defined per spec §5. The norm check is done with `<= 0` (catches both 0
and subnormals that compare as 0).

**Top-k sort**: `Array.sort()` with comparator `(score desc, objectId asc)`. Since V8's
`Array.sort` is stable (TIM sort), ties in both score AND objectId preserve insertion order,
which is the add order. This is deterministic because `query` builds a fresh hits array each
call. The explicit `objectId` comparison (`a.objectId < b.objectId ? -1 : a.objectId > b.objectId ? 1 : 0`) ensures consistent ordering when scores are exactly equal.

**Edge cases**: `k <= 0` returns `[]`; `k > size()` returns all entries sorted.

### 3. Out-of-root invariant test construction

**Behavioural test** (in `test/recall-l2.test.ts`, test "OUT-OF-ROOT invariant: L2 does not
change spine commitments"):

1. Run the same spine scenario as `scripts/spine-scenario.ts` (6 appends across dialog+code
   spaces with deterministic ciphertext).
2. Record `final_vault_memory_root`, `final_space_state`, and all `object_id`s as the
   "without L2" baseline.
3. Run the scenario **again** with a fresh spine, but this time also construct a `Recall`
   facade over a `HashEmbedder` and `LocalRecallIndex`.
4. After each `spine.append()`, call `recall.indexObject(objectId, { text })` where `text`
   is a fixed deterministic label for that append.
5. Issue several `recall.recall()` calls during and after appends.
6. Assert that `final_vault_memory_root`, `final_space_state`, and all `object_id`s are
   **byte-identical** to the "without L2" baseline.
7. Also assert that the recall index has the expected number of objects (6) after all appends.

This proves that indexing and querying the recall layer does not modify any spine commitment.

**Structural test** (in the same file, test "OUT-OF-ROOT structural:
src/spine/ and src/canonical/ do not import recall"):

Reads every `.ts` file under `src/spine/` and `src/canonical/` and asserts none contain
`/recall`. This enforces the one-way dependency: recall → spine types only, never the reverse.

### 4. Recall golden placement and float-comparison tolerance

**Placement**: `vectors/recall/golden.json` — third sibling to `spine/` and `anchor/`.
Reasons:
- Follows the established pattern of one golden directory per layer.
- `_status: "PRE-NORMATIVE"` on all three; the architect promotes independently.
- The recall scenario script is `scripts/recall-scenario.ts`.
- The golden test is `test/recall-golden.test.ts`.
- `npm run vectors:generate` now produces all three.

**Dimension**: 16 (smaller than the default 64) to keep the golden file compact while still
exercising counter-expansion (16*4=64 bytes > 32, so one counter hash is needed).

**Float-comparison tolerance**: 1e-12 for score comparison. The ranked `objectId` order is
asserted **exactly** (direct string comparison). Scores are compared within tolerance because
floating-point summation order might differ across platforms/V8 versions, but the
sort-by-score-then-objectId tie-break guarantees deterministic ranking even when scores are
close.

**Corpus**: 8 fixed English pangrams/sentences with varying overlap. Queries: 7 fixed queries
exercising exact match, partial match, unrelated text, k=1, k>size, and k=size.

## Objection

None. All contracts were implementable as specified. The out-of-root constraints are strict
but consistent: L2 hashes nothing, uses no domain tags, never decrypts, never holds a KEK,
and the spine never imports recall.

## Gate results

| Gate | Result |
|------|--------|
| `npm run typecheck` | PASS — clean |
| `npm test` | PASS — 103 tests, 0 fail (36 L0 + 9 conformance + 27 L1 + 29 L2 + 2 recall golden) |
| `npm run test:conformance` | PASS — 9 conformance tests unchanged |
| `npm run vectors:generate` | PASS — spine + anchor + recall golden all regenerate byte-identically |
| OUT-OF-ROOT behavioural | PASS — vault_root, space_state, object_ids identical with/without L2 |
| OUT-OF-ROOT structural | PASS — no spine/canonical file imports recall |
| No spine/canonical/crypto edits | PASS — verified by inspection |
| No new domain tag | PASS — `domains.ts` untouched |
| No encryption/KEK use in recall | PASS — `src/recall/` imports nothing from `src/crypto/` |
| No new runtime deps | PASS — `package.json` unchanged, Node 22 built-ins only |

## Files touched

**Implemented (3 files):**
- `src/recall/embedding.ts` — `HashEmbedder.embed()` body + NaN guard
- `src/recall/recall-index.ts` — `LocalRecallIndex` full implementation
- `src/recall/recall.ts` — `createRecall` body

**New tests (2 files):**
- `test/recall-l2.test.ts` — 27 tests covering all 8 required test groups
- `test/recall-golden.test.ts` — 2 recall golden validation tests

**Golden infrastructure (2 new + 1 modified):**
- `scripts/recall-scenario.ts` — new deterministic scenario
- `scripts/generate-vectors.ts` — extended with recall golden generation
- `vectors/recall/golden.json` — generated, PRE-NORMATIVE

**Documentation (1 file):**
- `docs/NOTES-deepseek-L2.md` — this file

**NOT modified:**
- `src/spine/**`, `src/canonical/**`, `src/crypto/**`, `src/canonical/domains.ts` — zero edits
- `package.json` — no new dependencies
