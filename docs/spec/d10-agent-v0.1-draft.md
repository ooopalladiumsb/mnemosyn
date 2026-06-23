# Mnemosyne D10 — Agent Host (@mnemosyne/agent)

**Version:** v0.1-draft · **Status:** DRAFT (review before code)
**Depends on:** v1.0.0 (Spine, `crypto/encryption`, `identity`, optional L2 Recall).

v1.0.0 shipped verifiable memory — a library, not an agent. D10 is the **Stage-0 agent host**: the
thin TS/Node layer that turns it into an agent WITH verifiable memory, by composing the existing
seams into a loop and filling the one piece the spine deliberately omits — **Vault key custody**. No
Web3 framework, no Python sidecar, no new runtime deps — same ecosystem as the library.

---

## 1. What D10 is (and is not)

It is the realization of the charter's Mode 2 (`LLM → Brain → Spine`):
- a **Brain** seam — the autonomous, non-deterministic decider (the real surface for the empty
  `adapters/llm.ts` `LLMProvider` placeholder);
- a **VaultKeyManager** — KEK custody + seal/open (the spine takes ciphertext and never holds a key);
- a **MnemosyneAgent** loop facade — recall → brain → seal → append.

It is NOT: an LLM (real Brains are an untested seam — `ScriptedBrain` is the deterministic
reference); a network/consensus runtime; a wallet. It introduces NO new hashed surface and NO new
domain tag — it only DRIVES the frozen spine. The commitment line is the law it must not break.

---

## 2. Brain seam

```
interface MemoryDraft   { kind: MemoryKind; space: string; text: string; tags?: string[] }  // PLAINTEXT
interface ContextHit    { objectId; text; kind; score }      // a decrypted prior memory
interface RecalledContext { query: string; hits: ContextHit[] }
interface BrainTurn     { reply: string; remember: MemoryDraft[] }
interface Brain { name: string; turn(input, context): Promise<BrainTurn> }
```

- The Brain decides the reply AND what to remember. It MUST NOT import the spine, encrypt, or hold
  keys — it returns plaintext drafts; the host seals and commits them.
