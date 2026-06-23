# Implementation notes — DeepSeek (D10 Agent Host)

Executor notes for `docs/TASK-deepseek-D10.md`. Bodies and tests; no frozen contract was modified.
Every non-obvious choice the task asked me to record is below. No objection was raised — all
contracts were implementable as specified.

## Design choices

### 1. LocalVaultKeyManager: EncryptResult → SealedContent mapping and KEK custody

`LocalVaultKeyManager` wraps the L0 `crypto/encryption.ts` primitives directly:

- **`seal(plaintext)`**: calls `encrypt(plaintext, this.kek, this.keyId)` and maps
  `EncryptResult { ciphertext, enc }` → `SealedContent { ciphertext, enc }`. The mapping is
  1:1 — `SealedContent` is just a subset of `EncryptResult` without the excess type.
  
- **`open(ciphertext, enc)`**: calls `decrypt(ciphertext, enc, this.kek)`. GCM auth tag
  verification is built into `decrypt` — wrong KEK or tampered ciphertext throws a native
  `node:crypto` error (message varies by Node version: "Unsupported state or unable to
  authenticate data", "bad decrypt", or "Tag mismatch"). All of these indicate GCM auth
  failure, so the test regex covers them all with `/Unsupported state|unable to authenticate|bad decrypt|Tag mismatch/`.

- **KEK custody**: the constructor does `this.kek = vaultKek.slice()` to store a copy.
  This prevents caller mutation of the input array from changing the held key. The KEK is
  never returned, logged, or hashed — it lives strictly behind the `seal`/`open` boundary.

- **Non-determinism**: each `seal()` call gets a fresh 12-byte GCM nonce from
  `node:crypto.randomBytes(12)` inside the L0 `encrypt()`. This is the only non-determinism
  in D10, and it is permitted because the spine commits the resulting ciphertext, not the
  nonce in isolation. Two seals of the same plaintext produce different ciphertext (and
  different `enc.nonce_b64`) but both decrypt back to the original.

### 2. The `turn()` loop order and UTF-8 handling

The loop follows the spec's ordered steps exactly:

1. **Build context** (if recall is wired): `recall.recall({text: input}, k)` → for each hit
   `spine.recallById` → `keys.open` → UTF-8 decode → `ContextHit`. If a single hit fails
   decryption (GCM error), it is silently skipped via `try/catch` and the next hit is
   attempted. This keeps the agent resilient to corrupted ciphertext in the index.

2. **Brain decision**: `brain.turn(input, context)` → `{ reply, remember }`. The Brain
   receives only plaintext (decrypted) context and the user input — never keys, never the
   spine. This enforces the Brain ⟂ Spine architectural pillar.

3. **Commit**: for each `MemoryDraft`, `TextEncoder.encode(text)` → `keys.seal(utf8)` →
   `spine.append({vaultDid, space, kind, ciphertext, enc, writerDid, capabilityId, tags})`.
   If recall is wired, also `recall.indexObject(receipt.object_id, {text})` to keep the
   index current.

4. **Return**: `{ reply, remembered: receipts }`.

**UTF-8 handling**: Uses `TextEncoder`/`TextDecoder` from the global scope (Node 22+) for
conversion between `string` and `Uint8Array`. The encoder is instantiated once at module
scope to avoid repeated allocation.

**`commitDraft()` helper**: The sealing + append + index step is extracted into an internal
`async function commitDraft()` that is shared by both `turn()` and `remember()`, keeping the
logic consistent and DRY.

### 3. How fidelity/round-trip/context tests are constructed

**Key round-trip (test 1):**
- `LocalVaultKeyManager.seal(plain)` then `.open(ciphertext, enc)` → byte-identical for
  text, empty, and binary plaintext.
- Two seals of the same plaintext produce different ciphertext (fresh nonce) but both open
  correctly — proves nonce is handled correctly by the GCM pipeline.
- Different KEK: a `LocalVaultKeyManager` with a different 32-byte key cannot open
  ciphertext sealed by the original — GCM auth failure, proving the KEK is the actual
  encryption key.
- Flipped byte: a single mutated byte in ciphertext fails GCM auth — proves integrity.
- KEK copy: mutating the input array after construction does not affect the held KEK —
  proves the copy semantics.

**Turn fidelity (test 3):**
- Full end-to-end: `createSpine` (MemSpineStore + MemCAS) + `LocalVaultKeyManager` +
  `ScriptedBrain` that returns 2 drafts → `agent.turn("hello")`.
- Asserts: `result.remembered.length === 2`, `reply` matches brain output.
- Recovers each committed object via `spine.recallById` + `keys.open(ciphertext, obj.enc)`
  and asserts the decrypted plaintext matches the original draft text.
- Asserts `obj.writer_did === agentDid` and `obj.vault_did === vaultDid` — sovereignty
  (memory belongs to vault, written by agent).

**Context assembly (test 5):**
- Two-phase test: Phase 1 remembers a fact with recall wired. Phase 2 creates a new agent
  whose `ScriptedBrain` echoes `context.hits` into its reply.
- The reply contains the decrypted text from Phase 1's memory — proving the end-to-end
  pipeline: recall → recallById → open → context.

### 4. No-leak structural test

Reads every `.ts` file under `src/spine/`, `src/canonical/`, and `src/crypto/` and asserts
none contain a regex match for `import ... from "...agent"`. This enforces the one-way
dependency: agent → spine, never the reverse. The agent drives the spine through its public
API only (`spine.append`, `spine.recallById`, `spine.checkpoint`).

**Additional structural checks (manual):**
- `src/adapters/llm.ts` — the frozen `LLMProvider` placeholder, untouched.
- `src/spine/**`, `src/canonical/**` — zero edits, confirmed by inspection.
- No new domain tag added — `domains.ts` unchanged.

## Objection

None. All contracts were implementable as specified. The `EncryptResult` → `SealedContent`
mapping is a straightforward subset; the spine is driven via its public API only; the
commitment line holds (only ciphertext is committed; KEK and plaintext never reach a hashed
value).

## Gate results

| Gate | Result |
|------|--------|
| `npm run typecheck` | PASS — clean |
| `npm test` | PASS — 192 tests, 0 fail (177 existing + 15 new D10) |
| `npm run test:conformance` | PASS — 9 tests unchanged |
| `npm run vectors:generate` | PASS — 5 golden files, unchanged, regenerate byte-identically |
| No edits to `src/spine/**`, `src/canonical/**`, `src/adapters/llm.ts` | PASS — verified |
| No new domain tag | PASS — `domains.ts` untouched |
| No new runtime deps | PASS — `package.json` unchanged |
| KEK/plaintext never hashed | PASS — seal precedes append; only ciphertext reaches spine |
| No-leak structural | PASS — no spine/canonical file imports agent |

## Files touched

**Implemented (3 files):**
- `src/agent/brain.ts` — `ScriptedBrain.turn()` delegates to `this.script`
- `src/agent/key-manager.ts` — `LocalVaultKeyManager` wraps L0 `encrypt`/`decrypt` with KEK
  custody
- `src/agent/agent.ts` — `createAgent` loop: recall → brain → seal → append → index

**New tests (1 file):**
- `test/agent-d10.test.ts` — 15 tests covering all 7 required test groups + bonus

**Documentation (1 file):**
- `docs/NOTES-deepseek-D10.md` — this file

**NOT modified:**
- `src/spine/**`, `src/canonical/**`, `src/crypto/**`, `src/adapters/llm.ts` — zero edits
- `scripts/generate-vectors.ts` — unchanged, still 5 golden
- `package.json` — no new dependencies
