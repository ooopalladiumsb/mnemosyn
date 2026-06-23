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
import { toHex } from "../canonical/hash.js";
import { anchorBodyBoc } from "./anchor-body.js";

/**
 * Content-addressed root anchor over TON. Build → broadcast → receipt. `latest` is tracked in
 * memory (last anchored per vault) — durable/on-chain read-back is a later deliverable. The signing
 * authority lives inside the `Broadcaster` (the operator key), NOT here.
 */
export class TonAnchorAdapter implements AnchorAdapter {
  private readonly latestByVault = new Map<string, { root: string; version: bigint }>();

  constructor(private readonly broadcaster: Broadcaster) {}

  /** Build the pinned anchor body for `root`, broadcast it, and return a receipt (`proof` = txHash). */
  async anchor(vaultDid: VaultDid, root: Hash256, version: bigint): Promise<AnchorReceipt> {
    const rootHex = toHex(root);
    const bodyBoc = anchorBodyBoc(rootHex);
    const { txHash } = await this.broadcaster.broadcast({ bodyBoc, vaultDid, version });
    this.latestByVault.set(vaultDid, { root: rootHex, version });
    return { vaultDid, root: rootHex, version, proof: txHash };
  }

  async latest(vaultDid: VaultDid): Promise<{ root: string; version: bigint } | null> {
    return this.latestByVault.get(vaultDid) ?? null;
  }
}