- **`ScriptedBrain`** (reference): delegates to a pure `(input, context) => BrainTurn` function —
  deterministic, LLM-free, so the loop is testable (the agent analogue of L0's fixed ciphertext).

---

## 3. VaultKeyManager (the custody the spine omits)

```
interface SealedContent { ciphertext: Uint8Array; enc: EncMeta }
interface VaultKeyManager {
  keyId: string
  seal(plaintext): Promise<SealedContent>          // encrypt → ciphertext + EncMeta
  open(ciphertext, enc): Promise<Uint8Array>       // decrypt back
}
```

- **`LocalVaultKeyManager`** (reference): holds a raw 32-byte Vault KEK + `keyId`; `seal`/`open`
  reuse the L0 `crypto/encryption` `encrypt`/`decrypt` (AES-256-GCM). The KEK lives behind this
  boundary — never returned, logged, or hashed.
- **INVARIANT:** the KEK and plaintext NEVER enter a hashed value. `content_commit` is over the
  CIPHERTEXT only (D2). A fresh GCM nonce per `seal` is the only non-determinism and is permitted
  (the spine commits the ciphertext it is handed) — so an agent session is NOT byte-reproducible
  across runs, which is why D10 has no value golden (see §6).

---

## 4. MnemosyneAgent loop

```
interface AgentConfig { spine; brain; keys; vaultDid; agentDid; capabilityId; recall?; recallK? }
interface TurnResult  { reply: string; remembered: AppendReceipt[] }
interface MnemosyneAgent { turn(input): Promise<TurnResult>; remember(draft): Promise<AppendReceipt> }
createAgent(config): MnemosyneAgent
```

`turn(input)`:
1. **Context** — if `recall` is wired: embed `input`, `recall.recall(input, recallK ?? 5)` → for each
   hit `spine.recallById(objectId)` + `keys.open(ciphertext, enc)` → a `ContextHit` (decrypted).
   No recall → empty context.
2. **Decide** — `brain.turn(input, context)` → `{ reply, remember }`.
3. **Commit** — for each draft: `keys.seal(utf8(text))` → `spine.append({ vaultDid, space, kind,
   ciphertext, enc, writerDid: agentDid, capabilityId, tags })`; if `recall` is wired,
   `recall.indexObject(receipt.object_id, { text })` to keep the index current.
4. Return `{ reply, remembered: receipts }`.

`remember(draft)` = step 3 for a single draft (no brain). Memory is owned by `vaultDid`, written by
`agentDid` (D3/charter): every committed object carries `writer_did = agentDid`.

> Capability: v1 writes with `capabilityId` directly via `spine.append` (default
> `ROOT_CAPABILITY_ID`, D4). Enforced L4 `AuthorizingSpine` integration (a grant per append) is a
> later composition, noted not built.

---

## 5. The commitment line is the law (load-bearing gate)

D10's gate is **loop fidelity + the commitment line**, not a value golden:
- **Fidelity:** a `turn` whose Brain decides N drafts appends exactly N objects; each is recoverable
  byte-identical via `spine.recallById` + `keys.open`; `remembered` has N receipts; `reply` is the
  Brain's reply.
- **Round-trip:** `keys.open(keys.seal(p)) === p` for arbitrary bytes; the committed `content_commit`
  is over the ciphertext (a different KEK cannot decrypt; a tampered ciphertext fails GCM).
- **Context:** with recall wired, a turn surfaces prior memories DECRYPTED to the Brain (a Brain that
  echoes its context proves recall → recallById → open works end-to-end).
- **No leak (structural):** the agent uses the spine via its public API only; the KEK/plaintext never
  reach a hashed value; `src/spine/**` and `src/canonical/**` are not edited; no new domain tag.
- **Sovereignty:** committed objects have `vault_did = vaultDid`, `writer_did = agentDid`.

---

## 6. Conformance & gates

D10 is DONE only when all pass:
1. `npm run typecheck` — clean.
2. `npm test` — v1.0.0's 177 stay green (no regression) + new D10 tests.
3. `npm run test:conformance` — unchanged.
4. **Loop fidelity + round-trip + context + no-leak + sovereignty** (§5) all hold.
5. `npm run vectors:generate` — UNCHANGED, still five NORMATIVE golden (D10 adds no golden: a live
   GCM nonce makes a session non-reproducible by design; the round-trip/fidelity tests are the
   contract).
6. No new runtime deps; no new domain tag; no edits under `src/spine`/`src/canonical`; the frozen
   `adapters/llm.ts` placeholder is left untouched (Brain supersedes it in the agent namespace).

---

## 7. Decision (proposed — ratify before merge)

**D10 (agent host, @mnemosyne/agent).** A Stage-0 TS/Node agent host over v1.0.0: a `Brain` seam
(+ deterministic `ScriptedBrain`), a `VaultKeyManager` (+ in-memory `LocalVaultKeyManager` reusing
L0 AES-256-GCM), and a `MnemosyneAgent` loop (`createAgent`) that drives recall → brain → seal →
append over the UNMODIFIED spine. The Brain returns plaintext drafts; the host seals and commits
ciphertext only; the KEK/plaintext never enter a hashed value; memory is Vault-owned, Agent-written.
No new domain tag, no golden (sessions are non-deterministic by the GCM nonce), no new deps. Real
Brains/key-backends (LLM, OS keychain, TEE) and L4-grant enforcement are deferred seams. Lives under
`src/agent/` (conceptually `@mnemosyne/agent`; depends only on the public spine surface, clean to
extract to its own package later). Migration-hard surface frozen by D10: `MemoryDraft`/`ContextHit`/
`RecalledContext`/`BrainTurn`/`Brain`, `SealedContent`/`VaultKeyManager`, `AgentConfig`/`TurnResult`/
`MnemosyneAgent`, and the `ScriptedBrain`/`LocalVaultKeyManager`/`createAgent` signatures. Loop
fidelity + the commitment line (§5) are the controlling acceptance criteria.
