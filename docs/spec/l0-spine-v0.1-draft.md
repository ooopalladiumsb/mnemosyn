# Mnemosyne L0 — Deterministic Memory Spine

**Version:** v0.1-draft · **Status:** DRAFT (entities here are migration-hard; review before code)
**Depends on:** Canonical Encoding v1.3 primitives (vendored, conformance-pinned to paradigm_terra)

This document specifies **only** the deterministic, hashable spine. The Brain (LLM),
embeddings, facts, and graph are explicitly out of scope — they live above/beside the
spine and never affect the values defined here.

---

## 1. Domain tags (`MNEMOSYNE_*` namespace)

ASCII literals, prefixed before SHA-256, identical machinery to CE §7. Mnemosyne never
uses `PARADIGM_TERRA_*` tags; paradigm_terra never uses `MNEMOSYNE_*`. This separation is
what lets both share `domainHash`/Merkle without collision.

| Tag constant | Literal | Use |
|---|---|---|
| `MEMORY_CONTENT_V1` | `MNEMOSYNE_MEMORY_CONTENT_V1` | Storage Commitment over **ciphertext** |
| `MEMORY_META_V1` | `MNEMOSYNE_MEMORY_META_V1` | commitment over public metadata |
| `MEMORY_OBJECT_V1` | `MNEMOSYNE_MEMORY_OBJECT_V1` | object id |
| `MEMORY_SPACE_V1` | `MNEMOSYNE_MEMORY_SPACE_V1` | space head state hash |
| `VAULT_ROOT_V1` | `MNEMOSYNE_VAULT_ROOT_V1` | per-vault memory root |

Reused from canonical-core (CE v1.3, unchanged): `MERKLE_LEAF_V1`, `MERKLE_NODE_V1`,
`STATE_V1`, `STATE_ROOT_V1` — consumed via `streamTreeRoot()` / `stateRoot()`.

---

## 2. Identity model

```
Vault DID   memory://vault/<base32(vault_authority_pubkey)>   — sovereign, persistent, owns memory
Agent DID   <scheme>:<id>                                     — transient writer/reader (Claude, GPT, CAL…)
```

- **Vault authority key**: signs vault-level operations (root checkpoints, key rotation,
  ownership transfer, delegation grants). KEK is derived under the Vault, never the agent.
- **Writer attribution**: every MemoryObject records `writer_did` (the agent that wrote it),
  always distinct in the data model from `vault_did` even when they coincide in v0.
- **Capability (D4)**: every write carries a `capability_id` — the capability under which the
  Vault authorized it. Future capabilities (`read · write · anchor · rekey · export`) delegate
  from the Vault DID and reuse CAL authorization at L4. In v0 there is exactly one constant
  **root capability**, but the field is present from day one so multi-agent access needs no
  schema migration.
- **v0 simplification**: authority == sole writer, single root capability. Multi-agent
  delegation into one vault = L4. No schema migration later because `vault_did ≠ writer_did`
  and `capability_id` are already carried.

---

## 3. MemoryObject (immutable, content-addressed)

The atomic, immutable unit. Editing memory = new object with new `seqno`; the old object
stays in the log (audit + rollback). Canonicalized via restricted-JCS (integers only).

```
MemoryObject {
  schema_version : uint16        // = 1
  vault_did      : string        // memory://vault/<id>
  space          : string        // space name, e.g. "dialog" | "code" | "fact" | ...
  seqno          : uint64         // append index within (vault_did, space), 0-based, gapless
  kind           : enum           // dialog|code|document|fact|artifact|state|event|decision|skill|tool_call
  content_commit : hash256        // domainHash(MEMORY_CONTENT_V1, ciphertext_bytes)  — anchored
  content_ref    : string         // = "mem:" + hex(content_commit) — content-address, NOT a location (D2)
  enc            : EncMeta         // { alg:"AES-256-GCM", key_id, nonce_b64, wrap }  — which vault DEK/KEK
  meta_commit    : hash256        // domainHash(MEMORY_META_V1, canonicalBytes(public_meta))
  writer_did     : string         // agent that authored this object
  capability_id  : string         // capability authorizing this write (v0: constant root capability) (D4)
  created_at?    : uint64         // OPTIONAL opaque metadata — NOT ordering, NOT replay (Invariant AI-7)
  prev           : hash256        // object_id of (vault,space) seqno-1, or 32 zero bytes for seqno 0
}

object_id = domainHash(MEMORY_OBJECT_V1, canonicalBytes(MemoryObject))
```

> **Invariant AI-7 (ordering).** Memory ordering is defined ONLY by `seqno`. No timestamp
> participates in ordering, hashing semantics, or replay logic. `created_at` is optional,
> opaque, user-supplied metadata. This permanently removes the `append-order ≠ timestamp-order`
> failure mode.

Notes:
- **Plaintext never appears here.** `content_commit` is over ciphertext only.
- **Identity ≠ Location (D2).** `content_ref` is a content-address (`mem:<hex(content_commit)>`),
  never an adapter URI. Where the blob physically lives is carried out-of-band (see `ContentLocator`,
  §7) and is not part of any commitment.
- `public_meta` is the non-secret, queryable subset (kind, tags, created_at, schema_version).
  Anything sensitive goes inside the encrypted blob, not into `meta_commit`.
- `Content Identity` (`HMAC(vault_content_key, plaintext)`) is computed and stored by the
  owner's **local** index for dedup/migration. It is NOT a field of MemoryObject and is
  NEVER anchored.

---

## 4. MemorySpace (append-only stream per (vault, space))

A space is an ordered, gapless log of MemoryObjects sharing one `(vault_did, space)`.
It maps directly onto canonical `StreamLeaf`:

