/**
 * L5 Fabric — MemoryCAS (D9). Pure in-memory content-addressed store: the reference adapter that
 * passes the conformance harness with zero external services (the in-RAM sibling of `LocalCAS`).
 * Same content-address integrity semantics as `LocalCAS`: idempotent put, `[CAS_CONFLICT]` on a
 * ref reuse with different bytes, `[CAS_MISSING]` on absent get, `[CAS_BAD_REF]` on a malformed ref.
 *
 * ARCHITECT-OWNED CONTRACT. The class + method SIGNATURES are FROZEN; DeepSeek implements the body.
 */
import type { StorageAdapter } from "../adapters/storage.js";
import { MEM_REF_PREFIX } from "../adapters/storage.js";

/** Validate ref shape: must start with "mem:" followed by 64 lowercase hex chars. */
function validateRef(ref: string): void {
  if (!ref.startsWith(MEM_REF_PREFIX)) {
    throw new Error(`[CAS_BAD_REF] content ref must start with "${MEM_REF_PREFIX}", got ${JSON.stringify(ref)}`);
  }
  const hex = ref.slice(MEM_REF_PREFIX.length);
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`[CAS_BAD_REF] content ref hex must be 64 lowercase hex chars, got ${JSON.stringify(hex)}`);
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** v0 in-memory content-addressed store. Ciphertext is held in a `Map<ref, bytes>`. */
export class MemoryCAS implements StorageAdapter {
  private readonly store = new Map<string, Uint8Array>();

  async put(ref: string, bytes: Uint8Array): Promise<void> {
    validateRef(ref);
    const existing = this.store.get(ref);
    if (existing) {
      if (bytesEqual(existing, bytes)) return; // idempotent
      throw new Error(`[CAS_CONFLICT] ref ${JSON.stringify(ref)} already stores different bytes`);
    }
    // Store a COPY so caller mutations of the input array don't corrupt the store.
    this.store.set(ref, bytes.slice());
  }

  async get(ref: string): Promise<Uint8Array> {
    validateRef(ref);
    const bytes = this.store.get(ref);
    if (!bytes) {
      throw new Error(`[CAS_MISSING] no content stored under ref ${JSON.stringify(ref)}`);
    }
    // Return a COPY so caller mutations don't affect the store.
    return bytes.slice();
  }

  async has(ref: string): Promise<boolean> {
    validateRef(ref);
    return this.store.has(ref);
  }
}
