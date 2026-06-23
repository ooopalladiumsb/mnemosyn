# TASK — DeepSeek (Senior Technical Executor): implement Mnemosyne D10 Agent Host

**From:** Lead Architect · **Date:** 2026-06-23 · **Project:** `projects/mnemosyne/`
**Agent:** `main` (deepseek-v4-pro)

**Authoritative specs (read first, in order):**
1. `README.md` — charter (Mode 2: LLM → Brain → Spine; Memory Sovereignty; commitment line)
2. `docs/spec/d10-agent-v0.1-draft.md` — D10 spec (this task implements it)
3. `src/crypto/encryption.ts` — `encrypt(plaintext, vaultKek, keyId)` / `decrypt(ciphertext, enc,
   vaultKek)` to REUSE; `src/spine/spine.ts` (`Spine`, `AppendInput`); `src/recall/recall.ts` (`Recall`)
4. `docs/NOTES-deepseek-L4.md` — your own recent style/precedents

You implement **bodies and tests**. The architect owns the **contracts**. The skeleton already
typechecks with `TODO`/`throw` stubs (`npm run typecheck` passes). Replace every `[TODO_D10]` stub.
When done, all gates in §3 must pass.

---

## 0. Rules of engagement (hard constraints)

1. DO NOT change frozen contracts — type names, field names, signatures. Frozen for D10:
   - `src/agent/brain.ts` — `MemoryDraft`/`ContextHit`/`RecalledContext`/`BrainTurn`/`Brain`,
     `ScriptedBrain` ctor + `turn`
   - `src/agent/key-manager.ts` — `SealedContent`/`VaultKeyManager`, `LocalVaultKeyManager` sigs
   - `src/agent/agent.ts` — `AgentConfig`/`TurnResult`/`MnemosyneAgent`, `createAgent` signature
   - **What "frozen" means:** existing names/shapes/signatures immutable; new exports OK.
2. **DO NOT EDIT `src/spine/**`, `src/canonical/**`, or the frozen `src/adapters/llm.ts`.** D10 only
   DRIVES the spine through its public API and adds NO new domain tag (it hashes nothing new). The
   `LLMProvider` placeholder stays untouched — `Brain` supersedes it in the agent namespace.
3. **The commitment line is the law.** Only ciphertext is committed; the KEK and plaintext NEVER
   enter a hashed value. `keys.seal` happens BEFORE `spine.append`; the Brain returns plaintext
   drafts and must not see keys or the spine.
4. REUSE the L0 crypto: `LocalVaultKeyManager` wraps `encrypt`/`decrypt` from `crypto/encryption.ts`
   with a held KEK — do NOT hand-roll AES or add deps.
5. If you think a contract is wrong, STOP and write the objection in `docs/NOTES-deepseek-D10.md`.
6. No new runtime dependencies. Node 22 built-ins only.

---

## 1. Bodies to implement

`src/agent/brain.ts` — `ScriptedBrain`
- `turn(input, context)` returns `Promise.resolve(this.script(input, context))`. Pure delegation to
  the injected deterministic function. (No LLM; this is the test/reference Brain.)

`src/agent/key-manager.ts` — `LocalVaultKeyManager`
- Hold the 32-byte KEK from the constructor (keep it private; never expose it). `seal(plaintext)`:
  `const r = encrypt(plaintext, kek, this.keyId)` → return `{ ciphertext: r.ciphertext, enc: r.enc }`
  (match the field names `encrypt` actually returns — read `EncryptResult`). `open(ciphertext, enc)`:
  `return decrypt(ciphertext, enc, kek)`. Store a copy of the KEK so a caller mutation can't change it.

