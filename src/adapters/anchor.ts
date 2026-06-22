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
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { canonicalBytes } from "../canonical/jcs.js";
import { toHex } from "../canonical/hash.js";
import type { VaultDid, Hash256 } from "../spine/types.js";
import { ZERO_HASH_HEX } from "../spine/types.js";
import { anchorCheckpointId, type AnchorCheckpoint, type DurableAnchorAdapter } from "./checkpoint.js";

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

/** Persisted shape serialized as non-hashed JSON-of-hex under `dir`. */
interface VaultFile {
  latest: { root: string; version: string }; // bigint serialized as decimal string for JSON safety
  chain: SerializedCheckpoint[];
}

interface SerializedCheckpoint {
  vault_did: string;
  version: string;
  root: string;
  prev: string;
}

function serializeChain(chain: readonly AnchorCheckpoint[]): SerializedCheckpoint[] {
  return chain.map((cp) => ({
    vault_did: cp.vault_did,
    version: cp.version.toString(10),
    root: cp.root,
    prev: cp.prev,
  }));
}

function deserializeChain(serialized: SerializedCheckpoint[]): AnchorCheckpoint[] {
  return serialized.map((s) => ({
    vault_did: s.vault_did,
    version: BigInt(s.version),
    root: s.root,
    prev: s.prev,
  }));
}

/** Sanitize a vault DID into a filesystem-safe key (replace ':' and '/' with '_'). */
function vaultDidToFilename(vaultDid: VaultDid): string {
  return vaultDid.replace(/[:/]/g, "_") + ".json";
}

/**
 * Synchronously recover all persisted vault files from `dir`.
 * Orders each chain by `version`, not by readdir order.
 */
