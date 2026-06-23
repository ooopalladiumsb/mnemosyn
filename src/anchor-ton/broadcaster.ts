/**
 * D11 — Broadcaster seam (the network boundary). Building the anchor body is deterministic and
 * offline; SENDING it (W5 wrapping + operator signature + submit to a TON node) needs a funded
 * wallet and a live network — that is OPERATOR-GATED and lives behind this seam. Real impls wrap a
 * TON client + the operator key; `MockBroadcaster` returns a deterministic fake tx for offline tests
 * (the D11 analogue of L0's fixed ciphertext / L2's HashEmbedder).
 *
 * ARCHITECT-OWNED CONTRACT. `BroadcastRequest`/`BroadcastResult`/`Broadcaster` + `MockBroadcaster`
 * SIGNATURES are FROZEN; DeepSeek implements the `MockBroadcaster` body (docs/TASK-deepseek-D11.md).
 */
import type { VaultDid } from "../spine/types.js";

/** What to broadcast: the pinned anchor body (base64 BoC) + the vault/version it anchors. */
export interface BroadcastRequest {
  readonly bodyBoc: string;
  readonly vaultDid: VaultDid;
  readonly version: bigint;
}

/** The result of a broadcast: the on-chain transaction hash (the anchor receipt's `proof`). */
export interface BroadcastResult {
  readonly txHash: string;
}

/** The network boundary. A LIVE impl needs a funded testnet wallet (operator); this seam keeps the */
/* adapter testable offline and the chain credentials out of the deterministic core. */
export interface Broadcaster {
  readonly name: string;
  broadcast(req: BroadcastRequest): Promise<BroadcastResult>;
}

/**
 * Deterministic offline broadcaster for tests: derives a fake `txHash` from `SHA-256(bodyBoc ||
 * version)` (hex). No network, no key. Lets `TonAnchorAdapter` be exercised without TON.
 */
export class MockBroadcaster implements Broadcaster {
  readonly name = "mock-broadcaster-v1";

  async broadcast(_req: BroadcastRequest): Promise<BroadcastResult> {
    throw new Error("[TODO_D11] MockBroadcaster.broadcast not implemented");
  }
}
