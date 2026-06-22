/**
 * Domain-tag registry. ASCII literals prefixed before SHA-256 (same machinery as Canonical
 * Encoding v1.3 §7). Domain separation is what lets Mnemosyne share the hashing/Merkle machinery
 * with paradigm_terra WITHOUT collision: Mnemosyne owns the `MNEMOSYNE_*` namespace and never
 * uses `PARADIGM_TERRA_*` tags except the four CE v1.3 tags vendored verbatim for the Merkle /
 * state machinery (so streamTreeRoot/stateRoot are byte-identical to terra — anti-drift, D1).
 *
 * ARCHITECT-OWNED, FROZEN. Adding/changing a tag is a migration-hard change — do not edit without
 * a new Decision Record.
 */

/** CE v1.3 §7.1 tags, vendored VERBATIM. Used only by the Merkle/state primitives. Do not alter. */
export const CE_V13_TAGS = {
  MERKLE_LEAF_V1: "PARADIGM_TERRA_MERKLE_LEAF_V1",
  MERKLE_NODE_V1: "PARADIGM_TERRA_MERKLE_NODE_V1",
  STATE_V1: "PARADIGM_TERRA_STATE_V1",
  STATE_ROOT_V1: "PARADIGM_TERRA_STATE_ROOT_V1",
} as const;

/** Mnemosyne-specific tags (own namespace). */
export const MNEMOSYNE_TAGS = {
  /** Storage Commitment over CIPHERTEXT bytes (D2, ciphertext-only). */
  MEMORY_CONTENT_V1: "MNEMOSYNE_MEMORY_CONTENT_V1",
  /** Commitment over canonicalized public metadata. */
  MEMORY_META_V1: "MNEMOSYNE_MEMORY_META_V1",
  /** Object id over canonical bytes of a MemoryObject. */
  MEMORY_OBJECT_V1: "MNEMOSYNE_MEMORY_OBJECT_V1",
  /** Space head state hash. */
  MEMORY_SPACE_V1: "MNEMOSYNE_MEMORY_SPACE_V1",
  /** Per-vault memory root context (reserved; vault root is stateRoot over spaces). */
  VAULT_ROOT_V1: "MNEMOSYNE_VAULT_ROOT_V1",
  /** L1: one tamper-evident link in a vault's hash-linked anchor checkpoint chain (D5). */
  ANCHOR_CHECKPOINT_V1: "MNEMOSYNE_ANCHOR_CHECKPOINT_V1",
  /** L4: a Vault→Agent capability delegation; capability_id = domainHash(CAPABILITY_V1, …) (D8). */
  CAPABILITY_V1: "MNEMOSYNE_CAPABILITY_V1",
} as const;

export const DOMAIN_TAGS = { ...CE_V13_TAGS, ...MNEMOSYNE_TAGS } as const;

export type DomainTagName = keyof typeof DOMAIN_TAGS;
export type DomainTag = (typeof DOMAIN_TAGS)[DomainTagName];

export const ALL_DOMAIN_TAGS: readonly string[] = Object.values(DOMAIN_TAGS);

/** CE v1.3 §7 requires ASCII-only, non-empty, no NUL. */
export function isAsciiDomainTag(tag: string): boolean {
  if (tag.length === 0) return false;
  for (let i = 0; i < tag.length; i++) {
    const code = tag.charCodeAt(i);
    if (code === 0 || code > 0x7f) return false;
  }
  return true;
}

/** Compile-time invariant: every registered tag is valid ASCII. */
for (const tag of ALL_DOMAIN_TAGS) {
  if (!isAsciiDomainTag(tag)) {
    throw new Error(`Invalid domain tag in registry: ${JSON.stringify(tag)}`);
  }
}
