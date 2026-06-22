/**
 * Merkle + state-root primitives — vendored from CE v1.3/§6 + CAL Spec §7.3, byte-identical to
 * paradigm_terra (D1). These use the CE_V13_TAGS verbatim so roots match terra exactly.
 * CONTRACT frozen by architect; bodies implemented by DeepSeek (TASK §T2).
 */
import { CanonicalEncodingError } from "./errors.js";
import { DOMAIN_TAGS } from "./domains.js";
import { concatBytes, domainHash } from "./hash.js";
import { encodeUint16, encodeUint64 } from "./integers.js";
import { utf8NfcBytes } from "./strings.js";

/** Byte-wise comparator over the NFC UTF-8 encoding of two strings. */
function compareUtf8(a: string, b: string): number {
  const ab = utf8NfcBytes(a);
  const bb = utf8NfcBytes(b);
  const len = Math.min(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    const av = ab[i]!;
    const bv = bb[i]!;
    if (av !== bv) return av - bv;
  }
  return ab.length - bb.length;
}

/** Binary balanced Merkle root over leaf hashes, using `nodeTag` for internal nodes (CE §6). */
export function binaryMerkle(leafHashes: readonly Uint8Array[], nodeTag: string): Uint8Array {
  if (leafHashes.length === 0) {
    throw new CanonicalEncodingError("MERKLE_EMPTY", "binary Merkle over empty leaf set is undefined");
  }
  for (const h of leafHashes) {
    if (h.length !== 32) {
      throw new CanonicalEncodingError("MERKLE_BAD_LEAF_LEN", `leaf hash must be 32 bytes, got ${h.length}`);
    }
  }
  let level: Uint8Array[] = leafHashes.slice();
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = i + 1 < level.length ? level[i + 1]! : left; // duplicate last on odd
      next.push(domainHash(nodeTag, concatBytes(left, right)));
    }
    level = next;
  }
  return level[0]!;
}

// --- Stream tree (CE §6.3) ---

export interface StreamLeaf {
  readonly streamId: string;
  readonly stateHash: Uint8Array; // 32 bytes
  readonly lastEventHash: Uint8Array; // 32 bytes
  readonly lastSeqno: bigint | number;
}

/** Leaf hash for one stream (CE §6.3), domain MERKLE_LEAF_V1. */
export function streamLeafHash(leaf: StreamLeaf): Uint8Array {
  if (leaf.stateHash.length !== 32) {
    throw new CanonicalEncodingError("MERKLE_BAD_STATE_HASH_LEN", `stateHash must be 32 bytes`);
  }
  if (leaf.lastEventHash.length !== 32) {
    throw new CanonicalEncodingError("MERKLE_BAD_EVENT_HASH_LEN", `lastEventHash must be 32 bytes`);
  }
  const idBytes = utf8NfcBytes(leaf.streamId);
  if (idBytes.length > 0xffff) {
    throw new CanonicalEncodingError("MERKLE_STREAM_ID_TOO_LONG", `streamId UTF-8 byte length exceeds uint16`);
  }
  const payload = concatBytes(
    encodeUint16(idBytes.length),
    idBytes,
    leaf.stateHash,
    leaf.lastEventHash,
    encodeUint64(leaf.lastSeqno),
  );
  return domainHash(DOMAIN_TAGS.MERKLE_LEAF_V1, payload);
}

/** Stream-tree root; leaves ordered by UTF-8 byte order of streamId (NFC). */
export function streamTreeRoot(leaves: readonly StreamLeaf[]): Uint8Array {
  if (leaves.length === 0) {
    throw new CanonicalEncodingError("MERKLE_EMPTY", "stream tree requires at least one leaf");
  }
  const sorted = leaves.slice().sort((a, b) => compareUtf8(a.streamId, b.streamId));
  return binaryMerkle(sorted.map(streamLeafHash), DOMAIN_TAGS.MERKLE_NODE_V1);
}

// --- State root (CAL Spec §7.3) ---

export interface StateNamespace {
  readonly name: string;
  readonly canonicalBytes: Uint8Array;
}

/** Leaf hash for one namespace (CAL §7.3). */
export function stateNamespaceLeafHash(ns: StateNamespace): Uint8Array {
  const inner = domainHash(DOMAIN_TAGS.STATE_V1, ns.canonicalBytes);
  const nameBytes = utf8NfcBytes(ns.name);
  if (nameBytes.length > 0xffff) {
    throw new CanonicalEncodingError("STATE_ROOT_NAME_TOO_LONG", `namespace name UTF-8 length exceeds uint16`);
  }
  const payload = concatBytes(encodeUint16(nameBytes.length), nameBytes, inner);
  return domainHash(DOMAIN_TAGS.STATE_ROOT_V1, payload);
}

/** State root over namespaces, ordered by name (UTF-8 byte order). */
export function stateRoot(namespaces: readonly StateNamespace[]): Uint8Array {
  if (namespaces.length === 0) {
    throw new CanonicalEncodingError("STATE_ROOT_EMPTY", "state root requires at least one namespace");
  }
  const seen = new Set<string>();
  for (const ns of namespaces) {
    if (seen.has(ns.name)) {
      throw new CanonicalEncodingError("STATE_ROOT_DUPLICATE_NAMESPACE", `duplicate namespace ${JSON.stringify(ns.name)}`);
    }
    seen.add(ns.name);
  }
  const sorted = namespaces.slice().sort((a, b) => compareUtf8(a.name, b.name));
  return binaryMerkle(sorted.map(stateNamespaceLeafHash), DOMAIN_TAGS.STATE_ROOT_V1);
}
