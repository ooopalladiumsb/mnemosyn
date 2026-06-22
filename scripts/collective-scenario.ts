/**
 * Deterministic collective (L4) scenario shared by the vector generator and the golden test.
 *
 * Fixed authority seed + fixed set of Capabilities → pinned capability_id and proof.
 * Proves both the id hashing AND the Ed25519 signature are byte-reproducible.
 */
import { issueGrant, capabilityId, verifyGrant } from "../src/collective/capability.js";
import { ed25519PublicKeyFromSeed } from "../src/adapters/checkpoint.js";
import { vaultDidFromPubkey } from "../src/identity/did.js";
import { toHex } from "../src/canonical/hash.js";
import type { Capability } from "../src/collective/capability.js";

/** Fixed deterministic 32-byte authority seed: all bytes = index. */
function fixedSeed(): Uint8Array {
  return new Uint8Array(Array.from({ length: 32 }, (_, i) => i));
}

/** Fixed capabilities with different grantees and scopes. */
function fixedCaps(vaultDid: string): Capability[] {
  return [
    { schema_version: 1, vault_did: vaultDid, grantee: "agent:claude:alice", scope: { spaces: ["dialog", "code"], actions: ["append"] } },
    { schema_version: 1, vault_did: vaultDid, grantee: "agent:claude:bob", scope: { spaces: ["code"], actions: ["append"] } },
    { schema_version: 1, vault_did: vaultDid, grantee: "agent:gpt:carol", scope: { spaces: "*", actions: ["append"] } },
  ];
}

export interface CollectiveCapEntry {
  readonly grantee: string;
  readonly spaces: string | string[];
  readonly capability_id: string;
  readonly proof: string;
}

export interface CollectiveScenarioResult {
  readonly authority_seed_hex: string;
  readonly authority_pubkey_hex: string;
  readonly vault_did: string;
  readonly capabilities: CollectiveCapEntry[];
}

export async function runCollectiveScenario(): Promise<CollectiveScenarioResult> {
  const seed = fixedSeed();
  const pubkey = ed25519PublicKeyFromSeed(seed);
  const vaultDid = vaultDidFromPubkey(pubkey);

  const entries: CollectiveCapEntry[] = [];
  for (const cap of fixedCaps(vaultDid)) {
    const grant = issueGrant(cap, seed);
    entries.push({
      grantee: cap.grantee,
      spaces: Array.isArray(cap.scope.spaces) ? cap.scope.spaces : cap.scope.spaces,
      capability_id: grant.capability_id,
      proof: grant.proof,
    });
  }

  return {
    authority_seed_hex: toHex(seed),
    authority_pubkey_hex: toHex(pubkey),
    vault_did: vaultDid,
    capabilities: entries,
  };
}
