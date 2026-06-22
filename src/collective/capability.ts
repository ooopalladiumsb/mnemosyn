/**
 * L4 Collective — capability model + delegation verification (D8). AUTHORIZATION LAYER.
 *
 * Unlike L2/L3 (derived, out-of-root), L4 is IN the commitment path: it gives meaning to the
 * `writer_did` + `capability_id` fields the spine has committed since L0 (reserved by D4). A
 * `Capability` is a signed delegation from a Vault authority to an Agent DID; an append is
 * authorized iff its writer holds a valid grant whose `capability_id` equals the object's
 * `capability_id`. v1 is SINGLE-LEVEL (vault → agent directly); `parent` is reserved for future
 * delegation chains (kept undefined in v1). No wall-clock participates (AI-7): scope is logical.
 *
 * ARCHITECT-OWNED CONTRACT. The shapes, the `CAPABILITY_V1` derivation, and the function
 * signatures below are FROZEN; DeepSeek implements the bodies (docs/TASK-deepseek-L4.md). New
 * exports may be added; declared names/shapes/signatures may not change.
 */
import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from "node:crypto";
import { Buffer } from "node:buffer";
import type { VaultDid, AgentDid, CapabilityId } from "../spine/types.js";
import { canonicalBytes, type Json } from "../canonical/jcs.js";
import { domainHash, toHex, fromHex } from "../canonical/hash.js";
import { DOMAIN_TAGS } from "../canonical/domains.js";
import { vaultDidFromPubkey } from "../identity/did.js";

/** The single action L4 v1 guards. Reads are unguarded/local in v1 (extend the union later). */
export type CapabilityAction = "append";

/** What a capability authorizes: a set of spaces (or "*" = all) and a set of actions. */
export interface CapabilityScope {
  readonly spaces: readonly string[] | "*";
  readonly actions: readonly CapabilityAction[];
}

/**
 * A delegation grant's payload (the signed part). `capability_id =
 * domainHash(CAPABILITY_V1, canonicalBytes(Capability))`. Field order is frozen for clarity;
 * restricted-JCS byte-sorts keys before hashing.
 */
export interface Capability {
  readonly schema_version: number; // uint16, = 1
  readonly vault_did: VaultDid; // the granting authority's vault
  readonly grantee: AgentDid; // who receives the write right (== object.writer_did)
  readonly scope: CapabilityScope;
  readonly parent?: CapabilityId; // reserved for delegation chains; omitted in v1 (single-level)
}

/** A capability plus the Vault authority's Ed25519 proof over its canonical bytes. */
export interface CapabilityGrant {
  readonly capability: Capability;
  readonly capability_id: string; // hex of capabilityId(capability)
  readonly proof: string; // hex Ed25519 signature by the vault authority over canonicalBytes(capability)
}

/** A concrete write the verifier is asked to authorize against a grant. */
export interface AccessRequest {
  readonly vaultDid: VaultDid;
  readonly space: string;
  readonly action: CapabilityAction;
  readonly writerDid: AgentDid;
}

// RFC 8410 PKCS#8 prefix for an Ed25519 private key carrying a raw 32-byte seed.
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function ed25519KeyFromSeed(seed: Uint8Array) {
  if (seed.length !== 32) {
    throw new Error(`[CAPABILITY_BAD_KEY_LEN] Ed25519 seed must be 32 bytes, got ${seed.length}`);
  }
  const der = Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seed)]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

/** Build the JCS-compatible object for canonicalization. Omits `parent` when undefined. */
function capabilityJcs(cap: Capability): Record<string, Json> {
  const scopeJcs: Record<string, Json> = {
    spaces: cap.scope.spaces === "*" ? "*" : cap.scope.spaces as readonly string[] as Json,
    actions: cap.scope.actions as readonly string[] as Json,
  };
  const j: Record<string, Json> = {
    schema_version: cap.schema_version,
    vault_did: cap.vault_did,
    grantee: cap.grantee,
    scope: scopeJcs,
  };
  // parent is RESERVED; omit it when undefined so v1 ids never change if a future version adds it.
  if (cap.parent !== undefined) {
    j["parent"] = cap.parent;
  }
  return j;
}

