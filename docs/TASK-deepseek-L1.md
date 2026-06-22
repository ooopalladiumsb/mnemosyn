# TASK — DeepSeek (Senior Technical Executor): implement Mnemosyne L1 Anchor

**From:** Lead Architect · **Date:** 2026-06-21 · **Project:** `projects/mnemosyne/`
**Agent:** `mnemosyne-exec` (deepseek-v4-pro)

**Authoritative specs (read first, in order):**
1. `README.md` — charter & invariants (commitment line, build order)
2. `docs/spec/l1-anchor-v0.1-draft.md` — L1 spec (this task implements it)
3. `docs/spec/l0-spine-v0.1-draft.md` — L0 spine (anchor §6 checkpoint, identity, roots)
4. `docs/NOTES-deepseek.md` — your own L0 design choices (style + precedents to match)

You implement **bodies and tests**. The architect owns the **contracts**. The skeleton already
typechecks with `TODO`/`throw` stubs (`npm run typecheck` passes). Replace every stub with a real
implementation. When done, all gates in §3 must pass.

---

## 0. Rules of engagement (hard constraints)

1. DO NOT change frozen contracts — type names, field names, field order, signatures, or
   domain-tag literals. Frozen for L1:
   - `src/spine/types.ts`, `src/canonical/domains.ts` (incl. the new `ANCHOR_CHECKPOINT_V1` tag)
   - `AnchorReceipt`, `AnchorAdapter` in `src/adapters/anchor.ts`
   - all exported interfaces and function signatures in `src/adapters/checkpoint.ts`
   - `LocalSigned`'s constructor signature and the `anchor()`/`latest()` SIGNATURES
   - **What "frozen" means:** the EXISTING names/shapes/signatures above are immutable. Adding a
     NEW export (e.g. the `TonAnchor` seam) or a new private member to an otherwise-frozen file is
     allowed — you just may not alter or reorder anything already declared.
2. If you think a contract is wrong, STOP and write the objection in `docs/NOTES-deepseek-L1.md` —
   do not silently "fix" it. (Your L0 `created_at` objection is the model to follow.)
3. The signing surface is UNCHANGED: `LocalSigned.anchor()` keeps signing
   `canonicalBytes({root, vaultDid, version})`. Do not fold `prev`/`checkpoint_id` into the signed
   message in L1 (that is the deferred D5 line in the spec).
4. Determinism: `anchorCheckpointId` is pure; no `Date.now()`, no `Math.random()`, no wall-clock,
   no ambient ordering in anything hashed. AI-7 holds — no timestamp in a checkpoint.
5. No new runtime dependencies. Node 22 built-ins only (`node:crypto`, `node:fs`, `node:path`,
   `node:buffer`). Dev-only `tsx`/`typescript` already present.
6. Match L0 style: ESM `.js` import specifiers, strict TS, small focused functions, typed `Error`s
   with stable bracketed codes (e.g. `[ANCHOR_VERSION_REGRESSION]`).

---

## 1. Bodies to implement

`src/adapters/checkpoint.ts`
- `anchorCheckpointId(cp)` — `domainHash(ANCHOR_CHECKPOINT_V1, canonicalBytes(cp))`. Use the same
  `domainHash`/`canonicalBytes` the spine uses; `version` is a `bigint` (restricted-JCS integer).
- `verifyReceipt(receipt, authorityPublicKey)` — recompute `canonicalBytes({root, vaultDid,
  version})` and Ed25519-verify `receipt.proof` (hex) against the raw 32-byte pubkey. Return a
  boolean; never throw on a bad signature (only on a malformed pubkey length).
- `verifyCheckpointChain(chain)` — version gapless from 0; version 0 `prev == ZERO_HASH_HEX`; each
  later `prev == toHex(anchorCheckpointId(previous))`. Return `{ok:true}` or `{ok:false, brokenAt,
  reason}` with the first offending version. An EMPTY chain is vacuously valid → `{ok:true}`
  (consistent with `chain()` returning `[]` for a never-anchored vault).
