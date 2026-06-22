# Mnemosyne L4 — Collective (multi-writer delegation)

**Version:** v0.1-draft · **Status:** DRAFT (migration-hard surface; review before code)
**Depends on:** L0 Spine v0.1 (`MemoryObject.writer_did` + `capability_id`, `VaultDid`/`AgentDid`).

L0–L3 assume a single writer. **L4 opens memory to a collective** — `{Claude, GPT, Gemini, DeepSeek,
CAL agents} → one Mnemosyne`, the charter's north star. A Vault authority delegates **scoped write
capabilities** to Agent DIDs; an append is admitted only if its writer holds a valid grant. This is
the layer that gives operational meaning to `writer_did` and `capability_id`, which the spine has
committed since L0 and D4 explicitly reserved for "delegation + enforcement at L4."

---

## 1. Why L4 is NOT an out-of-root layer

L2/L3 are derived projections; their defining gate is the out-of-root invariant. **L4 is the
opposite: it lives IN the authorization path of a write.** A `Capability` is hashable
(`capability_id = domainHash(CAPABILITY_V1, …)`) and the object's `capability_id` references the
grant that authorized it. So L4's gate is **authorization correctness + capability determinism**, not
root-independence.

But L4 stays **additive to the frozen L0 spine** (ratified): enforcement lives in a SEPARATE
verifier and an `AuthorizingSpine` facade that calls the existing `spine.append` after checks pass.
`createSpine`/`append` are NOT modified — a caller who ignores L4 keeps byte-identical L0 behaviour.

---

## 2. What L4 adds (and deliberately does not)

Adds:
- A hashable, signed **`Capability`** (Vault → Agent delegation) + `capabilityId` derivation under the
  new `CAPABILITY_V1` domain tag.
- Pure **issue / verify / authorize** functions (`issueGrant`, `verifyGrant`, `grantAuthorizes`).
- An **`AuthorizingSpine`** facade that enforces a grant before delegating to the frozen spine.

Out of scope (later/never in v1): **delegation chains** — v1 is SINGLE-LEVEL (vault → agent
directly); `Capability.parent` is reserved (kept undefined) for a future chain model, a Decision
Record, not a silent extension. Also deferred: read/recall authorization (reads are unguarded in
v1), capability revocation lists, wall-clock expiry (would break AI-7 — any future expiry must be a
logical bound, not a clock).

---

## 3. Capability model (D8 — single-level, chain-ready)

```
type CapabilityAction = "append"                      // v1 guards append only; reads unguarded
interface CapabilityScope { spaces: string[] | "*"; actions: CapabilityAction[] }
interface Capability {
  schema_version: 1
  vault_did: VaultDid          // the granting authority's vault
  grantee:   AgentDid          // receives the write right (== object.writer_did)
  scope:     CapabilityScope
  parent?:   CapabilityId      // RESERVED for chains; omitted in v1
}
capability_id = domainHash(CAPABILITY_V1, canonicalBytes(Capability))
interface CapabilityGrant { capability: Capability; capability_id: hex; proof: hex }
```

- Canonicalized via restricted-JCS (integers only); `capabilityId` is **pure** → golden-pinnable.
- **No wall-clock** appears in a capability (AI-7 holds at L4 too).
- `proof` = Ed25519 signature by the **Vault authority key** over `canonicalBytes(capability)`. The
  Vault authority key is the same key whose pubkey defines the Vault DID
  (`vaultDidFromPubkey`), reusing the L1 signing machinery. Ed25519 is deterministic → `proof` is
  golden-pinnable.

---

## 4. Verification & authorization (pure, offline)

```
issueGrant(cap, authoritySeed): CapabilityGrant        // sign with raw 32-byte vault seed
verifyGrant(grant, authorityPubkey): boolean           // authenticity
grantAuthorizes(grant, req): boolean                   // scope check
```

