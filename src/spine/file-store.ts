/**
 * D13.2 — `FileSpineStore`: a durable, on-disk `SpineStore` so a vault's memory survives process
 * restart (today only the in-memory `MemSpineStore` exists). Completes the durable-vault triple:
 * `FileSpineStore` (objects + space heads) + `LocalCAS` (ciphertext blobs) + `LocalSigned({dir})`
 * (anchor chain). File-backed via `node:fs` — no new runtime dep, testable under `node:test`
 * (unlike a Bun-only `bun:sqlite`).
 *
 * Layout under `rootDir` (keys hex-encoded from UTF-8 so any vault/space string is filesystem-safe):
 *   <root>/<vaultKey>/objects/<object_id>.json   — one immutable MemoryObject
 *   <root>/<vaultKey>/spaces/<spaceKey>.json      — { head: <object_id|ZERO>, count: <decimal> }
 *
 * Faithfulness invariant (the load-bearing gate): `getObject` returns an object that re-hashes to the
 * SAME `object_id` as when stored — i.e. numeric fields (`seqno`, optional `created_at`) round-trip as
 * the SAME integer value — so a spine over `FileSpineStore` produces a byte-identical
 * `vault_memory_root` to one over `MemSpineStore`, and survives a fresh instance on the same dir.
 *
 * ARCHITECT-OWNED CONTRACT. The class + method SIGNATURES are FROZEN; DeepSeek implements the bodies
 * (docs/TASK-deepseek-D13.2.md). New private helpers/exports OK.
 */
import type { SpineStore } from "./spine.js";
import type { MemoryObject, VaultDid } from "./types.js";

/** On-disk content-addressed object log + per-space head/count, rooted at `rootDir`. */
export class FileSpineStore implements SpineStore {
  constructor(private readonly rootDir: string) {}

  async putObject(_obj: MemoryObject): Promise<void> {
    void this.rootDir;
    throw new Error("[TODO_D13_2] FileSpineStore.putObject not implemented");
  }

  async getObject(_vaultDid: VaultDid, _objectId: string): Promise<MemoryObject | null> {
    throw new Error("[TODO_D13_2] FileSpineStore.getObject not implemented");
  }

  async spaceCount(_vaultDid: VaultDid, _space: string): Promise<number | bigint> {
    throw new Error("[TODO_D13_2] FileSpineStore.spaceCount not implemented");
  }

  async spaceHeadHash(_vaultDid: VaultDid, _space: string): Promise<string> {
    throw new Error("[TODO_D13_2] FileSpineStore.spaceHeadHash not implemented");
  }

  async listSpaces(_vaultDid: VaultDid): Promise<readonly string[]> {
    throw new Error("[TODO_D13_2] FileSpineStore.listSpaces not implemented");
  }
}