- `ed25519PublicKeyFromSeed(seed)` — derive the raw 32-byte public key from the raw 32-byte seed
  via `node:crypto` (PKCS#8/SPKI round-trip, mirroring the seed→key helper already in `anchor.ts`).

`src/adapters/anchor.ts` — `LocalSigned`
- Extend `anchor()` to also build and record checkpoint `version` with
  `prev = current checkpointHead id (hex)` or `ZERO_HASH_HEX` at version 0, enforcing the §5
  monotonic / idempotent / gapless rules (`[ANCHOR_VERSION_REGRESSION]`,
  `[ANCHOR_VERSION_CONFLICT]`, `[ANCHOR_VERSION_GAP]`). Keep the returned `AnchorReceipt` and the
  signed message exactly as today.
- Implement `chain()` and `checkpointHead()`. These must work in BOTH modes — keep an in-memory
  per-vault chain structure (alongside `latestByVault`) so `chain()`/`checkpointHead()` are correct
  even when `options.dir` is unset (test §2.2 builds a 3-link chain with no `dir`).
- Durability: when `options.dir` is set, persist `latest` + the chain under `dir` with `node:fs`
  and recover on construction; when unset, stay in-memory (do not touch the filesystem). Persisted
  format is non-hashed JSON-of-hex — round-trip it exactly. `LocalSigned` is NOT vault-scoped
  (`vaultDid` is a method arg), so persistence MUST key per-vault; `vaultDid` is `memory://vault/<id>`
  and contains `:` and `/`, so sanitize/encode it into a filesystem-safe key (do not `path.join`
  the raw DID). Recovery MUST order each chain by `version`, not by readdir order.

`src/adapters/anchor.ts` (optional seam) — add `TonAnchor implements AnchorAdapter` whose
methods throw `[ANCHOR_NOT_AVAILABLE]`. Type-only; no network. Place it in `anchor.ts` next to
`LocalSigned` (NOT in `checkpoint.ts`, which is the pure-contract file); export it as a new symbol.

---

## 2. Required tests (write these)

Put new tests under `test/` (e.g. `test/anchor-l1.test.ts`) and conformance stays where it is.
1. `anchorCheckpointId` determinism: same input → same id across repeated calls; differs when
   `root`/`version`/`prev`/`vault_did` changes.
2. Chain building: three sequential `anchor()` calls produce versions 0,1,2 with correct `prev`
   links; `verifyCheckpointChain` returns `{ok:true}`.
3. Tamper detection: mutate a historical `root` in a copied chain → `verifyCheckpointChain` returns
   `ok:false` with the right `brokenAt`.
4. `verifyReceipt`: a real `LocalSigned` receipt verifies true against
   `ed25519PublicKeyFromSeed(seed)`; a flipped byte in `root`/`version`/`proof` verifies false;
   a wrong-length pubkey throws (per §1), while a valid-length-but-wrong pubkey returns false.
5. Adapter rules: regression, gap, and conflicting-root all throw their coded errors; idempotent
   re-anchor of the head returns an equal receipt AND does not grow the chain (assert
   `chain().length` is unchanged after the re-anchor).
   Also: `verifyCheckpointChain([])` returns `{ok:true}` (empty chain is vacuously valid).
6. Durability/restart: anchor versions 0..2 on `LocalSigned(seed, {dir})`, construct a FRESH
   `LocalSigned(seed, {dir})` on the same `dir`, assert `latest()` and `chain()` are identical.
   Use a `node:fs.mkdtemp` temp dir; clean it up.
7. AI-7: building a chain is independent of any `created_at` on the underlying objects (reuse the
   L0 scenario helpers in `scripts/`).

## 2.1 Golden vectors (anti-drift)

Extend the vector generator + a golden test so a FIXED seed and a FIXED sequence of roots pin:
each `checkpoint_id` (hex), each `proof` (hex), and the head `{checkpointId, version}`. This proves
the chain hashing AND the Ed25519 signature are byte-reproducible. Keep the existing
`vectors/spine/golden.json` working; add L1 vectors either there under a new key or in a sibling
file `vectors/anchor/golden.json` — your call, document it in NOTES. Mark `_status` PRE-NORMATIVE.

---

## 3. Acceptance gates (all must pass — do not report done on red)

```
npm run typecheck
npm test                 # all 45 existing tests (36 L0 + 9 conformance) stay green + new L1, 0 fail
npm run test:conformance # unchanged (the same 9 conformance tests, a subset of `npm test`)
npm run vectors:generate # regenerates; golden test then matches
```

Run the gates via the **npm scripts exactly as written** (they invoke `node --import tsx --test`,
i.e. `node:test`). Do NOT substitute `bun test` — it is a different test runner with different
discovery, and the gate is defined by `node:test`. (`npm test` already includes the 9 conformance
tests via the glob; `npm run test:conformance` is the same 9 in isolation, not 9 extra.)

Also confirm by inspection: no wall-clock in any hashed value; signing surface unchanged; no new
runtime deps in `package.json`.

---

## 4. NOTES (required deliverable)

Write `docs/NOTES-deepseek-L1.md`: one entry per non-obvious decision —
- persistence format + file layout under `dir`, and how recovery orders the chain;
- exact pubkey-derivation path (SPKI/PKCS#8 round-trip) and the raw-key byte slice you take;
- where you placed the L1 golden vectors and why;
- idempotency definition (what counts as "identical" head re-anchor).
Then any **objection** (raise, don't silently fix). End with the gate results (counts) and the list
of files you touched.

You do not commit, push, or alter git history. Stay inside `projects/mnemosyne/`.
