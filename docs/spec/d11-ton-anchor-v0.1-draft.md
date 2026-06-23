# Mnemosyne D11 — TON AnchorAdapter (over paradigm_terra)

**Version:** v0.1-draft · **Status:** DRAFT (review before code)
**Depends on:** v1.1.0 (`AnchorAdapter`, `vault_memory_root`); paradigm_terra anchor-body transport.
**Plan:** `docs/PLAN-D11.md` (control doc; this spec is milestone M1).

Today `LocalSigned` anchors a root with an OFFLINE Ed25519 signature and the L1 `TonAnchor` is a
stub. D11 gives Mnemosyne a **real on-chain anchor**: the `vault_memory_root` settled on TON using
paradigm_terra's proven anchor-body transport. First live link between the two projects; closes "L1
for real".

---

## 1. Discipline — adapter boundary, not runtime coupling (D9-ratified)

Mnemosyne **replicates** terra's anchor-body format and **conformance-pins** it against terra's
golden — it does NOT import or fork terra's consensus-frozen (PFC-1) runtime. Spec-compatible, not
runtime-coupled, exactly as CE v1.3 is vendored. If terra ever changes the format, the conformance
test fails loudly.

`@ton/core` (the same reference TON lib terra uses for Cell/BoC) is the **one runtime dependency**,
ISOLATED to `src/anchor-ton/`. The pure spine (L0–D10) stays dependency-free and never imports it.

---

## 2. Anchor body (replicated, terra-identical)

```
anchor body cell = op:uint32 (ANCHOR_OP "PTA1" = 0x50544131) || root:256bit raw (32 bytes)
```

- `ANCHOR_OP` is ASCII "PTA1" — terra's "Paradigm Terra Anchor v1" transport, REUSED so terra's
  verification/indexing recognizes a Mnemosyne anchor (same transport, payload = Mnemosyne's
  `vault_memory_root` instead of terra's STATE_ROOT).
- `anchorBodyCell(rootHex)` / `anchorBodyBoc(rootHex)` / `parseAnchorRoot(cell)` — `rootHex` is the
  Mnemosyne root format: **lowercase 64-hex, no `0x`** (as `AnchorReceipt.root`). Malformed →
  `[ANCHOR_BAD_ROOT]`; wrong op on parse → `[ANCHOR_BAD_OP]`.
- **Pure & byte-reproducible** → conformance-pinned (see §5).

---

## 3. Broadcaster seam (the network boundary, operator-gated)

```
interface BroadcastRequest { bodyBoc: string; vaultDid; version: bigint }
interface BroadcastResult  { txHash: string }
interface Broadcaster { name: string; broadcast(req): Promise<BroadcastResult> }
```

Building the body is deterministic and offline; SENDING it (W5 wrap + operator signature + submit to
a TON node) needs a funded wallet + live network — OPERATOR-GATED, behind this seam. Real impls wrap
a TON client + the operator key. **`MockBroadcaster`** returns a deterministic fake `txHash` =
`SHA-256(bodyBoc || version)` hex — no network, no key — so the adapter is testable offline.

The operator key NEVER lives in the deterministic core — it is the broadcaster's concern (and, in a
hardened deployment, a TEE's).

---

## 4. TonAnchorAdapter

```
class TonAnchorAdapter implements AnchorAdapter {
  constructor(broadcaster: Broadcaster)
  anchor(vaultDid, root, version): Promise<AnchorReceipt>   // build body → broadcast → {proof: txHash}
  latest(vaultDid): Promise<{root, version} | null>          // in-memory last-anchored per vault
}
```

`anchor()`: `anchorBodyBoc(toHex(root))` → `broadcaster.broadcast({bodyBoc, vaultDid, version})` →
`AnchorReceipt { vaultDid, root: hex, version, proof: txHash }`; record `latest`. Supersedes the L1
`TonAnchor` stub. Durable/on-chain `latest` read-back is a later deliverable.

---

## 5. Conformance & gates (OFFLINE — what merges)

D11 (offline) is DONE only when all pass:
1. `npm run typecheck` — clean (with `@ton/core`).
2. `npm test` — v1.1.0's 192 stay green + new D11 tests.
3. `npm run test:conformance` — unchanged (the 9 CE conformance tests).
4. **Body conformance vs terra (load-bearing):** for every vector in
   `vectors/anchor-ton/terra-body-golden.json`, `anchorBodyBoc(root_hex)` equals the pinned
   `boc_base64` byte-for-byte (proves Mnemosyne reproduces terra's transport without importing it);
   `parseAnchorRoot(anchorBodyCell(root))` round-trips.
5. **Adapter:** `TonAnchorAdapter` over a `MockBroadcaster` produces an `AnchorReceipt` whose `proof`
   is the mock tx and whose body (recoverable from the broadcast request) parses back to `root`;
   `latest` reflects the last anchor; deterministic.
6. **Isolation (structural):** only `src/anchor-ton/**` imports `@ton/core`; `src/spine/**`,
   `src/canonical/**`, and the rest of the core do not. `@ton/core` is a `dependencies` entry (not
   dev); the core remains usable without ever loading it.
7. `npm run vectors:generate` — UNCHANGED (still five NORMATIVE golden; the terra-body fixture is a
   vendored conformance input, not generated here).

## 5.1 LIVE settlement (operator-gated — NOT part of the offline merge)

Per `PLAN-D11.md` M5: an operator broadcasts a real `vault_memory_root` to ton-testnet with a funded
wallet, and Claude verifies the **on-chain body is byte-identical to the pinned body** before any
"settled" ruling (terra's recorded lesson — verify the body, not the operator's word). This is a
network-gated deliverable; DeepSeek does NOT do it.

---

## 6. Decision (proposed — ratify before merge)

**D11 (TON AnchorAdapter).** A real `AnchorAdapter` that settles `vault_memory_root` on TON via a
REPLICATED terra anchor-body transport (op "PTA1" + 256-bit root), conformance-pinned against terra's
golden and built with `@ton/core` (the one runtime dep, isolated to `src/anchor-ton/`). The network
boundary is an injected `Broadcaster` (offline `MockBroadcaster`; live = operator-gated); the
operator key never enters the core. No terra runtime import; no consensus re-freeze; the pure spine
stays dep-free. Migration-hard surface frozen by D11: `ANCHOR_OP` + `anchorBodyCell`/`anchorBodyBoc`/
`parseAnchorRoot`, `BroadcastRequest`/`BroadcastResult`/`Broadcaster`/`MockBroadcaster`, and
`TonAnchorAdapter`. Body conformance vs terra (§5.4) + the live on-chain body match (§5.1) are the
controlling acceptance criteria.
