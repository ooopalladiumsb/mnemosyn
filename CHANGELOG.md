# Changelog

All notable changes to Mnemosyne are documented here.

## v1.1.0 — 2026-06-23

Adds the **agent host** (`@mnemosyne/agent`, D10) — the Stage-0 TS/Node layer that turns
verifiable memory into an *agent with* verifiable memory, in the same ecosystem, with no Web3
framework and no new runtime dependencies. 192 tests pass.

### Added
- **Brain seam** (`Brain` + deterministic `ScriptedBrain`) — the autonomous decider that returns a
  reply and `MemoryDraft`s; the real surface for the reserved `LLMProvider` placeholder. Real LLM
  Brains are an untested seam.
- **Vault key custody** (`VaultKeyManager` + in-memory `LocalVaultKeyManager`) — the one piece the
  spine deliberately omits: holds the KEK, seals plaintext → ciphertext+`EncMeta`, opens it back
  (reuses L0 AES-256-GCM). The KEK and plaintext never enter a hashed value.
- **Agent loop** (`MnemosyneAgent` / `createAgent`) — `turn(input)` drives recall → brain → seal →
  append over the **unmodified** spine; memory is Vault-owned, Agent-written.

### Invariants
The commitment line holds end-to-end: only ciphertext is committed; no new domain tag; no golden (a
live GCM nonce makes sessions non-reproducible by design — loop fidelity + round-trip are the
contract); zero edits to the frozen L0–L5 surface. Real Brains / key backends (LLM, OS keychain,
TEE) and L4-grant enforcement remain deferred seams.

## v1.0.0 — 2026-06-23

First stable release. The full build order (L0–L5) is implemented, reviewed, and
accepted; the golden vectors are promoted to **NORMATIVE** (the cross-impl contract
over deterministic reference scenarios). 177 tests pass.

### The single invariant

The commitment line holds end to end: the Brain decides *what* to remember; the
deterministic Spine guarantees *how* it is committed (hashable, byte-identical,
third-party verifiable); every derived layer (recall, semantic, fabric) is a
rebuildable projection that **never** feeds back into the hashed root.

### Layers

- **L0 Spine (D1–D4)** — MemoryObject / MemorySpace / Vault DID, restricted-JCS
  canonical encoding, binary Merkle, `vault_memory_root`; `LocalCAS` storage,
  `LocalSigned` anchor. Conformance-verified byte-identical to paradigm_terra CE v1.3.
- **L1 Anchor (D5)** — durable, hash-linked checkpoint chain; offline `verifyReceipt`
  / `verifyCheckpointChain`; golden pins `checkpoint_id` + Ed25519 `proof`.
- **L2 Recall (D6)** — derived embeddings + vector search behind `EmbeddingProvider`
  / `RecallIndex` (deterministic `HashEmbedder` + brute-force `LocalRecallIndex`).
  Out-of-root invariant enforced (behavioural + structural).
- **L3 Semantic (D7)** — derived fact extraction + knowledge graph (plain triples +
  provenance) behind `FactExtractor` / `KnowledgeGraph`. Out-of-root invariant.
- **L4 Collective (D8)** — multi-writer delegation: Vault-signed, hashable
  `Capability` (`CAPABILITY_V1`) + `AuthorizingSpine` that gates append over the
  **unmodified** L0 spine. Single-level (chain-ready).
- **L5 Fabric (D9)** — storage backends behind the frozen `StorageAdapter` seam: a
  conformance harness, in-memory `MemoryCAS`, multi-replica `FabricStorage`
  (out-of-band `ContentLocator`), and typed IPFS/BTFS/TON seams (live wiring deferred).

### Invariants held

AI-7 (no wall-clock in any hashed value), ciphertext-only commitments, out-of-root
for all derived layers, frozen L0 surface across L1–L5, no plaintext/KEK above the
spine. Live model/network seams (real embedders, on-chain anchor, IPFS/BTFS/TON)
remain typed and deferred to network-gated deliverables.
