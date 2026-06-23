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
    super(`[${code}] ${msg}`);
    this.name = "AnchorBodyError";
  }
}

/** Validate rootHex is exactly 64 lowercase hex chars, no 0x prefix. */
function validateRootHex(rootHex: string): void {
  if (!/^[0-9a-f]{64}$/.test(rootHex)) {
    throw new AnchorBodyError(
      "ANCHOR_BAD_ROOT",
      `root hex must be 64 lowercase hex chars (no 0x prefix), got ${JSON.stringify(rootHex)}`,
    );
  }
}

/**
 * Build the pinned anchor body cell carrying a 32-byte `vault_memory_root`. `rootHex` is the
 * Mnemosyne root format — lowercase 64-hex, NO `0x` prefix (as `AnchorReceipt.root`). Throws
 * `[ANCHOR_BAD_ROOT]` on anything else.
 */
export function anchorBodyCell(rootHex: string): Cell {
  validateRootHex(rootHex);
  return beginCell()
    .storeUint(ANCHOR_OP, 32)
    .storeBuffer(Buffer.from(rootHex, "hex"))
    .endCell();
}

/** The pinned anchor body as a base64 BoC — the exact bytes to embed in the broadcast message body. */
export function anchorBodyBoc(rootHex: string): string {
  return anchorBodyCell(rootHex).toBoc().toString("base64");
}

/** Parse an anchor body cell back to its lowercase 64-hex root, asserting the op tag (`[ANCHOR_BAD_OP]`). */
export function parseAnchorRoot(cell: Cell): string {
  const s = cell.beginParse();
  const op = s.loadUint(32);
  if (op !== ANCHOR_OP) {
    throw new AnchorBodyError(
      "ANCHOR_BAD_OP",
      `expected op 0x${ANCHOR_OP.toString(16)}, got 0x${op.toString(16)}`,
    );
  }
  const buf = s.loadBuffer(32);
  return buf.toString("hex");
}