`src/agent/agent.ts` — `createAgent(config)`
- Return a `MnemosyneAgent`:
  - `turn(input)`: (1) build context — if `config.recall`: `recall.recall({text: input},
    config.recallK ?? 5)` → for each hit `spine.recallById(vaultDid, hit.objectId)` then
    `keys.open(ciphertext, obj.enc)` → decode UTF-8 → a `ContextHit {objectId, text, kind: obj.kind,
    score: hit.score}`; no recall → empty hits. (2) `brain.turn(input, {query: input, hits})`.
    (3) for each draft: `keys.seal(utf8(draft.text))` → `spine.append({vaultDid, space: draft.space,
    kind: draft.kind, ciphertext, enc, writerDid: agentDid, capabilityId, tags: draft.tags})`; if
    `recall`, `recall.indexObject(receipt.object_id, {text: draft.text})`. (4) return `{reply,
    remembered: receipts}`.
  - `remember(draft)`: the commit step (3) for one draft; return its `AppendReceipt`.
- Use `TextEncoder`/`TextDecoder` for utf-8. Do not catch-and-swallow spine/crypto errors.

---

## 2. Required tests (write these, under `test/`, e.g. `test/agent-d10.test.ts`)

1. `LocalVaultKeyManager` round-trip: `open(seal(p).ciphertext, seal-enc) === p` for several
   plaintexts incl. empty + binary; two seals of the same plaintext differ (fresh nonce) yet both
   open to the original; a DIFFERENT KEK fails to open (GCM auth error); a flipped ciphertext byte
   fails to open.
2. `ScriptedBrain`: returns exactly the scripted `BrainTurn`; deterministic.
3. `createAgent.turn` fidelity (use a real `createSpine` with in-memory stores / LocalCAS+LocalSigned
   + `ScriptedBrain` + `LocalVaultKeyManager`): a turn whose brain remembers 2 drafts appends exactly
   2 objects; each is recoverable byte-identical (`spine.recallById` + `keys.open` → original text);
   `remembered` has 2 receipts; `reply` is the brain's reply; committed objects carry
   `writer_did === agentDid` and `vault_did === vaultDid`.
4. `createAgent.turn` with NO drafts: appends nothing, returns the reply + empty `remembered`.
5. Context assembly (recall wired: HashEmbedder + LocalRecallIndex + createRecall): remember a few
   memories over turns, then a turn whose `ScriptedBrain` ECHOES `context.hits` into its reply —
   assert the reply contains a prior memory's decrypted text (proves recall → recallById → open).
6. `remember(draft)` directly commits one memory recoverable via recallById + open.
7. **No-leak (structural):** assert no file under `src/spine/` or `src/canonical/` imports `../agent`
   (read the files). One-way dependency: agent → spine, never the reverse.

## 2.1 Golden vectors

NONE for D10 — a fresh GCM nonce per seal makes a session non-reproducible by design; the
round-trip/fidelity tests are the contract. Do NOT add a `vectors/` entry or touch
`scripts/generate-vectors.ts`. `npm run vectors:generate` must stay at FIVE NORMATIVE golden.

---

## 3. Acceptance gates (all must pass — do not report done on red)

```
npm run typecheck
npm test                 # all existing 177 stay green + new D10, 0 fail
npm run test:conformance # unchanged (the same 9 conformance tests)
npm run vectors:generate # UNCHANGED — still five NORMATIVE golden, byte-identical
```

Run via the **npm scripts exactly as written** (`node:test`), NOT `bun test`. Also confirm by
inspection: ZERO edits under `src/spine/**`, `src/canonical/**`, `src/adapters/llm.ts`; no new domain
tag; no new runtime deps; the KEK/plaintext never reach a hashed value (seal precedes append; only
ciphertext is committed).

---

## 4. NOTES (required deliverable — FINISH IT)

Write `docs/NOTES-deepseek-D10.md`: one entry per non-obvious decision —
- how `LocalVaultKeyManager` maps `EncryptResult` → `SealedContent` and guards the KEK;
- the `turn` loop order (context-decrypt → brain → seal → append → index) and utf-8 handling;
- how the fidelity/round-trip/context tests are constructed (what they prove);
- how the no-leak structural test enforces the one-way dependency.
Then any **objection** (raise, don't silently fix). End with the gate results (counts) and files touched.

You do not commit, push, or alter git history. Stay inside `projects/mnemosyne/`.
**Finish ALL deliverables (bodies + tests + NOTES) before reporting done — the run is complete only
when `npm test` is green AND `docs/NOTES-deepseek-D10.md` exists.** Do not stop at a mid-run summary.
