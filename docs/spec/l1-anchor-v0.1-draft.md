# Mnemosyne L1 — Durable Verifiable Anchor

**Version:** v0.1-draft · **Status:** DRAFT (migration-hard surface; review before code)
**Depends on:** L0 Spine v0.1 (`vault_memory_root`, `LocalSigned`, `AnchorReceipt`)

L0 produces a per-vault `vault_memory_root` and `LocalSigned` signs a single *latest* receipt
held in memory. L1 turns anchoring into a **durable, tamper-evident, third-party-verifiable
history** — without changing the L0 signing surface and without letting any non-deterministic
value reach a hashed byte.

---

## 1. What L1 adds (and deliberately does not)

Adds:
- A **hash-linked checkpoint chain** per vault — each anchor commits to its predecessor.
- **Durability** — `LocalSigned` can persist `latest` + chain to disk and recover after restart.
- **Verification** — pure, offline functions a third party runs with only the authority pubkey.
- **Monotonicity + idempotency** rules enforced at the adapter.
- A typed **`TonAnchor` seam** (optional target) that does not require any live network in L1.

Out of scope (later layers): live on-chain anchoring to TON/paradigm_terra (network), L2 recall,
key rotation / ownership transfer (touches the Vault authority model, a Decision-Record change).

---

## 2. New domain tag (`MNEMOSYNE_*` namespace)

| Tag constant | Literal | Use |
|---|---|---|
| `ANCHOR_CHECKPOINT_V1` | `MNEMOSYNE_ANCHOR_CHECKPOINT_V1` | one checkpoint-chain link |

Same machinery as CE §7 (ASCII literal prefixed before SHA-256). Added to the frozen registry
in `src/canonical/domains.ts` by the architect (D5).

---

## 3. AnchorCheckpoint (immutable chain link)

```
AnchorCheckpoint {
  vault_did : string        // memory://vault/<id>
  version   : uint64        // gapless from 0
  root      : hash256(hex)  // hex(vault_memory_root) at this version
  prev      : hash256(hex)  // checkpoint_id of version-1, or ZERO_HASH_HEX at version 0
}

checkpoint_id = domainHash(ANCHOR_CHECKPOINT_V1, canonicalBytes(AnchorCheckpoint))
```

- Canonicalized via restricted-JCS (integers only); `version` is a `bigint`. JCS byte-sorts keys,
  so object field order does not affect the hash — but the TS field order is frozen for clarity.
- `anchorCheckpointId` is a **pure function** → golden-vector pinned.
- No wall-clock appears in a checkpoint (AI-7 holds at L1 too).

The chain is the anchor analogue of the L0 object `prev` chain: tampering with any historical root
breaks every subsequent `checkpoint_id`.

---

## 4. Signing surface (UNCHANGED from L0)

`LocalSigned.anchor()` continues to Ed25519-sign `canonicalBytes({root, vaultDid, version})` and
return the existing `AnchorReceipt {vaultDid, root, version, proof}`. L1 does **not** change what is
signed — it adds the chain *alongside* the receipt. Rationale: keep the L0 receipt contract and any
existing receipts valid; the chain provides history integrity via hashing, the signature provides
authority over the latest root+version.

> Ed25519 (RFC 8032) is deterministic: `sign(seed, message)` is byte-identical across runs and
> implementations. Therefore the `proof` itself is golden-vector pinnable (see §8 gate).

Deferred (candidate L2/Decision-Record): signing the `checkpoint_id` (binding `prev`) so authority
covers history ordering, not only the latest root. Recorded here as a known scoping line.

---

## 5. Durable adapter contract

```ts
interface DurableAnchorAdapter extends AnchorAdapter {
  chain(vaultDid): Promise<readonly AnchorCheckpoint[]>;               // oldest→newest, [] if none
  checkpointHead(vaultDid): Promise<{ checkpointId: string; version: bigint } | null>;
}
```

