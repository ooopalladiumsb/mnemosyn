/**
 * L5 Fabric — MemoryCAS (D9). Pure in-memory content-addressed store: the reference adapter that
 * passes the conformance harness with zero external services (the in-RAM sibling of `LocalCAS`).
 * Same content-address integrity semantics as `LocalCAS`: idempotent put, `[CAS_CONFLICT]` on a
 * ref reuse with different bytes, `[CAS_MISSING]` on absent get, `[CAS_BAD_REF]` on a malformed ref.
 *
 * ARCHITECT-OWNED CONTRACT. The class + method SIGNATURES are FROZEN; DeepSeek implements the body.
 */
import type { StorageAdapter } from "../adapters/storage.js";

/** v0 in-memory content-addressed store. Ciphertext is held in a `Map<ref, bytes>`. */
export class MemoryCAS implements StorageAdapter {
  async put(_ref: string, _bytes: Uint8Array): Promise<void> {
    throw new Error("[TODO_L5] MemoryCAS.put not implemented");
  }

  async get(_ref: string): Promise<Uint8Array> {
    throw new Error("[TODO_L5] MemoryCAS.get not implemented");
  }

  async has(_ref: string): Promise<boolean> {
    throw new Error("[TODO_L5] MemoryCAS.has not implemented");
  }
}
