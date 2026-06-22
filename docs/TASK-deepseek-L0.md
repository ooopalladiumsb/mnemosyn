# TASK — DeepSeek (Senior Technical Executor): implement Mnemosyne L0 spine

**From:** Lead Architect · **Date:** 2026-06-14 · **Project:** `projects/mnemosyne/`
**Authoritative specs (read first, in order):**
1. `README.md` — charter & invariants
2. `docs/spec/l0-spine-v0.1-draft.md` — L0 spec
3. `../  prometheus/# TON AI MEMORY PROTOCOL — MNEMOSYNE L0 DECISION RECORD.md` — decisions D1–D4 + AI-7

You implement **bodies**. The architect owns the **contracts**. The skeleton already typechecks
(`npm run typecheck` passes with `TODO()` stubs). Replace every `TODO(...)` with a real
implementation. When you are done, `npm run typecheck`, `npm test`, and `npm run test:conformance`
must all pass.

---

## 0. Rules of engagement (hard constraints)

1. **DO NOT change frozen contracts.** These files define migration-hard shape — do not alter
   type names, field names, field order, signatures, or domain-tag literals:
   - `src/spine/types.ts`
   - `src/canonical/domains.ts`
   - all exported **interfaces** and **function signatures** in the stub files
   If you believe a contract is wrong, STOP and write your objection in
   `docs/NOTES-deepseek.md` — do not "fix" it silently.
2. **The commitment line is sacred.** No LLM, no embeddings, no fact-extraction, no network call
   may influence any hashed value. The spine is a pure, deterministic function of its inputs.
3. **AI-7:** ordering is `seqno` only. `created_at` must never affect ordering, hashing, or replay.
4. **D2:** `content_commit` is over **ciphertext** only; `content_ref = "mem:" + hex(content_commit)`;
   never put an adapter URI inside a MemoryObject.
5. **No new runtime dependencies.** Use Node 22 built-ins only (`node:crypto`, `node:fs`,
   `node:path`, `node:buffer`). Dev-only `tsx`/`typescript` already present.
6. **Determinism:** no `Date.now()`, no `Math.random()`, no wall-clock, no map/iteration-order
   dependence inside any function whose output is hashed. Sort explicitly where order matters.
7. Keep code style consistent with paradigm_terra `canonical/src/*` (ESM `.js` import specifiers,
   `strict` TS, small focused functions, throw typed `Error`s with stable codes).

---

## 1. Reference implementations to port (D1 — byte-identical)

Port these from paradigm_terra **verbatim in behaviour** (you may simplify file structure, but
output bytes must match). Source = `../paradigm_terra/canonical/src/`:

| Mnemosyne file | Port from terra | Notes |
|---|---|---|
| `src/canonical/hash.ts` | `hash.ts` | `sha256`, `domainHash`, `concatBytes` (+ add `toHex`/`fromHex`) |
| `src/canonical/integers.ts` | `integers.ts` | BE `encodeUint16`, `encodeUint64` |
| `src/canonical/strings.ts` | `strings.ts` + `unicodeAssigned.ts` | NFC restricted to Unicode 15.1 assigned set |
| `src/canonical/jcs.ts` | `jcs.ts` | restricted JCS, integers only, no dup keys, no lone surrogates |
| `src/canonical/merkle.ts` | `merkle.ts` | `binaryMerkle`, `streamLeafHash`, `streamTreeRoot`, `stateNamespaceLeafHash`, `stateRoot` — these MUST use the `CE_V13_TAGS` literals (already in `domains.ts`) so roots equal terra's |

---

## 2. Tasks

### T1 — Canonical primitives (`hash.ts`, `integers.ts`, `strings.ts`, `jcs.ts`)
Implement per §1. `domainHash(domain, payload) = sha256(utf8(domain) || payload)`. `toHex` =
lowercase, no `0x`. Throw on non-integer numbers in JCS, on out-of-range integers, on duplicate
object keys.

### T2 — Merkle / state (`merkle.ts`)
Implement `binaryMerkle` (CE §6 balanced binary, duplicate-last-on-odd per terra — match terra
exactly), `streamLeafHash`/`streamTreeRoot` (CE §6.3, leaves sorted by NFC UTF-8 byte order of
streamId), `stateNamespaceLeafHash`/`stateRoot` (CAL §7.3, namespaces sorted by name UTF-8 byte
order). Reject empty input where terra rejects it.

