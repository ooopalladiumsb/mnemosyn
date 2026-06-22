# TASK — DeepSeek (Senior Technical Executor): implement Mnemosyne L4 Collective

**From:** Lead Architect · **Date:** 2026-06-23 · **Project:** `projects/mnemosyne/`
**Agent:** `main` (deepseek-v4-pro)

**Authoritative specs (read first, in order):**
1. `README.md` — charter & invariants (Memory Sovereignty: Vault DID owns memory; Agent DIDs are
   transient delegated writers)
2. `docs/spec/l4-collective-v0.1-draft.md` — L4 spec (this task implements it)
3. `docs/spec/l0-spine-v0.1-draft.md` + `docs/NOTES-deepseek-L1.md` — Ed25519 signing/verify machinery
   to reuse (`LocalSigned.anchor`, `verifyReceipt`, `ed25519PublicKeyFromSeed`)
4. `docs/NOTES-deepseek-L3.md` — your own recent style/precedents

You implement **bodies and tests**. The architect owns the **contracts**. The skeleton already
typechecks with `TODO`/`throw` stubs (`npm run typecheck` passes). Replace every stub. When done,
all gates in §3 must pass.

---

## 0. Rules of engagement (hard constraints)

1. DO NOT change frozen contracts — type names, field names, field order, signatures, or the
   `CAPABILITY_V1` literal. Frozen for L4:
   - `src/collective/capability.ts` — `Capability`, `CapabilityScope`, `CapabilityAction`,
     `CapabilityGrant`, `AccessRequest`, and the `capabilityId`/`issueGrant`/`verifyGrant`/
     `grantAuthorizes` signatures
   - `src/collective/authorizing-spine.ts` — `AuthorizingSpine`, `createAuthorizingSpine` signature
   - `src/canonical/domains.ts` (incl. the new `CAPABILITY_V1` tag) — architect-owned, do not edit
   - **What "frozen" means:** existing names/shapes/signatures are immutable; adding a NEW export or
     private helper is allowed.
2. **DO NOT MODIFY THE L0 SPINE.** `src/spine/**` and `src/canonical/**` are off-limits (the
   `CAPABILITY_V1` tag is already added by the architect). `AuthorizingSpine` WRAPS `createSpine` and
   calls its existing public `append`/`recallById`/`checkpoint` — it does not reach inside. This is
   the ratified design: enforcement is a separate layer, L0 stays byte-identical.
3. Reuse the EXISTING Ed25519 machinery (PKCS#8 seed→key, SPKI pubkey, `canonicalBytes`,
   `domainHash`, `vaultDidFromPubkey`) — do not hand-roll crypto or add deps. `proof` is the
   lowercase-hex signature over `canonicalBytes(capability)`; signing surface = the capability bytes.
4. Determinism: `capabilityId` is pure; no `Date.now()`/`Math.random()`/wall-clock anywhere hashed.
   AI-7 holds — no timestamp in a capability.
5. If you think a contract is wrong, STOP and write the objection in `docs/NOTES-deepseek-L4.md`.
6. No new runtime dependencies. Node 22 built-ins only.

---

## 1. Bodies to implement

`src/collective/capability.ts`
- `capabilityId(cap)` — `domainHash(CAPABILITY_V1, canonicalBytes(cap))`. Build the JCS object from
  the Capability fields; OMIT `parent` when undefined (it is reserved/absent in v1) so its presence
  never changes the v1 id. Document this rule in NOTES.
- `issueGrant(cap, authoritySeed)` — Ed25519-sign `canonicalBytes(cap)` with the raw 32-byte seed
  (mirror `LocalSigned`); return `{ capability: cap, capability_id: hex(capabilityId(cap)), proof:
  hex(sig) }`.
- `verifyGrant(grant, authorityPublicKey)` — return boolean; throw only on a non-32-byte pubkey.
  Check (1) `vaultDidFromPubkey(authorityPublicKey) === grant.capability.vault_did`, (2)
  `grant.capability_id === hex(capabilityId(grant.capability))`, (3) Ed25519-verify `grant.proof`
  over `canonicalBytes(grant.capability)`. ANY failing check → false (never throw on bad sig/hex).
- `grantAuthorizes(grant, req)` — scope check only (no crypto): vault match, grantee === writerDid,
  action ∈ scope.actions, and space allowed (`scope.spaces === "*"` or includes `req.space`).

