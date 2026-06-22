# TASK — DeepSeek (Senior Technical Executor): implement Mnemosyne L5 Fabric

**From:** Lead Architect · **Date:** 2026-06-23 · **Project:** `projects/mnemosyne/`
**Agent:** `main` (deepseek-v4-pro)

**Authoritative specs (read first, in order):**
1. `README.md` — charter & the Memory Fabric axis (StorageAdapter: Local-CAS | IPFS | BTFS | TON)
2. `docs/spec/l5-fabric-v0.1-draft.md` — L5 spec (this task implements it)
3. `src/adapters/storage.ts` — the FROZEN `StorageAdapter` seam + `LocalCAS` (copy its CAS error
   codes / integrity semantics exactly)
4. `docs/NOTES-deepseek-L4.md` — your own recent style/precedents

You implement **bodies and tests**. The architect owns the **contracts**. The skeleton already
typechecks with `TODO`/`throw` stubs (`npm run typecheck` passes). Replace every `[TODO_L5]` stub.
The network seams (`IpfsStorage`/`BtfsStorage`/`TonStorage`) are architect-complete (they throw
`[STORAGE_NOT_AVAILABLE]`) — do NOT change them. When done, all gates in §3 must pass.

---

## 0. Rules of engagement (hard constraints)

1. DO NOT change frozen contracts — type names, field names, signatures. Frozen for L5:
   - `src/fabric/conformance.ts` — `checkStorageAdapterConformance` signature
   - `src/fabric/memory-cas.ts` — `MemoryCAS` method signatures
   - `src/fabric/fabric-storage.ts` — `FabricReplica`, `FabricStorage`, `createFabricStorage` sig
   - `src/fabric/network-seams.ts` — architect-complete; leave as-is
   - `src/adapters/storage.ts` — FROZEN L0 (`StorageAdapter`, `MEM_REF_PREFIX`, CAS codes); reuse,
     do not edit. **What "frozen" means:** existing names/shapes/signatures immutable; new exports OK.
2. **DO NOT EDIT `src/spine/**`, `src/canonical/**`, `src/crypto/**`, or `src/adapters/storage.ts`.**
   L5 hashes nothing, adds no domain tag, and never sees plaintext or a KEK (the spine hands the
   fabric ciphertext already).
3. `MemoryCAS` and `FabricStorage` MUST use the SAME coded errors as `LocalCAS`: `[CAS_BAD_REF]`
   (malformed ref — reuse `MEM_REF_PREFIX` + the 64-hex check), `[CAS_CONFLICT]` (same ref, different
   bytes), `[CAS_MISSING]` (absent get). The harness asserts these exact codes.
4. If you think a contract is wrong, STOP and write the objection in `docs/NOTES-deepseek-L5.md`.
5. No new runtime dependencies. Node 22 built-ins only.

---

## 1. Bodies to implement

`src/fabric/memory-cas.ts` — `MemoryCAS`
- Internal `Map<string, Uint8Array>` keyed by ref. Validate the ref shape (mirror `LocalCAS`:
  `[CAS_BAD_REF]` if no `mem:` prefix or body ≠ 64 lowercase hex). `put`: idempotent on identical
  bytes, `[CAS_CONFLICT]` on different bytes for an existing ref; STORE A COPY (so a later caller
  mutation of the input array cannot corrupt the store, and `get` returns a fresh copy). `get`:
  `[CAS_MISSING]` if absent, else a copy of the bytes. `has`: presence.

`src/fabric/fabric-storage.ts` — `createFabricStorage`
- `put`: `await` write-through to EVERY replica's `storage.put(ref, bytes)` (let a replica's
  `[CAS_CONFLICT]` propagate). `get`: iterate replicas in order; return the first that `has` the ref
  (or whose `get` succeeds); if none, throw `[CAS_MISSING]`. `has`: true iff any replica `has`. Bad
  refs surface `[CAS_BAD_REF]` (a replica will raise it; or validate up front — document your choice).
- `locate(ref)`: build a `ContentLocator { contentCommit, replicas }` where `contentCommit` is the
  32-byte value decoded from the ref hex and `replicas` is the `hint` of every replica that currently
  `has(ref)`, in declared order. Reuse `fromHex`/the ref parsing; do NOT commit this anywhere.