### T3 — Crypto (`crypto/encryption.ts`)
- `encrypt`: AES-256-GCM via `node:crypto`. Derive/accept a 32-byte vault KEK; generate a random
  12-byte nonce **inside encrypt only** (encryption is allowed non-determinism — it is NOT hashed
  into the spine; only the resulting ciphertext is). Return `{ ciphertext, enc }` with the GCM tag
  appended to or carried with the ciphertext (document your choice in a comment), `enc.nonce_b64`,
  `enc.key_id`, `enc.wrap_b64` (per-object DEK wrapped by KEK; if you use the KEK directly as DEK
  for v0, set `wrap_b64=""` and document it).
- `decrypt`: inverse, authenticated; throw on tag mismatch.
- `contentCommit(ciphertext) = domainHash(MEMORY_CONTENT_V1, ciphertext)`.
- `contentIdentity(plaintext, key) = HMAC-SHA256(key, plaintext)` via `node:crypto`. Document that
  it is owner-local and never anchored.

### T4 — Identity (`identity/did.ts`)
- `vaultDidFromPubkey`: `memory://vault/` + Crockford/RFC4648 base32 (no padding) of the 32-byte
  pubkey (pick one, document it; lowercase the alphabet decision). `isVaultDid` validates prefix +
  charset + decoded length 32.
- `agentDid(scheme,id) = "agent:" + scheme + ":" + id` with validation that scheme/id are
  non-empty and contain no `:` that breaks parsing.

### T5 — Spine
- **T5a `object.ts`**: `memoryObjectCanonicalBytes` = `canonicalBytes` over the MemoryObject mapped
  to a JCS-admissible object. Field set and order are FIXED by `types.ts` — serialize all fields
  except derived ones consistently; treat `seqno`/`created_at` as integers (bigint ok). Omit
  `created_at` from the canonical object iff it is `undefined` (document the rule; it must be
  stable). `memoryObjectId = hex(domainHash(MEMORY_OBJECT_V1, canonicalBytes))`. `metaCommit`
  likewise over `PublicMeta`.
- **T5b `space.ts`**: `streamId = vaultDid + "/" + space`. `spaceStateHash =
  domainHash(MEMORY_SPACE_V1, canonicalBytes({count, objects_root: hex(binaryMerkle(objectIds…))}))`.
  Define and document the empty-space sentinel (e.g. `objects_root = hex(32 zero bytes)` when no
  objects). `spaceStreamLeaf` builds the `StreamLeaf` (`stateHash`, `lastEventHash` decoded from
  hex, `lastSeqno = count`).
- **T5c `vault.ts`**: `vaultMemoryRoot = stateRoot(spaces.map(s => ({name: s.space,
  canonicalBytes: spaceStateHash(s)})))`.
- **T5d `spine.ts`**: implement `createSpine`. `append`:
  1. `content_commit = hex(contentCommit(ciphertext))`
  2. `content_ref = "mem:" + content_commit`; `storage.put(content_ref, ciphertext)`
  3. `seqno = store.spaceCount(vault, space)`
  4. build `MemoryObject` with `prev = store.spaceHeadHash(...)`, `meta_commit`, `schema_version=1`
  5. `object_id = memoryObjectId(obj)`; `store.putObject(obj)` (store updates the space head)
  6. recompute `space_state` and `vault_memory_root` over `store.listSpaces`
  7. return `AppendReceipt`
  `recallById`: load obj, `storage.get(obj.content_ref)`, return both (decryption is the caller's
  concern in L0 — do NOT require a KEK here). `checkpoint`: compute current `vault_memory_root`,
  call `anchor.anchor(vault, root, version)`, version = monotonic from `anchor.latest`+1 (or 0).

### T6 — Storage adapter (`adapters/storage.ts`)
`LocalCAS`: store bytes at `rootDir/<first2hex>/<hex>` derived from the `mem:` ref. `put` is
idempotent (same ref+bytes is a no-op; same ref + DIFFERENT bytes MUST throw — content-address
integrity). `get` throws if missing. `has` returns existence.

