/**
 * L5 Fabric — StorageAdapter conformance harness (D9). The CONTRACT every storage backend must
 * satisfy, as reusable code (so an adapter author validates offline before wiring a live node).
 *
 * Storage is content-addressed (`mem:<64hex>` ↔ bytes) and OUT OF ROOT (D2): the backend a blob
 * lives in never enters a MemoryObject or any hashed value. The harness therefore checks behaviour,
 * not values: round-trip fidelity + content-address integrity + the coded errors.
 *
 * ARCHITECT-OWNED CONTRACT. The signature below is FROZEN; DeepSeek implements the body
 * (docs/TASK-deepseek-L5.md). New exports may be added; the declared signature may not change.
 */
import type { StorageAdapter } from "../adapters/storage.js";

/**
 * Run the StorageAdapter contract against a FRESH adapter obtained from `makeAdapter` (called once;
 * the harness assumes it starts empty). Resolves if the adapter satisfies the contract; otherwise
 * throws `[STORAGE_CONFORMANCE_FAIL] <which check>`. Checks, all on `mem:<64hex>` refs:
 *  - put then get → byte-identical; `has` is false before put, true after.
 *  - idempotent put: same ref + identical bytes is a no-op (no throw, get still byte-identical).
 *  - content-address integrity: same ref + DIFFERENT bytes throws `[CAS_CONFLICT]`.
 *  - get of an absent ref throws `[CAS_MISSING]`; `has` of an absent ref is false.
 *  - a malformed ref (missing prefix / wrong hex length) throws `[CAS_BAD_REF]` on put/get/has.
 */
export function checkStorageAdapterConformance(
  _makeAdapter: () => StorageAdapter | Promise<StorageAdapter>,
): Promise<void> {
  throw new Error("[TODO_L5] checkStorageAdapterConformance not implemented");
}