```
streamId       = vault_did + "/" + space
lastSeqno      = seqno of the most recent object
lastEventHash  = object_id of the most recent object
stateHash      = domainHash(MEMORY_SPACE_V1, canonicalBytes({ count, objects_root }))
  where objects_root = binaryMerkle([object_id_0 … object_id_n], MERKLE_NODE_V1)
```

Spaces are independent streams (dialog/code/tool/knowledge/episodic/long-term/…), each with
its own root. A vault may hold any number of spaces.

---

## 5. Vault memory root

One root per vault, over all its spaces — via canonical `stateRoot()`:

```
namespaces  = [ { name: space, canonicalBytes: stateHash(space) } for each space in vault ]
vault_memory_root = stateRoot(namespaces)            // ordered by space name, UTF-8 byte order
```

`vault_memory_root` (32 bytes) is the only value that goes to an AnchorAdapter. Unlimited
objects/blobs underneath; constant on-chain footprint (Principle: only commitments are anchored).

---

## 6. Spine protocol (deterministic operations)

```
append(vault_did, space, kind, ciphertext, enc, writer_did, capability_id, created_at?) -> AppendReceipt
   1. content_commit = domainHash(MEMORY_CONTENT_V1, ciphertext)
   2. content_ref    = "mem:" + hex(content_commit)             // content-address (D2)
      StorageAdapter.put(content_ref, ciphertext)                // resolver stores under the address
   3. seqno          = current_count(vault_did, space)           // ordering authority (AI-7)
   4. obj            = MemoryObject{…, prev: head(vault,space)}
   5. object_id      = domainHash(MEMORY_OBJECT_V1, canonicalBytes(obj))
   6. update space head → recompute stateHash(space)
   7. vault_memory_root = stateRoot(all spaces)
   8. return { object_id, seqno, space_state: stateHash, vault_memory_root }

recall_by_id(vault_did, object_id) -> { obj, ciphertext }       // deterministic, no LLM
   StorageAdapter.get(obj.content_ref) → decrypt with vault KEK/DEK

checkpoint(vault_did) -> AnchorReceipt                          // L1
   AnchorAdapter.anchor(vault_did, vault_memory_root, version)
```

Steps 1, 3–7 are pure functions of their inputs → byte-identical across implementations and
re-runs → covered by golden vectors. Semantic `recall(query)` (vector/fact search) is L2+ and
sits OUTSIDE this protocol.

---

## 7. Interfaces (seams)

```ts
interface StorageAdapter {                  // pure resolver: mem:<commit> ↔ bytes (D2)
  put(ref: string, bytes: Uint8Array): Promise<void>;  // ref = "mem:" + hex(content_commit)
  get(ref: string): Promise<Uint8Array>;
  has(ref: string): Promise<boolean>;
}

// Replica locations live out-of-band and are NEVER part of any commitment (D2).
interface ContentLocator {
  contentCommit: Uint8Array;                // 32 bytes
  replicas: ReplicaHint[];                  // e.g. { adapter: "ipfs", uri: "ipfs://…" } — hints only
}

interface AnchorAdapter {                    // where the memory root lives
  anchor(vaultDid: string, root: Uint8Array, version: bigint): Promise<AnchorReceipt>;
  latest(vaultDid: string): Promise<{ root: Uint8Array; version: bigint } | null>;
}

interface LLMProvider {                      // Brain only — never touches the spine
  // out of L0 scope; declared so the seam exists
}

interface CanonicalCore {                    // vendored CE v1.3 primitives, conformance-pinned
  domainHash(tag: string, payload: Uint8Array): Uint8Array;
  binaryMerkle(leaves: Uint8Array[], nodeTag: string): Uint8Array;
  streamTreeRoot(leaves: StreamLeaf[]): Uint8Array;
  stateRoot(ns: StateNamespace[]): Uint8Array;
  canonicalBytes(value: Json): Uint8Array;   // restricted JCS
}
```

v0 defaults: `StorageAdapter = LocalCAS`, `AnchorAdapter = LocalSigned`, no `LLMProvider`.

---

## 8. Conformance (anti-drift)

`CanonicalCore` ships with a vector suite asserting byte-identical output against
paradigm_terra's published canonical vectors for the shared primitives. CI fails on any
divergence. This is the bridge that keeps the vendored core honest until/if `canonical-core`
is formally extracted as a shared library.

---

## 9. Decisions (CLOSED 2026-06-14 — see prometheus Decision Record)

1. **canonical-core mechanism** → **D1 ACCEPTED**: vendor primitives in v0, pinned by
   conformance vectors against paradigm_terra (Phase A); formal shared `canonical-core` library
   is a later refactor (Phase B). Decouples Mnemosyne from terra's freeze cycle.
2. **content_ref scheme** → **D2 ACCEPTED**: content-address `mem:<hex(content_commit)>`;
   adapter-native URIs forbidden inside MemoryObject. `StorageAdapter` is a pure resolver;
   replica locations live in `ContentLocator` (out-of-band, never committed). Identity ≠ Location.
3. **created_at semantics** → **D3 ACCEPTED**: ordering is `seqno`-only (Invariant AI-7);
   `created_at` is optional opaque metadata, never part of ordering/hashing/replay.
4. **capability model** → **D4 ACCEPTED**: `capability_id` carried in the schema from L0
   (single root capability in v0); delegation + enforcement at L4 via CAL authorization.

Migration-hard surface frozen by these decisions: `MemoryObject` shape, Vault/Agent DID split,
`MemorySpace` model, `content_commit` (ciphertext-only), `seqno` ordering (AI-7), `capability_id`.
Spine is ready to implement.
```