`src/fabric/conformance.ts` — `checkStorageAdapterConformance(makeAdapter)`
- Obtain one fresh adapter; run every check in spec §3 with deterministic `mem:<64hex>` fixtures
  (derive refs from fixed bytes via the existing content-commit, or hard-code valid 64-hex refs).
  Throw `[STORAGE_CONFORMANCE_FAIL] <which check>` on the first failure (catch the expected coded
  errors and assert their code; fail if the wrong/no error is thrown). Resolve if all pass.

---

## 2. Required tests (write these, under `test/`, e.g. `test/fabric-l5.test.ts`)

1. Harness passes for the reference adapters: call `checkStorageAdapterConformance` with
   `() => new MemoryCAS()`, with `() => new LocalCAS(mkdtemp dir)`, and with a `FabricStorage` over
   two `MemoryCAS` replicas — each resolves (no throw).
2. Harness REJECTS a broken adapter: a deliberately-wrong adapter (e.g. one that does not throw on a
   different-bytes reuse, or returns wrong bytes) makes `checkStorageAdapterConformance` throw
   `[STORAGE_CONFORMANCE_FAIL]`. (Proves the harness has teeth.)
3. `MemoryCAS` directly: round-trip; idempotent put; `[CAS_CONFLICT]`; `[CAS_MISSING]`;
   `[CAS_BAD_REF]`; the stored bytes are a COPY (mutating the input or the returned array does not
   change a subsequent `get`).
4. `FabricStorage` replication: after `put`, EVERY underlying replica `has` the ref and returns
   byte-identical bytes.
5. `FabricStorage` read-failover: put into the fabric, then delete/empty the FIRST replica (or build
   a fabric where only a later replica holds the blob); `get` still returns the bytes; a ref no
   replica holds → `[CAS_MISSING]`.
6. `FabricStorage.locate`: names exactly the replicas that hold the ref (in declared order); a ref no
   replica holds → empty `replicas`; `contentCommit` matches the ref hex.
7. **Out-of-root equivalence (load-bearing):** run an L0 spine scenario (reuse
   `scripts/spine-scenario.ts` / helpers) once with `storage = new LocalCAS(dir)` and once with
   `storage = createFabricStorage([MemoryCAS, MemoryCAS])`; assert the final `vault_memory_root` and
   every `object_id` are byte-identical. (Storage choice does not change commitments.)
8. Network seams: `new IpfsStorage().put/get/has` (and BTFS/TON) reject with `[STORAGE_NOT_AVAILABLE]`.

## 2.1 Golden vectors

NONE for L5 — storage round-trips opaque bytes and the content-address values are already pinned by
the L0 spine golden; the conformance harness IS the contract. Do NOT add a `vectors/fabric/` golden
or touch `scripts/generate-vectors.ts`. `npm run vectors:generate` must stay at FIVE golden,
regenerating byte-identically.

---

## 3. Acceptance gates (all must pass — do not report done on red)

```
npm run typecheck
npm test                 # all existing 155 (L0..L4 + conformance) stay green + new L5, 0 fail
npm run test:conformance # unchanged (the same 9 conformance tests)
npm run vectors:generate # UNCHANGED — still five golden (spine/anchor/recall/semantic/collective)
```

Run via the **npm scripts exactly as written** (`node:test`), NOT `bun test`. Also confirm by
inspection: ZERO edits under `src/spine/**`, `src/canonical/**`, `src/crypto/**`,
`src/adapters/storage.ts`; no new domain tag; no new runtime deps; no plaintext/KEK in `src/fabric`.

---

## 4. NOTES (required deliverable — FINISH IT)

Write `docs/NOTES-deepseek-L5.md`: one entry per non-obvious decision —
- `MemoryCAS` copy-on-put/get rationale and ref validation;
- `FabricStorage` put/get/has/locate semantics (write-through, failover order, conflict propagation);
- how the conformance harness builds fixtures and asserts coded errors;
- how the out-of-root equivalence test is constructed (same-root with LocalCAS vs FabricStorage).
Then any **objection** (raise, don't silently fix). End with the gate results (counts) and the files
you touched.

You do not commit, push, or alter git history. Stay inside `projects/mnemosyne/`.
**Finish ALL deliverables (bodies + tests + NOTES) before reporting done — the run is complete only
when `npm test`/`npm run vectors:generate` are green AND `docs/NOTES-deepseek-L5.md` exists.** Do not
stop at a mid-run summary.
