/**
 * Deterministic L1 anchor scenario shared by the vector generator and the golden test.
 *
 * Fixed seed + fixed sequence of roots → deterministic chain of AnchorCheckpoints,
 * signed by LocalSigned. Produces byte-reproducible checkpoint_ids and proofs.
 * This proves both the chain hashing AND the Ed25519 signature are deterministic.
 */
import { LocalSigned } from "../src/adapters/anchor.js";
import {
  anchorCheckpointId,
  ed25519PublicKeyFromSeed,
  verifyCheckpointChain,
} from "../src/adapters/checkpoint.js";
import { toHex } from "../src/canonical/hash.js";
import { vaultDidFromPubkey } from "../src/identity/did.js";

/** Fixed deterministic 32-byte authority seed (all bytes = index). */
function fixedSeed(): Uint8Array {
  return new Uint8Array(Array.from({ length: 32 }, (_, i) => i));
}

/** Fixed deterministic root bytes for version `v`. */
function fixedRoot(v: number): Uint8Array {
  const r = new Uint8Array(32);
  // Fill with pattern that varies by version
  r[0] = 0xaa;
  r[1] = v;
  r[31] = 0xbb;
  return r;
}

export interface AnchorScenarioCheckpoint {
  readonly version: string; // decimal string
  readonly root: string;    // hex
  readonly prev: string;    // hex
  readonly checkpoint_id: string;
  readonly proof: string;
}

export interface AnchorScenarioResult {
  readonly authority_seed_hex: string;
  readonly authority_pubkey_hex: string;
  readonly vault_did: string;
  readonly chain: AnchorScenarioCheckpoint[];
  readonly head: {
    readonly checkpointId: string;
    readonly version: string;
  };
  readonly chain_verification: { ok: boolean };
}

/**
 * Build a 3-link checkpoint chain (versions 0, 1, 2) with fixed inputs.
 * Uses an in-memory LocalSigned (no dir) for clean deterministic output.
 */
export async function runAnchorScenario(): Promise<AnchorScenarioResult> {
  const seed = fixedSeed();
  const pubkey = ed25519PublicKeyFromSeed(seed);
  const vaultDid = vaultDidFromPubkey(pubkey);
  const adapter = new LocalSigned(seed);

  const chain: AnchorScenarioCheckpoint[] = [];

  for (let v = 0; v < 3; v++) {
    const root = fixedRoot(v);
    const receipt = await adapter.anchor(vaultDid, root, BigInt(v));
    const rawChain = await adapter.chain(vaultDid);
    const cp = rawChain[rawChain.length - 1]!;

    chain.push({
      version: cp.version.toString(10),
      root: cp.root,
      prev: cp.prev,
      checkpoint_id: toHex(anchorCheckpointId(cp)),
      proof: receipt.proof,
    });
  }

  const head = await adapter.checkpointHead(vaultDid);
  if (!head) throw new Error("head must not be null after 3 anchors");

  return {
    authority_seed_hex: toHex(seed),
    authority_pubkey_hex: toHex(pubkey),
    vault_did: vaultDid,
    chain,
    head: {
      checkpointId: head.checkpointId,
      version: head.version.toString(10),
    },
    chain_verification: verifyCheckpointChain(await adapter.chain(vaultDid)) as { ok: boolean },
  };
}
