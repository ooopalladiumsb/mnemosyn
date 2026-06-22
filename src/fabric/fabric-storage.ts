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

/** Compose backend replicas into a single content-addressed fabric. Order defines read preference. */
export function createFabricStorage(_replicas: readonly FabricReplica[]): FabricStorage {
  throw new Error("[TODO_L5] createFabricStorage not implemented");
}
