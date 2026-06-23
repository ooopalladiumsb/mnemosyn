/**
 * D11 — TonAnchorAdapter: a real `AnchorAdapter` that settles `vault_memory_root` on TON via terra's
 * anchor-body transport. Supersedes the L1 `TonAnchor` stub (`adapters/anchor.ts`) which throws
 * `[ANCHOR_NOT_AVAILABLE]`. `anchor()` builds the pinned body and hands it to the injected
 * `Broadcaster` (offline-mockable; live = operator-gated); the receipt's `proof` is the tx hash.
 *
 * ARCHITECT-OWNED CONTRACT. `TonAnchorAdapter` SIGNATURES are FROZEN; DeepSeek implements the body.
 */
import type { AnchorAdapter, AnchorReceipt } from "../adapters/anchor.js";
import type { VaultDid, Hash256 } from "../spine/types.js";
import type { Broadcaster } from "./broadcaster.js";

/**
 * Content-addressed root anchor over TON. Build → broadcast → receipt. `latest` is tracked in
 * memory (last anchored per vault) — durable/on-chain read-back is a later deliverable. The signing
 * authority lives inside the `Broadcaster` (the operator key), NOT here.
 */
export class TonAnchorAdapter implements AnchorAdapter {
  constructor(private readonly broadcaster: Broadcaster) {}

  /** Build the pinned anchor body for `root`, broadcast it, and return a receipt (`proof` = txHash). */
  async anchor(_vaultDid: VaultDid, _root: Hash256, _version: bigint): Promise<AnchorReceipt> {
    void this.broadcaster;
    throw new Error("[TODO_D11] TonAnchorAdapter.anchor not implemented");
  }

  async latest(_vaultDid: VaultDid): Promise<{ root: string; version: bigint } | null> {
    throw new Error("[TODO_D11] TonAnchorAdapter.latest not implemented");
  }
}
