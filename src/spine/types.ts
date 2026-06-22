/**
 * Spine data contracts — ARCHITECT-OWNED, FROZEN (migration-hard surface per the L0 Decision
 * Record). DeepSeek implements behaviour against these types but MUST NOT change their shape,
 * field names, field order, or semantics. Any change here requires a new Decision Record.
 */

/** 32-byte hash digest. */
export type Hash256 = Uint8Array;

/** Vault DID: `memory://vault/<base32(vault_authority_pubkey)>`. Sovereign, persistent owner. */
export type VaultDid = string;

/** Agent DID: transient writer/reader identity (e.g. `agent:claude:...`). */
export type AgentDid = string;

/** Capability id authorizing a write. v0: a single constant ROOT capability (D4). */
export type CapabilityId = string;

/** Kinds of immutable knowledge object the spine commits. */
export type MemoryKind =
  | "dialog"
  | "code"
  | "document"
  | "fact"
  | "artifact"
  | "state"
  | "event"
  | "decision"
  | "skill"
  | "tool_call";

/** Encryption metadata. Plaintext is NEVER stored; content_commit is over ciphertext only. */
export interface EncMeta {
  readonly alg: "AES-256-GCM";
  /** Identifier of the vault DEK/KEK used (resolved by the vault key manager). */
  readonly key_id: string;
  /** Base64 GCM nonce. */
  readonly nonce_b64: string;
  /** Base64 wrapped DEK (DEK wrapped by the vault KEK), if per-object DEKs are used. */
  readonly wrap_b64: string;
}

/**
 * The atomic, immutable memory object. Canonicalized via restricted JCS (integers only) before
 * hashing. `object_id = domainHash(MEMORY_OBJECT_V1, canonicalBytes(MemoryObject))`.
 *
 * INVARIANT AI-7: ordering is defined ONLY by `seqno`. `created_at` is opaque metadata and takes
 * NO part in ordering, hashing semantics, or replay.
 */
export interface MemoryObject {
  readonly schema_version: number; // uint16, = 1
  readonly vault_did: VaultDid;
  readonly space: string;
  readonly seqno: number | bigint; // uint64, 0-based, gapless within (vault_did, space)
  readonly kind: MemoryKind;
  readonly content_commit: string; // hex of domainHash(MEMORY_CONTENT_V1, ciphertext)
  readonly content_ref: string; // = "mem:" + hex(content_commit) — content-address, NOT a location
  readonly enc: EncMeta;
  readonly meta_commit: string; // hex of domainHash(MEMORY_META_V1, canonicalBytes(public_meta))
  readonly writer_did: AgentDid;
  readonly capability_id: CapabilityId;
  readonly created_at?: number | bigint; // OPTIONAL opaque metadata (AI-7)
  readonly prev: string; // hex object_id of seqno-1, or 64 hex zeros for seqno 0
}

/** Non-secret, queryable metadata committed via meta_commit. Sensitive data goes in the blob. */
export interface PublicMeta {
  readonly schema_version: number;
  readonly kind: MemoryKind;
  readonly created_at?: number | bigint;
  readonly tags?: readonly string[];
}

/** Result of a successful append. */
export interface AppendReceipt {
  readonly object_id: string; // hex
  readonly seqno: number | bigint;
  readonly space_state: string; // hex stateHash(space)
  readonly vault_memory_root: string; // hex stateRoot over all spaces
}

/** Out-of-band replica hints. NEVER part of any commitment (D2). */
export interface ReplicaHint {
  readonly adapter: string; // e.g. "local" | "ipfs" | "s3" | "ton-storage"
  readonly uri: string;
}

export interface ContentLocator {
  readonly contentCommit: Hash256;
  readonly replicas: readonly ReplicaHint[];
}

/** All-zero 32-byte digest as hex (the `prev` of seqno 0). */
export const ZERO_HASH_HEX = "00".repeat(32);
