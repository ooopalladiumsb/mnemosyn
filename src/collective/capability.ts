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
import type { VaultDid, AgentDid, CapabilityId } from "../spine/types.js";

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

/** capability_id = domainHash(CAPABILITY_V1, canonicalBytes(Capability)). Pure. */
export function capabilityId(_cap: Capability): Uint8Array {
  throw new Error("[TODO_L4] capabilityId not implemented");
}

/**
 * Issue (sign) a grant with the raw 32-byte Vault authority seed. `proof` is the lowercase-hex
 * Ed25519 signature over `canonicalBytes(capability)`; `capability_id` is hex of `capabilityId`.
 */
export function issueGrant(_cap: Capability, _authoritySeed: Uint8Array): CapabilityGrant {
  throw new Error("[TODO_L4] issueGrant not implemented");
}

/**
 * Verify a grant: (1) `vaultDidFromPubkey(authorityPubkey) === capability.vault_did` (the grant was
 * issued by THIS vault's authority), (2) `capability_id` matches the recomputed id, and (3) the
 * Ed25519 `proof` is valid over `canonicalBytes(capability)`. Pure, offline. Returns a boolean;
 * never throws on a bad signature (only on a malformed pubkey length).
 */
export function verifyGrant(_grant: CapabilityGrant, _authorityPublicKey: Uint8Array): boolean {
  throw new Error("[TODO_L4] verifyGrant not implemented");
}

/**
 * Scope check ONLY (call `verifyGrant` first for authenticity): does `grant` authorize `req`?
 * Requires `capability.vault_did === req.vaultDid`, `capability.grantee === req.writerDid`,
 * `req.action ∈ scope.actions`, and `req.space` allowed (`scope.spaces === "*"` or contains it).
 */
export function grantAuthorizes(_grant: CapabilityGrant, _req: AccessRequest): boolean {
  throw new Error("[TODO_L4] grantAuthorizes not implemented");
}
