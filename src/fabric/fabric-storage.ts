/**
 * L5 Fabric — FabricStorage (D9). A `StorageAdapter` over N backend replicas: one content-addressed
 * blob, mirrored across backends. Because storage is content-addressed and OUT OF ROOT, any replica
 * is interchangeable — the fabric writes through to all and reads from whichever has the blob.
 *
 * - `put(ref, bytes)`: write through to EVERY replica (content-addressed → idempotent; a replica
 *   that already holds different bytes surfaces its `[CAS_CONFLICT]`).
 * - `get(ref)`: try replicas in order, return the FIRST hit; `[CAS_MISSING]` only if none has it.
 * - `has(ref)`: true iff ANY replica has it.
 * - `locate(ref)`: a `ContentLocator` naming the replicas that currently hold `ref` — OUT-OF-BAND
 *   replica hints (D2), NEVER committed to a MemoryObject or any hashed value.
 *
 * ARCHITECT-OWNED CONTRACT. `FabricReplica`, `FabricStorage`, and `createFabricStorage` are FROZEN;
 * DeepSeek implements the body (docs/TASK-deepseek-L5.md).
 */
import type { StorageAdapter } from "../adapters/storage.js";
import type { ContentLocator, ReplicaHint } from "../spine/types.js";
import { fromHex } from "../canonical/hash.js";
import { MEM_REF_PREFIX } from "../adapters/storage.js";

/** One backend in the fabric: a human-readable hint (adapter name + uri) + the adapter itself. */
export interface FabricReplica {
  readonly hint: ReplicaHint;
  readonly storage: StorageAdapter;
}

/** A multi-replica `StorageAdapter` that also reports where a blob is held (out-of-band). */
export interface FabricStorage extends StorageAdapter {
  /** Out-of-band replica hints for `ref` (the replicas that currently `has` it). Never committed. */
  locate(ref: string): Promise<ContentLocator>;
}

/** Decode the hex body of a `mem:` ref into a 32-byte content commit. */
function refToContentCommit(ref: string): Uint8Array {
  // validateRef from memory-cas validates shape — reuse that logic here.
  if (!ref.startsWith(MEM_REF_PREFIX)) {
    throw new Error(`[CAS_BAD_REF] content ref must start with "${MEM_REF_PREFIX}", got ${JSON.stringify(ref)}`);
  }
  const hex = ref.slice(MEM_REF_PREFIX.length);
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`[CAS_BAD_REF] content ref hex must be 64 lowercase hex chars, got ${JSON.stringify(hex)}`);
  }
  return fromHex(hex);
}

/** Compose backend replicas into a single content-addressed fabric. Order defines read preference. */
export function createFabricStorage(replicas: readonly FabricReplica[]): FabricStorage {
  const r = [...replicas]; // shallow copy for safety

  return {
    async put(ref: string, bytes: Uint8Array): Promise<void> {
      // Write-through to EVERY replica. Let any CAS_CONFLICT/CAS_BAD_REF propagate.
      for (const rep of r) {
        await rep.storage.put(ref, bytes);
      }
    },

    async get(ref: string): Promise<Uint8Array> {
      // Try replicas in declared order; return first hit.
      // CAS_BAD_REF surfaces immediately; CAS_MISSING on a single replica → try next.
      for (const rep of r) {
        try {
          if (await rep.storage.has(ref)) {
            return rep.storage.get(ref);
          }
        } catch (e: any) {
          // If CAS_BAD_REF, surface immediately; if CAS_MISSING/other, skip to next replica.
          if (e?.message?.includes("[CAS_BAD_REF]")) throw e;
          continue;
        }
      }
      throw new Error(`[CAS_MISSING] no replica holds ref ${JSON.stringify(ref)}`);
    },

    async has(ref: string): Promise<boolean> {
      for (const rep of r) {
        try {
          if (await rep.storage.has(ref)) return true;
        } catch (e: any) {
          if (e?.message?.includes("[CAS_BAD_REF]")) throw e;
          continue;
        }
      }
      return false;
    },

    async locate(ref: string): Promise<ContentLocator> {
      const contentCommit = refToContentCommit(ref);
      const holding: ReplicaHint[] = [];
      for (const rep of r) {
        try {
          if (await rep.storage.has(ref)) {
            holding.push(rep.hint);
          }
        } catch (e: any) {
          if (e?.message?.includes("[CAS_BAD_REF]")) throw e;
          continue;
        }
      }
      return { contentCommit, replicas: holding };
    },
  };
}
