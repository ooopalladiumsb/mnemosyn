/**
 * Spine protocol: append / recall_by_id / checkpoint. CONTRACT frozen; bodies by DeepSeek
 * (TASK §T5d). `append` (steps deriving seqno/object_id/roots) is a PURE function of its inputs
 * → byte-identical across runs (golden vectors). Ordering by seqno only (AI-7).
 */
import type { StorageAdapter } from "../adapters/storage.js";
import type { AnchorAdapter, AnchorReceipt } from "../adapters/anchor.js";
import { contentCommit } from "../crypto/encryption.js";
import { toHex } from "../canonical/hash.js";
import { memoryObjectId, metaCommit } from "./object.js";
import { spaceStateHash, type SpaceHead } from "./space.js";
import { vaultMemoryRoot } from "./vault.js";
import {
  ZERO_HASH_HEX,
  type AppendReceipt,
  type EncMeta,
  type MemoryKind,
  type MemoryObject,
  type PublicMeta,
  type VaultDid,
  type AgentDid,
  type CapabilityId,
} from "./types.js";

const SCHEMA_VERSION = 1;

export interface SpineStore {
  /** Persist an object + updated space head; returns nothing. Implemented over any backend. */
  putObject(obj: MemoryObject): Promise<void>;
  getObject(vaultDid: VaultDid, objectId: string): Promise<MemoryObject | null>;
  spaceCount(vaultDid: VaultDid, space: string): Promise<number | bigint>;
  spaceHeadHash(vaultDid: VaultDid, space: string): Promise<string>; // ZERO_HASH_HEX if empty
  listSpaces(vaultDid: VaultDid): Promise<readonly string[]>;
}

export interface AppendInput {
  readonly vaultDid: VaultDid;
  readonly space: string;
  readonly kind: MemoryKind;
  readonly ciphertext: Uint8Array;
  readonly enc: EncMeta;
  readonly writerDid: AgentDid;
  readonly capabilityId: CapabilityId;
  readonly createdAt?: number | bigint;
  readonly tags?: readonly string[];
}

export interface Spine {
  append(input: AppendInput): Promise<AppendReceipt>;
  recallById(vaultDid: VaultDid, objectId: string): Promise<{ obj: MemoryObject; ciphertext: Uint8Array }>;
  checkpoint(vaultDid: VaultDid): Promise<AnchorReceipt>;
}

/**
 * Reconstruct a SpaceHead from the store by walking the `prev` chain back from the current head.
 * The store interface exposes only head/count, so object ids are recovered from the immutable log.
 */
async function loadSpaceHead(store: SpineStore, vaultDid: VaultDid, space: string): Promise<SpaceHead> {
  const count = await store.spaceCount(vaultDid, space);
  const head = await store.spaceHeadHash(vaultDid, space);
  const ids: string[] = [];
  let cur = head;
  while (cur !== ZERO_HASH_HEX) {
    const obj = await store.getObject(vaultDid, cur);
    if (obj === null) throw new Error(`[SPINE_BROKEN_CHAIN] missing object ${cur} in ${vaultDid}/${space}`);
    ids.push(cur);
    cur = obj.prev;
  }
  ids.reverse(); // walked newest→oldest; canonical order is append order (oldest→newest)
  return { vaultDid, space, count, objectIds: ids, lastEventHash: head };
}

async function allSpaceHeads(store: SpineStore, vaultDid: VaultDid): Promise<SpaceHead[]> {
  const spaces = await store.listSpaces(vaultDid);
  const heads: SpaceHead[] = [];
  for (const space of spaces) heads.push(await loadSpaceHead(store, vaultDid, space));
  return heads;
}

export function createSpine(deps: {
  store: SpineStore;
  storage: StorageAdapter;
  anchor: AnchorAdapter;
}): Spine {
  const { store, storage, anchor } = deps;

  async function append(input: AppendInput): Promise<AppendReceipt> {
    // 1–2. content commitment (over ciphertext, D2) and content-address storage.
    const contentCommitHex = toHex(contentCommit(input.ciphertext));
    const contentRef = `mem:${contentCommitHex}`;
    await storage.put(contentRef, input.ciphertext);

    // 3. seqno = current append count (ordering authority, AI-7).
    const seqno = await store.spaceCount(input.vaultDid, input.space);

    // 4. assemble the immutable object.
    const prev = await store.spaceHeadHash(input.vaultDid, input.space);
    const meta: PublicMeta = {
      schema_version: SCHEMA_VERSION,
      kind: input.kind,
      ...(input.createdAt !== undefined ? { created_at: input.createdAt } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
    };
    const obj: MemoryObject = {
      schema_version: SCHEMA_VERSION,
      vault_did: input.vaultDid,
      space: input.space,
      seqno,
      kind: input.kind,
      content_commit: contentCommitHex,
      content_ref: contentRef,
      enc: input.enc,
      meta_commit: metaCommit(meta),
      writer_did: input.writerDid,
      capability_id: input.capabilityId,
      ...(input.createdAt !== undefined ? { created_at: input.createdAt } : {}),
      prev,
    };

    // 5. object id + persist (store advances the space head).
    const objectId = memoryObjectId(obj);
    await store.putObject(obj);

    // 6. recompute the affected space state and the vault root over all spaces.
    const currentHead = await loadSpaceHead(store, input.vaultDid, input.space);
    const spaceState = toHex(spaceStateHash(currentHead));
    const heads = await allSpaceHeads(store, input.vaultDid);
    const vaultRoot = toHex(vaultMemoryRoot(heads));

    // 7. receipt.
    return { object_id: objectId, seqno, space_state: spaceState, vault_memory_root: vaultRoot };
  }

  async function recallById(
    vaultDid: VaultDid,
    objectId: string,
  ): Promise<{ obj: MemoryObject; ciphertext: Uint8Array }> {
    const obj = await store.getObject(vaultDid, objectId);
    if (obj === null) throw new Error(`[SPINE_NOT_FOUND] object ${objectId} not found in ${vaultDid}`);
    const ciphertext = await storage.get(obj.content_ref);
    return { obj, ciphertext }; // decryption is the caller's concern in L0 (no KEK here)
  }

  async function checkpoint(vaultDid: VaultDid): Promise<AnchorReceipt> {
    const heads = await allSpaceHeads(store, vaultDid);
    const root = vaultMemoryRoot(heads);
    const latest = await anchor.latest(vaultDid);
    const version = latest ? latest.version + 1n : 0n;
    return anchor.anchor(vaultDid, root, version);
  }

  return { append, recallById, checkpoint };
}
