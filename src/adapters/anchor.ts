/**
 * AnchorAdapter — where the per-vault memory root lives. Default `LocalSigned` (no chain) so a
 * standalone vault runs with zero external services; `TonAnchor` (paradigm_terra) is L1/optional.
 * CONTRACT frozen; LocalSigned by DeepSeek (TASK §T7).
 *
 * Design choice (docs/NOTES-deepseek.md): `LocalSigned` Ed25519-signs the canonical bytes of
 * {root, vaultDid, version} (restricted JCS). `proof` is the lowercase-hex signature. The
 * authority key is a raw 32-byte Ed25519 seed, wrapped into PKCS#8 DER for node:crypto. Latest
 * checkpoints are kept in an in-memory map — durable persistence is intentionally out of L0 scope.
 */
import { createPrivateKey, sign as edSign } from "node:crypto";
import { Buffer } from "node:buffer";
import { canonicalBytes } from "../canonical/jcs.js";
import { toHex } from "../canonical/hash.js";
import type { VaultDid, Hash256 } from "../spine/types.js";
import type { AnchorCheckpoint, DurableAnchorAdapter } from "./checkpoint.js";

export interface AnchorReceipt {
  readonly vaultDid: VaultDid;
  readonly root: string; // hex
  readonly version: bigint;
  /** Backend-specific proof: a signature (LocalSigned) or a tx hash (TonAnchor). */
  readonly proof: string;
}

export interface AnchorAdapter {
  anchor(vaultDid: VaultDid, root: Hash256, version: bigint): Promise<AnchorReceipt>;
  latest(vaultDid: VaultDid): Promise<{ root: string; version: bigint } | null>;
}

// RFC 8410 PKCS#8 prefix for an Ed25519 private key carrying a raw 32-byte seed.
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function ed25519KeyFromSeed(seed: Uint8Array) {
  if (seed.length !== 32) {
    throw new Error(`[ANCHOR_BAD_KEY_LEN] Ed25519 seed must be 32 bytes, got ${seed.length}`);
  }
  const der = Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seed)]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

/**
 * v0 default: Ed25519-signed checkpoint of (vaultDid, root, version). No blockchain.
 *
 * L1 (D5): also a `DurableAnchorAdapter`. When constructed with `options.dir`, the latest receipt
 * AND the hash-linked checkpoint chain are persisted under that directory so `latest()`/`chain()`
 * survive process restart; with no `dir` it stays purely in-memory (L0 behaviour, byte-identical).
 * The SIGNED message stays `{root, vaultDid, version}` — L1 does NOT change the L0 signing surface.
 * DeepSeek (TASK-deepseek-L1) implements the durable + chain bodies.
 */
export class LocalSigned implements DurableAnchorAdapter {
  private readonly latestByVault = new Map<string, { root: string; version: bigint }>();

  constructor(
    private readonly authoritySecretKey: Uint8Array,
    private readonly options?: { readonly dir?: string },
  ) {}

  async anchor(vaultDid: VaultDid, root: Hash256, version: bigint): Promise<AnchorReceipt> {
    const rootHex = toHex(root);
    const message = canonicalBytes({ root: rootHex, vaultDid, version });
    const key = ed25519KeyFromSeed(this.authoritySecretKey);
    const signature = edSign(null, Buffer.from(message), key);
    this.latestByVault.set(vaultDid, { root: rootHex, version });
    return { vaultDid, root: rootHex, version, proof: toHex(new Uint8Array(signature)) };
  }

  async latest(vaultDid: VaultDid): Promise<{ root: string; version: bigint } | null> {
    return this.latestByVault.get(vaultDid) ?? null;
  }

  async chain(_vaultDid: VaultDid): Promise<readonly AnchorCheckpoint[]> {
    void this.options; // durable bodies (TASK-deepseek-L1) read options.dir
    throw new Error("[TODO_L1] LocalSigned.chain not implemented");
  }

  async checkpointHead(
    _vaultDid: VaultDid,
  ): Promise<{ checkpointId: string; version: bigint } | null> {
    throw new Error("[TODO_L1] LocalSigned.checkpointHead not implemented");
  }
}
