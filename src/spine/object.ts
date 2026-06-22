/**
 * MemoryObject construction + id. CONTRACT frozen; bodies by DeepSeek (TASK §T5a).
 * object_id = domainHash(MEMORY_OBJECT_V1, canonicalBytes(obj)).
 *
 * created_at rule (AI-7, see docs/NOTES-deepseek.md — OBJECTION raised there): `created_at` is
 * OPAQUE metadata and participates in NO commitment. It is excluded from `memoryObjectCanonicalBytes`
 * AND from `metaCommit`, so `object_id`, `meta_commit` and the vault root are independent of any
 * timestamp. This is the only reading consistent with Invariant AI-7 ("no timestamp participates in
 * ordering, hashing semantics, or replay") and the §T8.4 acceptance test; it overrides the weaker
 * §T5a "omit iff undefined" hint and the §3 listing of created_at inside public_meta.
 */
import { canonicalBytes, type Json } from "../canonical/jcs.js";
import { domainHash, toHex } from "../canonical/hash.js";
import { MNEMOSYNE_TAGS } from "../canonical/domains.js";
import type { MemoryObject, PublicMeta } from "./types.js";

/** Canonical bytes of a MemoryObject under restricted JCS (field set per types.ts). */
export function memoryObjectCanonicalBytes(obj: MemoryObject): Uint8Array {
  const j: Record<string, Json> = {
    schema_version: obj.schema_version,
    vault_did: obj.vault_did,
    space: obj.space,
    seqno: obj.seqno,
    kind: obj.kind,
    content_commit: obj.content_commit,
    content_ref: obj.content_ref,
    enc: {
      alg: obj.enc.alg,
      key_id: obj.enc.key_id,
      nonce_b64: obj.enc.nonce_b64,
      wrap_b64: obj.enc.wrap_b64,
    },
    meta_commit: obj.meta_commit,
    writer_did: obj.writer_did,
    capability_id: obj.capability_id,
    prev: obj.prev,
  };
  // created_at is OPAQUE and deliberately NOT serialized here (AI-7).
  return canonicalBytes(j);
}

/** object_id (hex) = hex(domainHash(MEMORY_OBJECT_V1, canonicalBytes(obj))). */
export function memoryObjectId(obj: MemoryObject): string {
  return toHex(domainHash(MNEMOSYNE_TAGS.MEMORY_OBJECT_V1, memoryObjectCanonicalBytes(obj)));
}

/** meta_commit (hex) = hex(domainHash(MEMORY_META_V1, canonicalBytes(publicMeta))). */
export function metaCommit(meta: PublicMeta): string {
  const j: Record<string, Json> = {
    schema_version: meta.schema_version,
    kind: meta.kind,
  };
  // created_at is OPAQUE and deliberately NOT committed (AI-7); only kind/tags/schema_version are.
  if (meta.tags !== undefined) j["tags"] = meta.tags as readonly string[] as Json;
  return toHex(domainHash(MNEMOSYNE_TAGS.MEMORY_META_V1, canonicalBytes(j)));
}