/** capability_id = domainHash(CAPABILITY_V1, canonicalBytes(Capability)). Pure. */
export function capabilityId(cap: Capability): Uint8Array {
  return domainHash(DOMAIN_TAGS.CAPABILITY_V1, canonicalBytes(capabilityJcs(cap)));
}

/**
 * Issue (sign) a grant with the raw 32-byte Vault authority seed. `proof` is the lowercase-hex
 * Ed25519 signature over `canonicalBytes(capability)`; `capability_id` is hex of `capabilityId`.
 */
export function issueGrant(cap: Capability, authoritySeed: Uint8Array): CapabilityGrant {
  const id = capabilityId(cap);
  const message = canonicalBytes(capabilityJcs(cap));
  const key = ed25519KeyFromSeed(authoritySeed);
  const signature = edSign(null, Buffer.from(message), key);
  return {
    capability: cap,
    capability_id: toHex(id),
    proof: toHex(new Uint8Array(signature)),
  };
}

/**
 * Verify a grant: (1) `vaultDidFromPubkey(authorityPubkey) === capability.vault_did` (the grant was
 * issued by THIS vault's authority), (2) `capability_id` matches the recomputed id, and (3) the
 * Ed25519 `proof` is valid over `canonicalBytes(capability)`. Pure, offline. Returns a boolean;
 * never throws on a bad signature (only on a malformed pubkey length).
 */
export function verifyGrant(grant: CapabilityGrant, authorityPublicKey: Uint8Array): boolean {
  if (authorityPublicKey.length !== 32) {
    throw new Error(
      `[CAPABILITY_BAD_PUBKEY_LEN] Ed25519 public key must be 32 bytes, got ${authorityPublicKey.length}`,
    );
  }
  // (1) Vault DID binding: the public key MUST resolve to the capability's vault_did.
  if (vaultDidFromPubkey(authorityPublicKey) !== grant.capability.vault_did) {
    return false;
  }
  // (2) Capability id integrity: recompute and compare.
  const expectedId = toHex(capabilityId(grant.capability));
  if (grant.capability_id !== expectedId) {
    return false;
  }
  // (3) Ed25519 signature verification.
  const message = canonicalBytes(capabilityJcs(grant.capability));
  let sig: Uint8Array;
  try {
    sig = fromHex(grant.proof);
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;

  try {
    // Build SPKI DER from raw 32-byte pubkey: prefix || raw_key
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const spki = Buffer.concat([spkiPrefix, Buffer.from(authorityPublicKey)]);
    const pubkey = createPublicKey({ key: spki, format: "der", type: "spki" });
    return edVerify(null, Buffer.from(message), pubkey, Buffer.from(sig));
  } catch {
    return false;
  }
}

/**
 * Scope check ONLY (call `verifyGrant` first for authenticity): does `grant` authorize `req`?
 * Requires `capability.vault_did === req.vaultDid`, `capability.grantee === req.writerDid`,
 * `req.action ∈ scope.actions`, and `req.space` allowed (`scope.spaces === "*"` or contains it).
 */
export function grantAuthorizes(grant: CapabilityGrant, req: AccessRequest): boolean {
  const cap = grant.capability;
  // vault match
  if (cap.vault_did !== req.vaultDid) return false;
  // grantee === writer
  if (cap.grantee !== req.writerDid) return false;
  // action in scope
  if (!(cap.scope.actions as readonly string[]).includes(req.action)) return false;
  // space in scope ("*" = all, or explicit containment)
  if (cap.scope.spaces === "*") return true;
  return (cap.scope.spaces as readonly string[]).includes(req.space);
}
