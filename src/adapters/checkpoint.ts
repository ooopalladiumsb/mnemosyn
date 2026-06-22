/**
 * L1 Anchor — durable, hash-linked, third-party-verifiable checkpoint chain (D5).
 *
 * The L0 spine produces a `vault_memory_root` and `LocalSigned` signs a single latest
 * receipt in memory. L1 turns that into a TAMPER-EVIDENT HISTORY: each checkpoint commits to
 * its predecessor via `domainHash(ANCHOR_CHECKPOINT_V1, …)`, the latest root+version is signed,
 * and anyone holding the authority pubkey can verify both the signature and the chain offline.
 *
 * ARCHITECT-OWNED CONTRACT. The interfaces, the `AnchorCheckpoint` shape/field order, and the
 * function signatures below are FROZEN. DeepSeek implements the bodies (see docs/TASK-deepseek-L1.md);
 * it must not change names, field order, or signatures. Determinism rules of the spine apply:
 * `anchorCheckpointId` is a pure function of its input, golden-vector pinned.
 */
import type { VaultDid } from "../spine/types.js";
import type { AnchorReceipt, AnchorAdapter } from "./anchor.js";

/**
 * One immutable link in a vault's anchor checkpoint chain. Canonicalized via restricted-JCS
 * (integers only); `version` is a uint64 (`bigint`), gapless from 0. `created_at`-style wall-clock
 * MUST NOT appear here (AI-7).
 */
export interface AnchorCheckpoint {
  readonly vault_did: VaultDid;
  readonly version: bigint; // uint64, gapless from 0
  readonly root: string; // hex(vault_memory_root) — 32-byte root, lowercase hex
  readonly prev: string; // checkpoint_id of version-1 (hex), or ZERO_HASH_HEX at version 0
}

/** checkpoint_id = domainHash(ANCHOR_CHECKPOINT_V1, canonicalBytes(AnchorCheckpoint)). Pure. */
export function anchorCheckpointId(_checkpoint: AnchorCheckpoint): Uint8Array {
  throw new Error("[TODO_L1] anchorCheckpointId not implemented");
}

/**
 * Durable anchor adapter: an `AnchorAdapter` that also persists and exposes the full ordered
 * checkpoint chain, surviving process restart. `LocalSigned` implements this in L1.
 */
export interface DurableAnchorAdapter extends AnchorAdapter {
  /** Full checkpoint chain for a vault, oldest→newest. Empty if never anchored. */
  chain(vaultDid: VaultDid): Promise<readonly AnchorCheckpoint[]>;
  /** Head checkpoint id (hex) + version, or null if the vault has no checkpoints. */
  checkpointHead(vaultDid: VaultDid): Promise<{ checkpointId: string; version: bigint } | null>;
}

/**
 * Verify a `LocalSigned` receipt against the authority's raw 32-byte Ed25519 public key.
 * Pure, offline, third-party. Returns true iff `proof` is a valid Ed25519 signature over the
 * canonical bytes of {root, vaultDid, version} (the L0 LocalSigned signing surface, unchanged).
 */
export function verifyReceipt(_receipt: AnchorReceipt, _authorityPublicKey: Uint8Array): boolean {
  throw new Error("[TODO_L1] verifyReceipt not implemented");
}

/** Result of validating a checkpoint chain. `brokenAt` = first bad version when `ok` is false. */
export interface ChainVerification {
  readonly ok: boolean;
  readonly brokenAt?: bigint;
  readonly reason?: string;
}

/**
 * Verify a checkpoint chain (oldest→newest) is well-formed: version gapless from 0, each `prev`
 * equals the predecessor's `anchorCheckpointId` (hex), version 0's `prev` is `ZERO_HASH_HEX`.
 * Pure; does NOT check signatures (use `verifyReceipt` for the signed head).
 */
export function verifyCheckpointChain(_chain: readonly AnchorCheckpoint[]): ChainVerification {
  throw new Error("[TODO_L1] verifyCheckpointChain not implemented");
}

/** Derive the raw 32-byte Ed25519 public key from a raw 32-byte seed (for verification/testing). */
export function ed25519PublicKeyFromSeed(_seed: Uint8Array): Uint8Array {
  throw new Error("[TODO_L1] ed25519PublicKeyFromSeed not implemented");
}
