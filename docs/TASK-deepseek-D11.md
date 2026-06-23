# TASK — DeepSeek (Senior Technical Executor): implement Mnemosyne D11 TON AnchorAdapter

**From:** Lead Architect · **Date:** 2026-06-23 · **Project:** `projects/mnemosyne/`
**Agent:** `main` (deepseek-v4-pro) · **Plan:** `docs/PLAN-D11.md` (you are milestone M2)

**Authoritative specs (read first, in order):**
1. `docs/spec/d11-ton-anchor-v0.1-draft.md` — D11 spec (this task implements it)
2. `src/adapters/anchor.ts` — the `AnchorAdapter`/`AnchorReceipt` contract you implement against
3. `src/canonical/hash.ts` — `toHex`/`fromHex`; `src/canonical/...` for any hashing you need
4. `vectors/anchor-ton/terra-body-golden.json` — the terra conformance fixtures you MUST reproduce

You implement **bodies and tests**, OFFLINE only. The architect owns the contracts; the skeleton
typechecks with `[TODO_D11]` stubs. The LIVE testnet broadcast (PLAN M5) is operator-gated — NOT
your job; you implement the deterministic body + the `MockBroadcaster` + the adapter over it.

---

## 0. Rules of engagement (hard constraints)

1. DO NOT change frozen contracts. Frozen for D11:
   - `src/anchor-ton/anchor-body.ts` — `ANCHOR_OP`, `anchorBodyCell`/`anchorBodyBoc`/`parseAnchorRoot`
   - `src/anchor-ton/broadcaster.ts` — `BroadcastRequest`/`BroadcastResult`/`Broadcaster`/`MockBroadcaster`
   - `src/anchor-ton/ton-anchor.ts` — `TonAnchorAdapter`
   - **What "frozen" means:** existing names/shapes/signatures immutable; new exports OK.
2. **DO NOT EDIT anything outside `src/anchor-ton/` and `test/`.** Zero edits to `src/spine/**`,
   `src/canonical/**`, `src/adapters/**`, or any other layer. D11 is additive.
3. **Replicate terra, do not import it.** Build the body yourself with `@ton/core`; do NOT import
   from `projects/paradigm_terra` or add it as a dependency. The ONLY new dep is `@ton/core` (already
   installed); it may be imported ONLY from `src/anchor-ton/`.
4. **`@ton/core` isolation:** no file outside `src/anchor-ton/` may import `@ton/core`.
5. Determinism: `anchorBodyBoc` is pure; `MockBroadcaster` is deterministic (no network, no
   `Math.random`/wall-clock). No real network anywhere in D11.
6. If a contract seems wrong, STOP and write the objection in `docs/NOTES-deepseek-D11.md`.
7. No runtime deps beyond `@ton/core` (already present).

---

## 1. Bodies to implement

`src/anchor-ton/anchor-body.ts`
- `anchorBodyCell(rootHex)`: validate `rootHex` is `/^[0-9a-f]{64}$/` (lowercase, no `0x`) else throw
  `[ANCHOR_BAD_ROOT]`; return `beginCell().storeUint(ANCHOR_OP, 32).storeBuffer(Buffer.from(rootHex,
  "hex")).endCell()`. (Mirror terra exactly: op as a 32-bit uint, then the raw 32 bytes.)
- `anchorBodyBoc(rootHex)`: `anchorBodyCell(rootHex).toBoc().toString("base64")`.
- `parseAnchorRoot(cell)`: `loadUint(32)`; if `!== ANCHOR_OP` throw `[ANCHOR_BAD_OP]`; `loadBuffer(32)`
  → lowercase hex string (no `0x`).

`src/anchor-ton/broadcaster.ts` — `MockBroadcaster`
- `broadcast(req)`: `txHash = toHex(sha256(utf8(req.bodyBoc) || uint64be(req.version)))` (or a clearly
  documented deterministic derivation over `bodyBoc` + `version`); return `{ txHash }`. Pure,
  reproducible. Document the exact derivation in NOTES.

`src/anchor-ton/ton-anchor.ts` — `TonAnchorAdapter`
- `anchor(vaultDid, root, version)`: `const rootHex = toHex(root)`; `const bodyBoc =
  anchorBodyBoc(rootHex)`; `const { txHash } = await this.broadcaster.broadcast({ bodyBoc, vaultDid,
  version })`; record `{root: rootHex, version}` as latest for `vaultDid`; return `{ vaultDid, root:
  rootHex, version, proof: txHash }`.
- `latest(vaultDid)`: in-memory `Map<vaultDid, {root, version}>`; null if never anchored.

---

## 2. Required tests (write under `test/`, e.g. `test/anchor-ton-d11.test.ts`)

1. **Body conformance vs terra (load-bearing):** load `vectors/anchor-ton/terra-body-golden.json`;
   for each vector assert `anchorBodyBoc(root_hex) === boc_base64` (byte-identical to terra). This is
   the proof Mnemosyne reproduces terra's transport without importing it.
2. Round-trip: `parseAnchorRoot(anchorBodyCell(root)) === root` for several roots (incl. all-zero,
   all-ff); `anchorBodyCell` throws `[ANCHOR_BAD_ROOT]` on `0x`-prefixed / wrong-length / uppercase;
   `parseAnchorRoot` throws `[ANCHOR_BAD_OP]` on a cell built with a different op.
3. `MockBroadcaster`: deterministic (same request → same txHash); different body or version →
   different txHash.
4. `TonAnchorAdapter` over `MockBroadcaster`: `anchor()` returns a receipt whose `root` is the hex of
   the input, `version` matches, `proof` is the mock tx; the broadcast body parses back to the root;
   `latest()` reflects the last anchor and is null before any; a second anchor updates latest.
5. **`@ton/core` isolation (structural):** read every `.ts` under `src/` EXCEPT `src/anchor-ton/` and
   assert none imports `@ton/core`. One-way: only the anchor-ton module touches the TON lib.

## 2.1 Golden vectors
NONE new — `vectors/anchor-ton/terra-body-golden.json` is the VENDORED terra conformance fixture (do
not regenerate or edit it). Do NOT touch `scripts/generate-vectors.ts`; `npm run vectors:generate`
stays at five golden.

---

## 3. Acceptance gates (all must pass — do not report done on red)

```
npm run typecheck
npm test                 # all existing 192 stay green + new D11, 0 fail
npm run test:conformance # unchanged (9)
npm run vectors:generate # UNCHANGED — still five NORMATIVE golden
```

Run via the **npm scripts** (`node:test`), NOT `bun test`. Confirm by inspection: zero edits outside
`src/anchor-ton/` + `test/`; `@ton/core` imported ONLY from `src/anchor-ton/`; no terra import; no
network/wall-clock/random in any code path.

---

## 4. NOTES (required deliverable — FINISH IT)

Write `docs/NOTES-deepseek-D11.md`: the body-build mirroring of terra (op + storeBuffer); the
`MockBroadcaster` txHash derivation; how the conformance test pins terra's golden; how the isolation
test enforces the one-way `@ton/core` dependency. Then any **objection**. End with gate counts + files
touched.

You do not commit, push, broadcast, or alter git history. Stay inside `projects/mnemosyne/`.
**Finish ALL deliverables (bodies + tests + NOTES) before reporting done — complete only when
`npm test` is green AND `docs/NOTES-deepseek-D11.md` exists.** Do not stop at a mid-run summary.
