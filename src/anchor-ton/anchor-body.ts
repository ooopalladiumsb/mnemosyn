/**
 * D11 — TON anchor body (the on-chain transport for `vault_memory_root`). REPLICATES
 * paradigm_terra `pp2/src/anchor-body.ts` byte-for-byte: a Mnemosyne memory root rides terra's
 * proven anchor transport so terra's verification/indexing recognizes it. Spec-compatible, NOT
 * runtime-coupled — Mnemosyne builds the body itself and conformance-pins it against terra's golden
 * (`vectors/anchor-ton/terra-body-golden.json`), the same way CE v1.3 is vendored.
 *
 * Transport (pinned, terra-identical):
 *   anchor body cell = op:uint32 (ANCHOR_OP "PTA1" = 0x50544131) || root:256bit raw (32 bytes)
 *
 * `@ton/core` (the same reference TON lib terra uses) provides Cell/BoC — this is the ONE runtime
 * dependency in Mnemosyne, ISOLATED to the optional `anchor-ton/` module; the pure spine (L0–D10)
 * stays dependency-free and never imports it.
 *
 * ARCHITECT-OWNED CONTRACT. `ANCHOR_OP` and the function SIGNATURES below are FROZEN; DeepSeek
 * implements the bodies (docs/TASK-deepseek-D11.md).
 */
import { beginCell, type Cell } from "@ton/core";

/** Op tag = ASCII "PTA1" (0x50 0x54 0x41 0x31) — terra's Paradigm Terra Anchor v1 transport, reused. */
export const ANCHOR_OP = 0x50544131;

/** Thrown on a malformed root. */
export class AnchorBodyError extends Error {
  constructor(
    readonly code: string,
    msg: string,
  ) {
    super(msg);
    this.name = "AnchorBodyError";
  }
}

/**
 * Build the pinned anchor body cell carrying a 32-byte `vault_memory_root`. `rootHex` is the
 * Mnemosyne root format — lowercase 64-hex, NO `0x` prefix (as `AnchorReceipt.root`). Throws
 * `[ANCHOR_BAD_ROOT]` on anything else.
 */
export function anchorBodyCell(_rootHex: string): Cell {
  void beginCell; // body (TASK-deepseek-D11) uses beginCell().storeUint(ANCHOR_OP,32).storeBuffer(root)
  throw new Error("[TODO_D11] anchorBodyCell not implemented");
}

/** The pinned anchor body as a base64 BoC — the exact bytes to embed in the broadcast message body. */
export function anchorBodyBoc(_rootHex: string): string {
  throw new Error("[TODO_D11] anchorBodyBoc not implemented");
}

/** Parse an anchor body cell back to its lowercase 64-hex root, asserting the op tag (`[ANCHOR_BAD_OP]`). */
export function parseAnchorRoot(_cell: Cell): string {
  throw new Error("[TODO_D11] parseAnchorRoot not implemented");
}