`LocalSigned` implements `DurableAnchorAdapter`. New optional constructor arg
`options?: { dir?: string }` (additive, backward compatible — `new LocalSigned(seed)` keeps L0
in-memory behaviour byte-for-byte):
- `dir` given → persist `latest` + the full chain under `dir` (`node:fs`), recover on construction.
- `dir` omitted → in-memory only (L0 behaviour, no file I/O).

Anchor semantics (both modes):
- `anchor(vault, root, version)` appends checkpoint `version` with `prev = checkpointHead.id` (or
  `ZERO_HASH_HEX` at version 0).
- **Monotonic:** a `version` lower than the head is rejected (`[ANCHOR_VERSION_REGRESSION]`).
- **Idempotent:** re-anchoring the head `(version, root)` identically is a no-op returning the same
  receipt; the same `version` with a *different* `root` is rejected (`[ANCHOR_VERSION_CONFLICT]`).
- **Gapless:** `version` must equal `head.version + 1` (or 0 for the first); a gap is rejected
  (`[ANCHOR_VERSION_GAP]`).

Persistence format is an implementation detail (NOT hashed, NOT a committed surface); it must
round-trip the chain and latest exactly. Keep it boring JSON-of-hex under `dir`.

---

## 6. Verification (pure, offline, third-party)

```ts
verifyReceipt(receipt, authorityPublicKey): boolean
verifyCheckpointChain(chain): { ok, brokenAt?, reason? }
ed25519PublicKeyFromSeed(seed): Uint8Array   // helper for tests / key publication
```

- `verifyReceipt` recomputes `canonicalBytes({root, vaultDid, version})` and Ed25519-verifies
  `proof` against the raw 32-byte pubkey. No private key, no adapter, no network.
- `verifyCheckpointChain` checks: version gapless from 0; version 0's `prev == ZERO_HASH_HEX`; every
  later `prev == anchorCheckpointId(previous)` (hex). Returns the first bad `version` as `brokenAt`.
  Signatures are out of scope here (the signed head is checked via `verifyReceipt`).

Verification is what makes "sovereign, portable memory" real: anyone given `(chain, head receipt,
authority pubkey)` can confirm the latest root is authority-signed and the history is intact, with
no access to Mnemosyne internals.

---

## 7. Optional TON seam

A `TonAnchor implements AnchorAdapter` typed stub whose methods throw `[ANCHOR_NOT_AVAILABLE]`
until wired to paradigm_terra. It exists so Mode-2/Mode-3 callers can target it by type today; a
live testnet anchor is a later, network-gated deliverable (mirrors terra's PP settlements) and is
NOT part of any L1 offline gate.

---

## 8. Conformance & gates (anti-drift)

L1 is DONE only when all pass:
1. `npm run typecheck` — clean.
2. `npm test` — all 45 existing tests (36 L0 + 9 conformance) stay green (no regression) + new L1
   tests. Run via the npm scripts (`node:test`), not `bun test`.
3. `npm run test:conformance` — unchanged (the same 9 conformance tests, a subset of `npm test`;
   shared CE primitives still byte-identical to terra).
4. New L1 golden vectors pin, for a FIXED seed + fixed root sequence: each `checkpoint_id`, each
   `proof`, and the head — proving the chain AND the Ed25519 signature are reproducible.
5. AI-7 still holds: no wall-clock in any checkpoint; chain/root independent of `created_at`.
6. Durability: a `LocalSigned({dir})` anchored across a *fresh instance* recovers identical
   `latest` + `chain` (restart test).

---

## 9. Decision (proposed — ratify before merge)

**D5 (L1 anchor).** Durable hash-linked checkpoint chain under `ANCHOR_CHECKPOINT_V1`; signing
surface unchanged from L0; durability is an additive optional `LocalSigned` mode; live TON anchoring
deferred to a network-gated deliverable. Migration-hard surface frozen by D5: `AnchorCheckpoint`
shape, `checkpoint_id` derivation, `DurableAnchorAdapter`, and the verification signatures.
