# Mnemosyne — Autonomous Sovereign Memory System

**Status:** Architecture course LOCKED (2026-06-14). L0 migration-hard decisions (D1–D4)
ACCEPTED — see `../  prometheus/# TON AI MEMORY PROTOCOL — MNEMOSYNE L0 DECISION RECORD.md`.
Spine ready to implement. No implementation yet.

## What it is

Mnemosyne is a **standalone autonomous memory agent** — a cryptographically
verifiable, portable, long-lived memory layer for digital subjects (AI agents,
agent collectives, autonomous systems).

Its goal is **not** to store an agent's chat history. Its goal is to provide
memory that **survives** any particular model, agent, orchestrator, LLM provider,
or blockchain integration.

`paradigm_terra` and TON are **optional** integration/anchor targets — not the
host and not a hard dependency. Mnemosyne runs standalone.

## The single invariant (commitment line)

Everything else is negotiable. This is not:

```
  LLM Brain → Memory Decision → MemoryObject → Deterministic Spine → Memory Root → Anchor
                                     │
                                     └→ (derived, NEVER feeds back up)
                                        Embeddings · Fact Extraction · Knowledge Graph · Recall Cache
```

The brain decides **what** to remember (autonomous, non-deterministic, LLM).
The spine guarantees **how** it is committed (deterministic, hashable, byte-identical,
third-party verifiable). The derived index (embeddings/facts/graph) is a rebuildable
projection and **never** influences the hashed root. Break this line and "verifiable
memory" collapses into ordinary AI memory with cryptographic decoration.

## Architectural pillars (LOCKED)

1. **Brain ⟂ Spine.** Autonomy and determinism are orthogonal layers, both required.
2. **Content Identity vs Storage Commitment.**
   - Storage Commitment = `domainHash(MEMORY_CONTENT, ciphertext)` — in MemoryObject, anchored.
   - Content Identity = `HMAC(vault_content_key, plaintext)` — owner-internal, keyed, never anchored.
   - Enables re-encryption migration, ownership transfer, local dedup without leaking content.
3. **Ciphertext-only commitments.** Plaintext is never hashed into the anchored root
   (a public/signed root over plaintext is a content-guessing oracle).
4. **Memory OS, three runtime modes:**
   - Mode 1 — Pure storage: `External Agent → API → Spine` (no LLM).
   - Mode 2 — Autonomous agent: `LLM → Brain → Spine`.
   - Mode 3 — Multi-agent memory: `{Claude, GPT, Gemini, DeepSeek, CAL agents} → Mnemosyne`. ← north star.
   The Brain is a **plugin**, not the core.
5. **Memory Sovereignty.** Memory belongs to a **Vault DID** (`memory://vault/<id>`),
   not to an agent or platform. Agents are transient delegated writers (**Agent DID**).
   KEK is bound to the Vault, so memory survives agent death and owner migration.
6. **Shared spec, not shared runtime, with paradigm_terra.** Mnemosyne carries its own
   deterministic core, **spec-compatible** with Canonical Encoding v1.3 (same `domainHash`
   machinery, same Merkle), in its own `MNEMOSYNE_*` domain-tag namespace. Interop via
   conformance vectors, not via importing the (consensus-frozen) terra runtime.

## Two adapter axes (Memory Fabric)

```
StorageAdapter : Local-CAS | IPFS | BTFS | TON Storage | S3 | ...   (where ciphertext blobs live)
AnchorAdapter  : None | LocalSigned | TON(paradigm_terra) | ...     (where the memory root lives)
LLMProvider    : Claude(default) | ... (optional, Brain only)
```

Both adapter axes ship with a no-op/local default so a standalone vault runs with
zero external services.

## Build order (spine-first)

| Layer | Scope | Determinism | Phase |
|-------|-------|-------------|-------|
| **L0 Spine** | MemoryObject · MemorySpace · Vault DID · streamTreeRoot/stateRoot · Local-CAS · save/recall-by-id | hashed, golden vectors | **v0** |
| **L1 Anchor** | memory_root → AnchorAdapter (LocalSigned default; TON optional) | hashed | v0.1 |
| **L2 Recall** | embeddings + vector search (derived index) | OUT of root | v0.2 |
| **L3 Semantic** | fact extraction + knowledge graph (derived) | OUT of root | v1 |
| **L4 Collective** | multi-writer delegation, reuses CAL authorization | authorization | v2 |
| **L5 Fabric** | IPFS / BTFS / TON Storage adapters | behind seam | on demand |

L0 + L1 is already an independently valuable, verifiable, anchored product.

See `docs/spec/l0-spine-v0.1-draft.md`.
