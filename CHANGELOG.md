# Changelog

All notable changes to Mnemosyne are documented here.

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
