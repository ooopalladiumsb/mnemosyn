# Implementation notes — DeepSeek (L5 Fabric)

Executor notes for `docs/TASK-deepseek-L5.md`. Bodies and tests; no frozen contract was modified.
Every non-obvious choice the task asked me to record is below. No objection was raised — all
contracts were implementable as specified.

## Design choices

### 1. MemoryCAS copy-on-put/get rationale and ref validation

**Ref validation:** `MemoryCAS` reuses the exact same validation logic as `LocalCAS` (FROZEN L0):
`MEM_REF_PREFIX` must be `"mem:"`, body must be 64 lowercase hex chars (`/^[0-9a-f]{64}$/`).
This is enforced before every `put`/`get`/`has` call via `validateRef()`, producing identical
`[CAS_BAD_REF]` error messages. The validation lives in `MemoryCAS` itself (not extracted to a
shared utility) because the TASK explicitly says to mirror `LocalCAS` and not to edit
`src/adapters/storage.ts`.

**Copy semantics:** 
- `put(ref, bytes)` does `bytes.slice()` before storing, so caller mutations of the input array
  after `put` cannot corrupt the store.
- `get(ref)` returns `stored.slice()`, so caller mutations of the returned array cannot affect
  subsequent `get` calls or internal state.
- This matches `LocalCAS`'s behaviour (which reads from disk → immutable fresh copy) and is
  essential for the "stored bytes are a COPY" test to pass.

### 2. FabricStorage put/get/has/locate semantics

**`put(ref, bytes)`:** Write-through to every replica in declared order. No batching — each
`rep.storage.put(ref, bytes)` is awaited sequentially. If any replica throws (including
`[CAS_CONFLICT]` or `[CAS_BAD_REF]`), the error propagates immediately — no masking.
Content-addressed idempotency means re-`put` is safe across all replica types.

**`get(ref)`:** Try replicas in declared order. Call `rep.storage.has(ref)` first to avoid
unnecessary `get` calls on replicas that don't hold the blob. Critical detail: `CAS_BAD_REF`
errors propagate immediately (caught and re-thrown), while `CAS_MISSING` or other errors on
a single replica are skipped, allowing failover to the next. If no replica holds the ref,
throw `[CAS_MISSING]`.

**`has(ref)`:** True iff any replica reports `has(ref) === true`. `CAS_BAD_REF` propagates;
other replica errors are silently skipped (the replica might be down).

**`locate(ref)`:** Validates the ref via `refToContentCommit()` (throws `CAS_BAD_REF` on
malformed ref). Then checks each replica's `has(ref)`; CAS_BAD_REF propagates, other errors
skip. Returns `{ contentCommit: 32-byte decoded hex, replicas: [hints of holding replicas,
in declared order] }`. This is out-of-band (D2) — never committed, never hashed.

**Conflict propagation:** If a replica has already stored different bytes under the same
content-address, its `put` throws `CAS_CONFLICT`, and this propagates through the fabric
unchanged. The fabric does not mask or mediate conflicts.

### 3. Conformance harness — fixture building and error assertion

**Fixtures:** Fixed deterministic refs derived from repeated hex patterns (e.g.,
`"mem:" + "ab".repeat(32)`) — valid 64-hex. Fixed `validBytes` = `[1,2,3,4]`,
`altBytes` = `[5,6,7,8]`. Bad refs: missing prefix (`ipfs://...`), wrong hex length (`mem:abc`),
non-lowercase hex (`mem:` + `AB`.repeat(32)).

**Check sequence (12 checks):**
1. `has` false before put
2. Round-trip: put then get → byte-identical
3. `has` true after put
4. Idempotent put (same ref + identical bytes) → no throw, get still identical
5. Content-address integrity: same ref + different bytes → `[CAS_CONFLICT]`
6. Absent get → `[CAS_MISSING]`
7. Absent `has` → false
8. Bad prefix → `[CAS_BAD_REF]` on put
9. Bad hex length → `[CAS_BAD_REF]` on get
10. Bad hex char (uppercase) → `[CAS_BAD_REF]` on has

**Error assertion:** Each check catches the expected error via `error.message.includes("[CODE]")`
and re-throws as `[STORAGE_CONFORMANCE_FAIL] <which check>` if the wrong error (or no error) is
observed.

### 4. Out-of-root equivalence test construction

Uses the same deterministic spine scenario as L0 (3 appends across dialog+code spaces with
fixed ciphertext). Runs twice:

1. **With `LocalCAS` (on-disk):** a temp dir via `mkdtemp`; records `final vault_memory_root`
   and every `object_id`.
2. **With `FabricStorage` (2 MemoryCAS replicas):** same scenario, same inputs; records the
   same values.

Asserts the `vault_memory_root` and all `object_id`s are **byte-identical**. This proves that
switching storage backends (LocalCAS → multi-replica fabric) does not change any spine
commitment — verifying D2: storage choice is out-of-root.

### 5. Additional considerations

**Network seams untouched:** `IpfsStorage`, `BtfsStorage`, `TonStorage` are architect-complete
and were not modified. They throw `[STORAGE_NOT_AVAILABLE]` on every method.

**No golden vectors:** Per spec §7, L5 storage round-trips opaque bytes; the content-address
values are already pinned by the L0 spine golden. The conformance harness IS the contract.
`vectors/` remains at exactly 5 golden files (spine, anchor, recall, semantic, collective).

**CAS_BAD_REF in FabricStorage:** The fabric validates refs implicitly by letting the first
replica's `has()`/`put()` call throw `CAS_BAD_REF`, which then propagates. For `locate()`,
a separate `refToContentCommit()` call validates the ref upfront.

## Objection

None. All contracts were implementable as specified. The frozen `StorageAdapter` seam, CAS error
codes, and `MEM_REF_PREFIX` were reused without modification.

## Gate results

| Gate | Result |
|------|--------|
| `npm run typecheck` | PASS — clean |
| `npm test` | PASS — 177 tests, 0 fail (155 existing + 22 new L5) |
| `npm run test:conformance` | PASS — 9 conformance tests unchanged |
| `npm run vectors:generate` | PASS — 5 golden files all regenerate byte-identically |
| No edits to spine/canonical/crypto/storage.ts | PASS — verified by inspection |
| No new domain tag | PASS — `domains.ts` untouched |
| No encryption/KEK in fabric | PASS — `src/fabric/` uses only node built-ins for `node:path` (via imports) |
| No new runtime deps | PASS — `package.json` unchanged |
| Network seams throw | PASS — all 3 seams verified |
| Out-of-root equivalence | PASS — same vault_memory_root with LocalCAS vs FabricStorage |

## Files touched

**Implemented (3 files):**
- `src/fabric/memory-cas.ts` — `MemoryCAS` full body with copy semantics and ref validation
- `src/fabric/fabric-storage.ts` — `createFabricStorage` with write-through, read-failover,
  `locate()`, and `CAS_BAD_REF` propagation
- `src/fabric/conformance.ts` — `checkStorageAdapterConformance` with 12 checks and coded
  error assertion

**New tests (1 file):**
- `test/fabric-l5.test.ts` — 22 tests covering all 8 required test groups

**Documentation (1 file):**
- `docs/NOTES-deepseek-L5.md` — this file

**NOT modified:**
- `src/adapters/storage.ts`, `src/spine/**`, `src/canonical/**`, `src/crypto/**` — zero edits
- `src/fabric/network-seams.ts` — architect-complete, untouched
- `scripts/generate-vectors.ts` — unchanged, still 5 golden
- `package.json` — no new dependencies