### T7 — Anchor adapter (`adapters/anchor.ts`)
`LocalSigned`: Ed25519-sign (`node:crypto`) the canonical bytes of `{vaultDid, root: hex,
version}`; persist latest per vault (in-memory map is fine for L0, but document persistence is
out of scope). `proof = hex(signature)`. `latest` returns the stored `{root, version}` or null.

### T8 — Tests & vectors
1. **Conformance (`test/conformance/canonical.test.ts`)** — assert Mnemosyne primitives are
   byte-identical to terra. Load `../paradigm_terra/canonical/vectors/golden.json`; for every
   entry covering `sha256`/`domainHash`/`integers`/`jcs`/`merkle`/`stateRoot` that uses the shared
   `CE_V13` tags, assert equality. Where terra's vectors use `PARADIGM_TERRA_*` tags that map to
   `CE_V13_TAGS`, they apply directly; skip terra-only tags (CAL/MCP/DSL) with a logged note.
2. **Unit tests** per module (`test/hash.test.ts`, `test/jcs.test.ts`, `test/merkle.test.ts`,
   `test/object.test.ts`, `test/spine.test.ts`, `test/identity.test.ts`, `test/crypto.test.ts`).
   Use Node's built-in `node:test` + `node:assert/strict` (same as terra).
3. **Spine golden (`test/spine-golden.test.ts` + `vectors/spine/golden.json`)** — a fixed seeded
   scenario: one vault, 2 spaces (`dialog`, `code`), 3 appends each in a fixed order with FIXED
   ciphertext byte arrays (not encrypted live — feed deterministic bytes so the test is
   reproducible), assert the resulting `object_id`s, `space_state`s, and final `vault_memory_root`
   match the committed vector. Provide `scripts/generate-vectors.ts` to (re)generate it. Mark the
   vector **PRE-NORMATIVE** in a top-level `"_status"` field — the architect promotes it.
4. **AI-7 test**: two appends with `created_at` in DESC order still produce ascending `seqno` and a
   `vault_memory_root` independent of the `created_at` values (prove by appending the same scenario
   with different `created_at`s → identical roots).
5. **D2 test**: `content_ref` always equals `"mem:"+content_commit`; storing different bytes under
   the same ref throws.

---

## 3. Definition of Done

- [ ] `npm run typecheck` clean (no `any`, strict passes).
- [ ] `npm test` green; `npm run test:conformance` green (byte-identical to terra).
- [ ] No `TODO(deepseek)` markers remain in `src/`.
- [ ] No new runtime dependencies in `package.json`.
- [ ] No frozen contract was modified (diff of `types.ts` / `domains.ts` is empty).
- [ ] `docs/NOTES-deepseek.md` lists: every design choice you documented (GCM tag placement,
      base32 alphabet, empty-space sentinel, created_at omission rule), and any objection.
- [ ] Spine golden vector committed under `vectors/spine/golden.json` with `"_status":"PRE-NORMATIVE"`.

## 4. Deliverable

A single changeset implementing the above. Do not refactor unrelated files. Do not add the Brain,
embeddings, anchor-to-TON, or any L1+ feature — those are out of scope and will be rejected.

---

## 5. Review checklist (what the architect will verify on return)

The architect will independently check, and reject on any failure:
1. **Contract integrity** — `git diff` shows `src/spine/types.ts` and `src/canonical/domains.ts`
   unchanged; all public signatures intact.
2. **Determinism/commitment line** — grep for `Date.now`, `Math.random`, `process.env`, network
   imports inside `src/canonical`, `src/spine`, `src/crypto` hashed paths → must be none (random
   nonce is allowed ONLY inside `encrypt`).
3. **Conformance is real** — confirm the conformance test actually loads terra's `golden.json` and
   compares non-trivially (not a stubbed `assert(true)`); spot-check 2 values by hand.
4. **AI-7 & D2** — the dedicated tests exist and genuinely vary `created_at` / mismatch bytes.
5. **Spine golden reproduces** — delete `vectors/spine/golden.json`, run `vectors:generate`, diff
   → identical (proves the generator is deterministic and matches the committed vector).
6. **No scope creep** — no L1+ code; no extra deps.
7. **Read `docs/NOTES-deepseek.md`** — every non-obvious choice is documented and defensible.