`src/collective/authorizing-spine.ts`
- `createAuthorizingSpine({ spine, authorityPublicKey })` — return an `AuthorizingSpine` whose
  `append(input, grant)` enforces, in order: `verifyGrant` → `[COLLECTIVE_BAD_GRANT]`;
  `grantAuthorizes(grant, {vaultDid: input.vaultDid, space: input.space, action: "append",
  writerDid: input.writerDid})` → `[COLLECTIVE_UNAUTHORIZED]`; `input.capabilityId ===
  grant.capability_id` → `[COLLECTIVE_CAPABILITY_MISMATCH]`; then `return spine.append(input)`.
  `recallById` and `checkpoint` delegate straight to the wrapped spine.

---

## 2. Required tests (write these, under `test/`, e.g. `test/collective-l4.test.ts`)

1. `capabilityId` determinism: same cap → same id; differs when vault/grantee/scope changes;
   a cap with `parent: undefined` has the SAME id as one omitting `parent`.
2. `issueGrant` + `verifyGrant`: a real grant verifies true against `ed25519PublicKeyFromSeed(seed)`;
   a flipped byte in `capability`/`capability_id`/`proof` → false; wrong-length pubkey throws; a
   valid-length but wrong pubkey → false; a grant whose `vault_did` ≠ `vaultDidFromPubkey(pk)` → false.
2. `grantAuthorizes`: in-scope (explicit space, and `"*"`) → true; wrong grantee, wrong vault,
   out-of-scope space, unlisted action → false.
3. `AuthorizingSpine` happy path: a `LocalSigned`/`createSpine` write authorized by a matching grant
   succeeds and returns a normal `AppendReceipt` (object lands in the spine, recallById works).
4. `AuthorizingSpine` rejections (each throws its coded error): bad signature
   (`[COLLECTIVE_BAD_GRANT]`); grantee ≠ writer / out-of-scope space / wrong action
   (`[COLLECTIVE_UNAUTHORIZED]`); `input.capabilityId` ≠ `grant.capability_id`
   (`[COLLECTIVE_CAPABILITY_MISMATCH]`).
5. Multi-writer scenario: two Agent DIDs with two different grants (different scopes) both write to
   the SAME vault; each is admitted only within its scope; a cross-scope write is rejected.
6. **Spine untouched (structural):** assert `AuthorizingSpine` produces the SAME `vault_memory_root`
   for a given sequence as calling `spine.append` directly with the same inputs (the facade only
   gates; it does not alter what the spine commits).

## 2.1 Capability golden (anti-drift, PRE-NORMATIVE)

Extend the vector generator + a golden test so a FIXED authority seed and a FIXED set of capabilities
pin each `capability_id` (hex) and each `proof` (hex) — proving the id hashing AND the Ed25519
signature are byte-reproducible. Add `vectors/collective/golden.json` (fifth sibling); wire
`scripts/collective-scenario.ts` + extend `scripts/generate-vectors.ts` so `npm run vectors:generate`
produces all five byte-identically. Mark `_status` PRE-NORMATIVE.

---

## 3. Acceptance gates (all must pass — do not report done on red)

```
npm run typecheck
npm test                 # all existing 131 (L0..L3 + conformance) stay green + new L4, 0 fail
npm run test:conformance # unchanged (the same 9 conformance tests)
npm run vectors:generate # regenerates spine+anchor+recall+semantic+collective golden; tests match
```

Run via the **npm scripts exactly as written** (`node:test`), NOT `bun test`. Also confirm by
inspection: ZERO edits under `src/spine/**` and `src/canonical/**` (the `CAPABILITY_V1` tag is the
architect's, already present); `AuthorizingSpine` wraps `createSpine` unmodified; no wall-clock in
any hashed value; no new runtime deps.

---

## 4. NOTES (required deliverable — FINISH IT)

Write `docs/NOTES-deepseek-L4.md`: one entry per non-obvious decision —
- the `capabilityId` JCS shape and the `parent`-omission rule;
- the exact signing surface (`canonicalBytes(capability)`) and pubkey/vault binding in `verifyGrant`;
- how `AuthorizingSpine` proves the spine is unmodified (the same-root test);
- where the capability golden lives.
Then any **objection** (raise, don't silently fix). End with the gate results (counts) and the files
you touched.

You do not commit, push, or alter git history. Stay inside `projects/mnemosyne/`.
**Finish ALL deliverables (bodies + tests + golden + NOTES) before reporting done — the run is
complete only when `npm run vectors:generate` is green AND `docs/NOTES-deepseek-L4.md` exists.** Do
not stop at a mid-run summary.
