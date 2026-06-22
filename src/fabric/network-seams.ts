/**
 * L5 Fabric — typed network storage seams (D9). `IpfsStorage` / `BtfsStorage` / `TonStorage`
 * implement `StorageAdapter` so callers and `FabricStorage` can target them BY TYPE today; their
 * methods throw `[STORAGE_NOT_AVAILABLE]` until wired to a live node. Live wiring is a later,
 * network-gated deliverable (mirrors paradigm_terra's PP settlements) and is NOT part of any L5
 * offline gate. These are complete as typed seams — no body for DeepSeek to fill.
 *
 * ARCHITECT-OWNED CONTRACT (frozen). Each adapter is a content-addressed `mem:<hex>` resolver once
 * wired; until then every method is unavailable.
 */
import type { StorageAdapter } from "../adapters/storage.js";

const NOT_AVAILABLE = "[STORAGE_NOT_AVAILABLE]";

/** IPFS content-addressed storage seam (no live IPFS node in L5). */
export class IpfsStorage implements StorageAdapter {
  async put(_ref: string, _bytes: Uint8Array): Promise<void> {
    throw new Error(`${NOT_AVAILABLE} IpfsStorage is a typed seam — no live IPFS node in L5`);
  }
  async get(_ref: string): Promise<Uint8Array> {
    throw new Error(`${NOT_AVAILABLE} IpfsStorage is a typed seam — no live IPFS node in L5`);
  }
  async has(_ref: string): Promise<boolean> {
    throw new Error(`${NOT_AVAILABLE} IpfsStorage is a typed seam — no live IPFS node in L5`);
  }
}

/** BTFS content-addressed storage seam (no live BTFS node in L5). */
export class BtfsStorage implements StorageAdapter {
  async put(_ref: string, _bytes: Uint8Array): Promise<void> {
    throw new Error(`${NOT_AVAILABLE} BtfsStorage is a typed seam — no live BTFS node in L5`);
  }
  async get(_ref: string): Promise<Uint8Array> {
    throw new Error(`${NOT_AVAILABLE} BtfsStorage is a typed seam — no live BTFS node in L5`);
  }
  async has(_ref: string): Promise<boolean> {
    throw new Error(`${NOT_AVAILABLE} BtfsStorage is a typed seam — no live BTFS node in L5`);
  }
}

/** TON Storage content-addressed storage seam (no live TON Storage in L5). */
export class TonStorage implements StorageAdapter {
  async put(_ref: string, _bytes: Uint8Array): Promise<void> {
    throw new Error(`${NOT_AVAILABLE} TonStorage is a typed seam — no live TON Storage in L5`);
  }
  async get(_ref: string): Promise<Uint8Array> {
    throw new Error(`${NOT_AVAILABLE} TonStorage is a typed seam — no live TON Storage in L5`);
  }
  async has(_ref: string): Promise<boolean> {
    throw new Error(`${NOT_AVAILABLE} TonStorage is a typed seam — no live TON Storage in L5`);
  }
}