- **`verifyGrant`** checks three things and returns a boolean (throws only on malformed pubkey
  length, mirroring L1 `verifyReceipt`): (1) `vaultDidFromPubkey(authorityPubkey) ===
  capability.vault_did`; (2) `grant.capability_id` equals the recomputed `capabilityId`; (3) the
  Ed25519 `proof` verifies over `canonicalBytes(capability)`.
- **`grantAuthorizes`** is the scope check ONLY (authenticity is `verifyGrant`'s job):
  `capability.vault_did === req.vaultDid` ∧ `capability.grantee === req.writerDid` ∧ `req.action ∈
  scope.actions` ∧ (`scope.spaces === "*"` ∨ `req.space ∈ scope.spaces`).

Separating the two keeps each pure and individually testable; the facade composes them.

---

## 5. AuthorizingSpine (frozen L0 wrapped, not modified)

```
createAuthorizingSpine({ spine, authorityPublicKey }): AuthorizingSpine
AuthorizingSpine.append(input, grant): Promise<AppendReceipt>
```

`append(input, grant)` admits the write iff ALL hold, else throws the coded error:
1. `verifyGrant(grant, authorityPublicKey)` — else `[COLLECTIVE_BAD_GRANT]`.
2. `grantAuthorizes(grant, {vaultDid: input.vaultDid, space: input.space, action: "append",
   writerDid: input.writerDid})` — else `[COLLECTIVE_UNAUTHORIZED]`.
3. `input.capabilityId === grant.capability_id` — else `[COLLECTIVE_CAPABILITY_MISMATCH]` (the
   committed object must reference the grant that authorized it).
4. then `return spine.append(input)` — the UNMODIFIED L0 append.

`recallById`/`checkpoint` pass straight through (reads unguarded in v1). The spine is consulted
through its public interface only; `src/spine/**` is not edited.

---

## 6. Conformance & gates

L4 is DONE only when all pass:
1. `npm run typecheck` — clean.
2. `npm test` — L0–L3's existing tests stay green (no regression) + new L4 tests.
3. `npm run test:conformance` — unchanged.
4. **Authorization correctness** — the load-bearing gate: a valid grant admits an append; each of
   wrong-writer / out-of-scope-space / unauthorized-action / bad-signature / wrong-vault /
   capability-id-mismatch is REJECTED with its coded error.
5. **Capability golden** (PRE-NORMATIVE) — a fixed authority seed + fixed capabilities pin each
   `capability_id` and `proof` (deterministic Ed25519), regenerated byte-identically by
   `npm run vectors:generate`.
6. **Spine untouched** — structural: `src/spine/**` and `src/canonical/**` (except the additive
   `CAPABILITY_V1` tag) are not edited; `AuthorizingSpine` wraps `createSpine` without modifying it.
7. AI-7 — no wall-clock in any capability; `capabilityId` pure. No new runtime deps.

---

## 7. Decision (proposed — ratify before merge)

**D8 (L4 collective).** Multi-writer delegation as an additive authorization layer over the frozen
L0 spine. A hashable, Vault-signed `Capability` (new `CAPABILITY_V1` tag) grants scoped append
rights to an Agent DID; pure `issueGrant`/`verifyGrant`/`grantAuthorizes`; an `AuthorizingSpine`
facade enforces a grant before calling the UNMODIFIED `spine.append`. v1 is single-level (vault →
agent); `Capability.parent` is reserved for future delegation chains; reads are unguarded; no
wall-clock (AI-7). Enforcement is a separate verifier — `createSpine`/`append` are NOT changed
(ratified). Migration-hard surface frozen by D8: `Capability`/`CapabilityScope`/`CapabilityAction`,
`CapabilityGrant`, `AccessRequest`, the `CAPABILITY_V1` derivation, and the
`capabilityId`/`issueGrant`/`verifyGrant`/`grantAuthorizes`/`createAuthorizingSpine` signatures.
Authorization correctness (§6.4) is the controlling acceptance criterion.
