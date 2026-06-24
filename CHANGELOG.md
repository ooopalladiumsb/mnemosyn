# Changelog

All notable changes to Mnemosyne are documented here.

## v1.3.0 — 2026-06-24

The agent comes alive and becomes callable: a **live LLM brain**, a **live semantic embedder**, and
an **HTTP backend service**. Mnemosyne is no longer a library you wire by hand — it's a memory agent
you can talk to over HTTP. 262 tests pass; each live seam smoke-tested against a real provider.

### Added — D12 live Brain
- `OpenAICompatBrain` — a real `Brain` over any OpenAI-compatible `/chat/completions` API
  (`deepseekBrain` default = DeepSeek `deepseek-v4-flash`). Returns a structured `{reply, remember[]}`
  with a mandatory safe fallback. Pure seam (no spine/keys), `apiKey` config-only, built-in `fetch`.
  "Free now → premium later" (e.g. Anthropic) is a config swap. *Live-smoked.*

### Added — D12.2 live Embedder
- `OpenAICompatEmbedder` (+ `geminiEmbedder`/`jinaEmbedder`) — a real `EmbeddingProvider` over any
  `/embeddings` API; validates dimension, throws `[EMBED_DIM_MISMATCH]`/`[EMBED_FAILED]` (apiKey-safe).
  Lifts L2 recall from the non-semantic `HashEmbedder` to real semantic ranking. *Live-smoked with
  Qwen `text-embedding-v3`: top-1 correct 3/3.*

### Added — D13 agent backend
- `createAgentHandler` — a framework-agnostic web `fetch` handler (`Request→Response`, Node 22 + Bun)
  over a per-vault `AgentRegistry` + an `Authenticator` seam (`HeaderAuthenticator` for dev). Routes
  `GET /health` + `POST /turn` with safe 401/400/404/500. `serveBun` deployment binding. Secrets live
  in the injected agent factory; per-vault isolation. *Live HTTP smoke: real `POST /turn` over a
  served endpoint → real LLM reply + recoverable memory.*

### Notes
No new runtime deps (`fetch` is built-in; `@ton/core` from v1.2.0 stays isolated). Real auth
(Telegram initData / TON Connect, D14), a persistent store (D13.2), and the Telegram Mini App (D14)
remain ahead.

## v1.2.0 — 2026-06-23

Adds **real TON anchoring** (D11) — and the first live link between Mnemosyne and paradigm_terra. A
`vault_memory_root` can now be settled on-chain using terra's proven anchor-body transport. 206 tests
pass; the first root was anchored live on ton-testnet (see `docs/notes/d11-testnet-settlement.md`).

### Added
- **`anchor-ton`** module — `anchorBodyCell`/`anchorBodyBoc`/`parseAnchorRoot` build the on-chain
  anchor body (op "PTA1" || 256-bit root), **byte-identical to paradigm_terra's** `pp2/anchor-body`
  (conformance-pinned 4/4 against `vectors/anchor-ton/terra-body-golden.json`, REPLICATED not imported
  — spec-compatible, not runtime-coupled).
- **`Broadcaster`** seam (the network boundary, operator-gated) + deterministic `MockBroadcaster`.
- **`TonAnchorAdapter`** — a real `AnchorAdapter`: build → broadcast → receipt; supersedes the L1
  `TonAnchor` stub.

### Dependency
- `@ton/core@0.63.1` (matches terra) — the **first runtime dependency**, ISOLATED to `src/anchor-ton/`
  (a structural test enforces it); the pure core (L0–D10) stays dependency-free.

### Live
- First `vault_memory_root` (the NORMATIVE spine-golden root) anchored on **ton-testnet**; the
  on-chain message body cell-hash is **byte-identical to the pinned body** (settle-tx
  `VGhMnVF/8DHfe9SkesuX0VIx/T96LCQSjZXuaf/PrR8=`). The live broadcaster stays operator tooling; the
  library ships the deterministic body + `MockBroadcaster`.

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