function recoverFromDir(dir: string): {
  latestByVault: Map<string, { root: string; version: bigint }>;
  chainByVault: Map<string, AnchorCheckpoint[]>;
} {
  const latestByVault = new Map<string, { root: string; version: bigint }>();
  const chainByVault = new Map<string, AnchorCheckpoint[]>();

  if (!existsSync(dir)) return { latestByVault, chainByVault };

  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const filePath = join(dir, entry);
    let vf: VaultFile;
    try {
      vf = JSON.parse(readFileSync(filePath, "utf8")) as VaultFile;
    } catch {
      continue;
    }
    if (!vf.latest || !vf.chain || vf.chain.length === 0) continue;

    // Infer vault DID from chain[0].vault_did.
    const vaultDid = vf.chain[0]!.vault_did;
    if (!vaultDid) continue;

    const latest = {
      root: vf.latest.root,
      version: BigInt(vf.latest.version),
    };
    const chain = deserializeChain(vf.chain);
    // Order by version (not readdir order).
    chain.sort((a, b) => {
      if (a.version < b.version) return -1;
      if (a.version > b.version) return 1;
      return 0;
    });

    latestByVault.set(vaultDid, latest);
    chainByVault.set(vaultDid, chain);
  }

  return { latestByVault, chainByVault };
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
  private readonly chainByVault = new Map<string, AnchorCheckpoint[]>();

  constructor(
    private readonly authoritySecretKey: Uint8Array,
    private readonly options?: { readonly dir?: string },
  ) {
    if (options?.dir) {
      const recovered = recoverFromDir(options.dir);
      for (const [k, v] of recovered.latestByVault) this.latestByVault.set(k, v);
      for (const [k, v] of recovered.chainByVault) this.chainByVault.set(k, v);
    }
  }

  async anchor(vaultDid: VaultDid, root: Hash256, version: bigint): Promise<AnchorReceipt> {
    const rootHex = toHex(root);

    // --- L1 chain rules: monotonic, idempotent, gapless ---
    const existingChain = this.chainByVault.get(vaultDid) ?? [];
    const headVersion = existingChain.length > 0 ? BigInt(existingChain.length - 1) : null;

    // First anchor must be version 0.
    if (headVersion === null && version !== 0n) {
      throw new Error(
        `[ANCHOR_VERSION_GAP] first anchor for vault ${vaultDid} must be version 0, got ${version}`,
      );
    }

    if (headVersion !== null) {
      if (version < headVersion) {
        throw new Error(
          `[ANCHOR_VERSION_REGRESSION] version ${version} is before current head ${headVersion} for vault ${vaultDid}`,
        );
      }
      if (version > headVersion + 1n) {
        throw new Error(
          `[ANCHOR_VERSION_GAP] version ${version} skips from head ${headVersion} for vault ${vaultDid}`,
        );
      }
      // version === headVersion: idempotent or conflict.
      if (version === headVersion) {
        const headCp = existingChain[existingChain.length - 1]!;
        if (headCp.root === rootHex) {
          // Idempotent: re-sign (Ed25519 is deterministic, byte-identical) and return receipt.
          // Do NOT grow the chain.
          const message = canonicalBytes({ root: rootHex, vaultDid, version });
          const key = ed25519KeyFromSeed(this.authoritySecretKey);
          const signature = edSign(null, Buffer.from(message), key);
          return { vaultDid, root: rootHex, version, proof: toHex(new Uint8Array(signature)) };
        }
        throw new Error(
          `[ANCHOR_VERSION_CONFLICT] version ${version} already anchored with root ${headCp.root}, cannot re-anchor with root ${rootHex}`,
        );
      }
    }

    // --- Compute prev: checkpoint_id of predecessor, or ZERO_HASH_HEX at version 0 ---
    const prev =
      existingChain.length > 0
        ? toHex(anchorCheckpointId(existingChain[existingChain.length - 1]!))
        : ZERO_HASH_HEX;

    // --- Sign (L0 signing surface, unchanged) ---
    const message = canonicalBytes({ root: rootHex, vaultDid, version });
    const key = ed25519KeyFromSeed(this.authoritySecretKey);
    const signature = edSign(null, Buffer.from(message), key);

    // --- Build checkpoint ---
    const checkpoint: AnchorCheckpoint = {
      vault_did: vaultDid,
      version,
      root: rootHex,
      prev,
    };

    // --- Update in-memory state ---
    this.latestByVault.set(vaultDid, { root: rootHex, version });
    const newChain = [...existingChain, checkpoint];
    this.chainByVault.set(vaultDid, newChain);

    // --- Persist if dir is set ---
    if (this.options?.dir) {
      if (!existsSync(this.options.dir)) mkdirSync(this.options.dir, { recursive: true });
      const vf: VaultFile = {
        latest: { root: rootHex, version: version.toString(10) },
        chain: serializeChain(newChain),
      };
      writeFileSync(join(this.options.dir, vaultDidToFilename(vaultDid)), JSON.stringify(vf), "utf8");
    }

    return { vaultDid, root: rootHex, version, proof: toHex(new Uint8Array(signature)) };
  }

  async latest(vaultDid: VaultDid): Promise<{ root: string; version: bigint } | null> {
    return this.latestByVault.get(vaultDid) ?? null;
  }

  async chain(vaultDid: VaultDid): Promise<readonly AnchorCheckpoint[]> {
    return this.chainByVault.get(vaultDid) ?? [];
  }

  async checkpointHead(
    vaultDid: VaultDid,
  ): Promise<{ checkpointId: string; version: bigint } | null> {
    const chain = this.chainByVault.get(vaultDid);
    if (!chain || chain.length === 0) return null;
    const head = chain[chain.length - 1]!;
    return { checkpointId: toHex(anchorCheckpointId(head)), version: head.version };
  }
}

/**
 * Typed TON anchor seam (L1, optional). Methods throw `[ANCHOR_NOT_AVAILABLE]` until wired to
 * paradigm_terra in a network-gated deliverable. Exists so callers can target it by type today.
 */
export class TonAnchor implements AnchorAdapter {
  async anchor(_vaultDid: VaultDid, _root: Hash256, _version: bigint): Promise<AnchorReceipt> {
    throw new Error("[ANCHOR_NOT_AVAILABLE] TonAnchor is a typed seam — no live TON network in L1");
  }

  async latest(_vaultDid: VaultDid): Promise<{ root: string; version: bigint } | null> {
    throw new Error("[ANCHOR_NOT_AVAILABLE] TonAnchor is a typed seam — no live TON network in L1");
  }
}
