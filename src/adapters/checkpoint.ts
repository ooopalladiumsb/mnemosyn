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
import { createPublicKey, createPrivateKey, verify as edVerify } from "node:crypto";
import { Buffer } from "node:buffer";
import type { VaultDid } from "../spine/types.js";
import { ZERO_HASH_HEX } from "../spine/types.js";
import { canonicalBytes, type Json } from "../canonical/jcs.js";
import { domainHash, toHex, fromHex } from "../canonical/hash.js";
import { MNEMOSYNE_TAGS } from "../canonical/domains.js";
import type { AnchorReceipt, AnchorAdapter } from "./anchor.js";

/** RFC 8410 PKCS#8 prefix for an Ed25519 private key carrying a raw 32-byte seed. */
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

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
export function anchorCheckpointId(checkpoint: AnchorCheckpoint): Uint8Array {
  const j: Json = {
    vault_did: checkpoint.vault_did,
    version: checkpoint.version,
    root: checkpoint.root,
    prev: checkpoint.prev,
  };
  return domainHash(MNEMOSYNE_TAGS.ANCHOR_CHECKPOINT_V1, canonicalBytes(j));
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
export function verifyReceipt(receipt: AnchorReceipt, authorityPublicKey: Uint8Array): boolean {
  if (authorityPublicKey.length !== 32) {
    throw new Error(
      `[ANCHOR_BAD_PUBKEY_LEN] Ed25519 public key must be 32 bytes, got ${authorityPublicKey.length}`,
    );
  }
  let sig: Uint8Array;
  try {
    sig = fromHex(receipt.proof);
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;

  const message = canonicalBytes({ root: receipt.root, vaultDid: receipt.vaultDid, version: receipt.version });
  try {
    const pubkey = createPublicKey({
      key: ed25519SpkiFromRaw(authorityPublicKey),
      format: "der",
      type: "spki",
    });
    return edVerify(null, Buffer.from(message), pubkey, Buffer.from(sig));
  } catch {
    return false;
  }
}

/**
 * Build an Ed25519 SPKI DER from a raw 32-byte public key.
 * SPKI format: 302a300506032b6570032100 || raw_32_bytes
 */
function ed25519SpkiFromRaw(rawPubkey: Uint8Array): Buffer {
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  return Buffer.concat([prefix, Buffer.from(rawPubkey)]);
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
export function verifyCheckpointChain(chain: readonly AnchorCheckpoint[]): ChainVerification {
  // Empty chain is vacuously valid.
  if (chain.length === 0) return { ok: true };

  for (let i = 0; i < chain.length; i++) {
    const cp = chain[i]!;
    const expectedVersion = BigInt(i);

    // Version must be gapless from 0.
    if (cp.version !== expectedVersion) {
      return {
        ok: false,
        brokenAt: cp.version,
        reason: `expected version ${expectedVersion}, got ${cp.version}`,
      };
    }

    // Version 0 must have prev == ZERO_HASH_HEX.
    if (cp.version === 0n && cp.prev !== ZERO_HASH_HEX) {
      return {
        ok: false,
        brokenAt: 0n,
        reason: `version 0 prev must be ${ZERO_HASH_HEX}, got ${cp.prev}`,
      };
    }

    // Later versions must have prev == checkpoint_id of predecessor.
    if (cp.version > 0n) {
      const prevCp = chain[i - 1]!;
      const expectedPrev = toHex(anchorCheckpointId(prevCp));
      if (cp.prev !== expectedPrev) {
        return {
          ok: false,
          brokenAt: cp.version,
          reason: `version ${cp.version} prev must be ${expectedPrev} (checkpoint_id of v${prevCp.version}), got ${cp.prev}`,
        };
      }
    }
  }

  return { ok: true };
}

/** Derive the raw 32-byte Ed25519 public key from a raw 32-byte seed (for verification/testing). */
export function ed25519PublicKeyFromSeed(seed: Uint8Array): Uint8Array {
  if (seed.length !== 32) {
    throw new Error(`[ANCHOR_BAD_KEY_LEN] Ed25519 seed must be 32 bytes, got ${seed.length}`);
  }
  // Wrap raw seed into PKCS#8 DER.
  const der = Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seed)]);
  const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  // Export public key in SPKI DER; the raw 32-byte key is the last 32 bytes.
  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" }) as Buffer;
  // Ed25519 SPKI DER: 302a300506032b6570032100 || 32 raw bytes
  return new Uint8Array(spki.subarray(spki.length - 32));
}
