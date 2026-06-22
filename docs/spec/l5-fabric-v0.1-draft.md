# Mnemosyne L5 — Memory Fabric (storage backends behind the seam)

**Version:** v0.1-draft · **Status:** DRAFT (review before code)
**Depends on:** L0 Spine v0.1 (`StorageAdapter` seam, `mem:<hex>` content-address, `ContentLocator`).

L0–L4 assume a single `LocalCAS` on disk. **L5 opens the storage axis**: more `StorageAdapter`
backends behind the SAME frozen seam, plus a multi-replica fabric that mirrors one content-addressed
blob across them. This is the README's "Memory Fabric — `StorageAdapter : Local-CAS | IPFS | BTFS |
TON Storage | …` — where ciphertext blobs live", built at the contract level offline.

---

## 1. Why storage is out-of-root (D2, restated)

A `StorageAdapter` resolves `mem:<hex(content_commit)> ↔ bytes`. The content-address is the spine's
`content_ref`; **the backend a blob lives in is never part of a MemoryObject or any hashed value**
(D2: adapter URIs forbidden in MemoryObject; replicas live in out-of-band `ContentLocator`). So L5
adds storage choice WITHOUT touching commitments — switching from `LocalCAS` to a fabric of three
backends yields a byte-identical `vault_memory_root`. L5's gate is therefore **round-trip fidelity +
content-address integrity + conformance**, not value golden vectors.

---

## 2. What L5 adds (and deliberately does not)

Adds:
- A **conformance harness** — the `StorageAdapter` contract as reusable code, so any backend is
  validated offline before a live node is wired.
- **`MemoryCAS`** — a pure in-memory reference adapter (the in-RAM sibling of `LocalCAS`).
- **`FabricStorage`** — a `StorageAdapter` over N replicas (write-through, read-failover) +
  `locate()` returning an out-of-band `ContentLocator`.
- Typed **`IpfsStorage` / `BtfsStorage` / `TonStorage`** seams that throw `[STORAGE_NOT_AVAILABLE]`.

Out of scope (later/network-gated): live IPFS/BTFS/TON wiring (needs a running node — a separate
deliverable, mirrors terra's PP settlements); quorum/erasure-coding write policies (v1 fabric is
write-through-all + first-hit read); garbage collection / pinning policy; encryption (the spine
hands the fabric ciphertext already — storage never sees plaintext, never holds a KEK).

The `StorageAdapter` seam, `MEM_REF_PREFIX`, and the CAS error codes (`CAS_BAD_REF` / `CAS_CONFLICT`
/ `CAS_MISSING`) are FROZEN (L0) — L5 reuses them, does not change them. No new domain tag (L5
hashes nothing).

---

## 3. Conformance harness

```
checkStorageAdapterConformance(makeAdapter: () => StorageAdapter | Promise<…>): Promise<void>
```

Obtains one FRESH (empty) adapter and asserts the contract, throwing
`[STORAGE_CONFORMANCE_FAIL] <check>` on the first violation:
- **round-trip:** `put(ref, bytes)` then `get(ref)` is byte-identical; `has(ref)` false before, true
  after.
- **idempotent put:** same `ref` + identical bytes is a no-op (no throw; `get` still byte-identical).
- **content-address integrity:** same `ref` + DIFFERENT bytes throws `[CAS_CONFLICT]`.
- **absent:** `get` of an unknown ref throws `[CAS_MISSING]`; `has` of it is `false`.
- **bad ref:** a ref missing the `mem:` prefix or with a non-64-hex body throws `[CAS_BAD_REF]`.

The harness is the single source of truth for "is this a valid backend" — `LocalCAS`, `MemoryCAS`,
and `FabricStorage` (over conformant replicas) all pass it.

---

## 4. MemoryCAS

In-memory `Map<ref, bytes>` with the SAME semantics as `LocalCAS`: validate the ref shape (reuse
`MEM_REF_PREFIX`), idempotent put, `[CAS_CONFLICT]` on a different-bytes reuse, `[CAS_MISSING]` on
absent get. Zero external services — the standalone default for tests and ephemeral vaults.

---

## 5. FabricStorage (multi-replica)

```
interface FabricReplica { hint: ReplicaHint; storage: StorageAdapter }
interface FabricStorage extends StorageAdapter { locate(ref): Promise<ContentLocator> }
createFabricStorage(replicas: readonly FabricReplica[]): FabricStorage
```

- **put(ref, bytes):** write through to EVERY replica. Content-addressed → idempotent; if a replica
  already holds different bytes its `[CAS_CONFLICT]` surfaces (the fabric does not mask corruption).
- **get(ref):** try replicas in declared order, return the FIRST hit; `[CAS_MISSING]` iff none has
  it. (Read-failover: a down/empty replica is skipped in favour of the next.)
- **has(ref):** true iff ANY replica has it.
- **locate(ref):** a `ContentLocator { contentCommit, replicas }` listing the `ReplicaHint`s of the
  replicas that currently hold `ref` — OUT-OF-BAND (D2), returned to callers, NEVER committed.

Because every replica stores the identical content-addressed bytes, any single replica is sufficient
to reconstruct memory — the fabric is durability/portability, not a new trust assumption.

---

## 6. Network seams (typed, no live node)

`IpfsStorage` / `BtfsStorage` / `TonStorage` implement `StorageAdapter`; every method throws
`[STORAGE_NOT_AVAILABLE]`. They exist so a `FabricStorage` or a Mode-1/2/3 caller can name them by
type now; live wiring is a later network-gated deliverable and is not exercised by any L5 gate.
Architect-complete (no body to implement).

---

## 7. Conformance & gates

L5 is DONE only when all pass:
1. `npm run typecheck` — clean.
2. `npm test` — L0–L4's existing tests stay green (no regression) + new L5 tests.
3. `npm run test:conformance` — unchanged.
4. **Harness passes for every reference adapter** — `LocalCAS`, `MemoryCAS`, and `FabricStorage`
   (over MemoryCAS/LocalCAS replicas) each satisfy `checkStorageAdapterConformance`.
5. **Fabric replication/failover** — after a fabric put, every replica holds byte-identical bytes;
   reading still succeeds when an earlier replica is missing the blob; `locate` names the holders.
6. **Out-of-root (structural + behavioural)** — a spine run whose storage is a `FabricStorage`
   produces the SAME `vault_memory_root` / `object_id`s as the same run on `LocalCAS`; no adapter URI
   appears in any committed object.
7. Network seams throw `[STORAGE_NOT_AVAILABLE]`. No new runtime deps; no new domain tag; storage
   never sees plaintext / holds a KEK.

No new golden vectors: storage round-trips opaque bytes; the content-address values are already
pinned by the L0 spine golden, and the harness IS the contract. `npm run vectors:generate` stays at
five golden, byte-identical.

---

## 8. Decision (proposed — ratify before merge)

**D9 (L5 fabric).** Additional `StorageAdapter` backends behind the frozen L0 seam: a reusable
conformance harness, an in-memory `MemoryCAS`, a multi-replica `FabricStorage` (write-through /
read-failover / out-of-band `ContentLocator`), and typed `IpfsStorage`/`BtfsStorage`/`TonStorage`
seams that throw until a live node is wired. Storage is content-addressed and out-of-root (D2) —
switching backends never changes a commitment. No new domain tag; no golden (the harness is the
contract); live network wiring deferred. Migration-hard surface frozen by D9:
`checkStorageAdapterConformance`, `MemoryCAS`, `FabricReplica`/`FabricStorage`/`createFabricStorage`,
and the network-seam classes. The conformance harness + the out-of-root equivalence (§7.6) are the
controlling acceptance criteria.
