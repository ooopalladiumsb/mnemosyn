/**
 * MemorySpace = append-only stream per (vault_did, space). Maps onto canonical StreamLeaf.
 * CONTRACT frozen; bodies by DeepSeek (TASK §T5b).
 *
 * Empty-space sentinel (docs/NOTES-deepseek.md): when a space holds no objects, objects_root is
 * defined as 32 zero bytes (binaryMerkle is undefined over an empty leaf set). spaceStateHash is
 * therefore well-defined from seqno 0 onward.
 */
import { canonicalBytes, type Json } from "../canonical/jcs.js";
import { domainHash, toHex, fromHex } from "../canonical/hash.js";
import { binaryMerkle, type StreamLeaf } from "../canonical/merkle.js";
import { DOMAIN_TAGS, MNEMOSYNE_TAGS } from "../canonical/domains.js";
import { ZERO_HASH_HEX, type VaultDid } from "./types.js";

/** In-memory/persisted head of one space. */
export interface SpaceHead {
  readonly vaultDid: VaultDid;
  readonly space: string;
  readonly count: number | bigint; // next seqno
  readonly objectIds: readonly string[]; // hex object_ids in append order
  readonly lastEventHash: string; // hex object_id of most recent (or ZERO_HASH_HEX)
}

/** streamId = `${vaultDid}/${space}`. */
export function streamId(vaultDid: VaultDid, space: string): string {
  return `${vaultDid}/${space}`;
}

/** objects_root over the space's object ids; 32 zero bytes when the space is empty. */
function objectsRoot(objectIds: readonly string[]): Uint8Array {
  if (objectIds.length === 0) return new Uint8Array(32);
  return binaryMerkle(objectIds.map((id) => fromHex(id)), DOMAIN_TAGS.MERKLE_NODE_V1);
}

/**
 * stateHash(space) = domainHash(MEMORY_SPACE_V1, canonicalBytes({ count, objects_root }))
 * where objects_root = binaryMerkle(objectIds, MERKLE_NODE_V1) (empty space → 32 zero bytes).
 */
export function spaceStateHash(head: SpaceHead): Uint8Array {
  const payload: Json = {
    count: head.count,
    objects_root: toHex(objectsRoot(head.objectIds)),
  };
  return domainHash(MNEMOSYNE_TAGS.MEMORY_SPACE_V1, canonicalBytes(payload));
}

/** Build the canonical StreamLeaf for this space head (for streamTreeRoot). */
export function spaceStreamLeaf(head: SpaceHead): StreamLeaf {
  return {
    streamId: streamId(head.vaultDid, head.space),
    stateHash: spaceStateHash(head),
    lastEventHash: head.lastEventHash === ZERO_HASH_HEX ? new Uint8Array(32) : fromHex(head.lastEventHash),
    lastSeqno: head.count,
  };
}
