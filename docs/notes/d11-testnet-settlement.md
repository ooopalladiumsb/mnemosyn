# D11 — TON testnet settlement (PLAN-D11 M5) — SETTLED

**Date:** 2026-06-23 · **Network:** ton-testnet · **Status:** ✅ SETTLED (on-chain body byte-identical to pinned)

The first live on-chain anchor of a Mnemosyne `vault_memory_root`, via paradigm_terra's anchor-body
transport. Closes "L1 for real" and is the first live link between the two projects.

## What was anchored
- **root** (Mnemosyne spine-golden `final_vault_memory_root`, NORMATIVE):
  `36e56378996fdce46735571d866a779cd0283ad3c5a697a389652e6265b39edf`
- **pinned anchor body** (`anchorBodyBoc(root)`, op "PTA1" || root:256):
  `te6cckEBAQEAJgAASFBUQTE25WN4mW/c5Gc1Vx2Ganec0Cg608Wml6OJZS5iZbOe3+awn70=`
- **pinned body cell hash:** `6fb9e8a81cf56df9d8bc656e66579730492f4e89aeb1ee0f010ec47b73ef9215`

## How (operator-gated, key-safe)
- Operator signed a self-transfer LOCALLY (mnemonic never left the operator machine; sign-and-print
  pattern), message body = the anchor body cell. Operator: `0:28f02e39…ce1c1b8`
  (`0QAo8C45…XnOHBuN9j`), W5R1 testnet, seqno 5.
- The signed external BoC was pre-verified offline (the anchor op+root present inline; cell-hash
  cross-check) then relayed via `toncenter /sendBoc` → HTTP 200 `{"@type":"ok"}`.

## On-chain verification (the gate — "verify body, not word")
- Settlement tx (in_msg carries the body cell): **`VGhMnVF/8DHfe9SkesuX0VIx/T96LCQSjZXuaf/PrR8=`**
  · lt `78598093000001` · utime `1782244416` (2026-06-23T19:53:36Z) · src→dst self-transfer
  (`EQAo8C45…BuDks` → itself).
- Wallet tx (out_msg, body inlined): `YbBa9v5gODdSavaG90WNVM3OGBzpvIQbhtqLwFUdp3U=`.
- **On-chain message body cell hash == pinned body cell hash (`6fb9e8a8…9215`) — BYTE-IDENTICAL.**
  Stronger than a string compare; mirrors terra's PP-settlement discipline.

## Scope
Testnet only. Mainnet, a standing anchor daemon, and a live `Broadcaster` shipped in the lib are
out of scope (the lib ships the deterministic body + `MockBroadcaster`; live broadcast stays
operator tooling). The conformance gate (`anchorBodyBoc` == terra golden, 4/4) guarantees any future
root anchors in the identical, terra-recognized transport.
