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
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { SpineStore } from "./spine.js";
import type { MemoryObject, VaultDid, EncMeta, MemoryKind, AgentDid, CapabilityId } from "./types.js";
import { ZERO_HASH_HEX } from "./types.js";
import { memoryObjectId } from "./object.js";

// ---------------------------------------------------------------------------
// Key encoding: lowercase hex of UTF-8 bytes — bijective, filesystem-safe.
// ---------------------------------------------------------------------------

function hexEncode(s: string): string {
  return Buffer.from(s, "utf-8").toString("hex");
}

function hexDecode(hex: string): string {
  return Buffer.from(hex, "hex").toString("utf-8");
}

// ---------------------------------------------------------------------------
// Bigint-safe serialization — ensures `memoryObjectId(deserialized) === objectId`.
// ---------------------------------------------------------------------------

interface SerializedObject {
  schema_version: number;
  vault_did: string;
  space: string;
  seqno: string;          // decimal string for bigint preservation
  kind: string;
  content_commit: string;
  content_ref: string;
  enc: EncMeta;
  meta_commit: string;
  writer_did: string;
  capability_id: string;
  created_at?: string;    // decimal string for bigint preservation (optional)
  prev: string;
}

interface SpaceFile {
  head: string;
  count: string;          // decimal string for bigint
}

function serialize(obj: MemoryObject): SerializedObject {
  const s: SerializedObject = {
    schema_version: obj.schema_version,
    vault_did: obj.vault_did,
    space: obj.space,
    seqno: BigInt(obj.seqno).toString(10),
    kind: obj.kind,
    content_commit: obj.content_commit,
    content_ref: obj.content_ref,
    enc: obj.enc,
    meta_commit: obj.meta_commit,
    writer_did: obj.writer_did,
    capability_id: obj.capability_id,
    prev: obj.prev,
  };
  if (obj.created_at !== undefined) {
    s.created_at = BigInt(obj.created_at).toString(10);
  }
  return s;
}

function deserialize(data: SerializedObject): MemoryObject {
  const obj: MemoryObject = {
    schema_version: data.schema_version,
    vault_did: data.vault_did,
    space: data.space,
    seqno: BigInt(data.seqno),
    kind: data.kind as MemoryKind,
    content_commit: data.content_commit,
    content_ref: data.content_ref,
    enc: data.enc,
    meta_commit: data.meta_commit,
    writer_did: data.writer_did as AgentDid,
    capability_id: data.capability_id as CapabilityId,
    prev: data.prev,
  };
  if (data.created_at !== undefined) {
    (obj as unknown as Record<string, unknown>).created_at = BigInt(data.created_at);
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

/** On-disk content-addressed object log + per-space head/count, rooted at `rootDir`. */
export class FileSpineStore implements SpineStore {
  constructor(private readonly rootDir: string) {}

  private vaultKey(vaultDid: VaultDid): string {
    return hexEncode(vaultDid);
  }

  private spaceKey(space: string): string {
    return hexEncode(space);
  }

  private objectsDir(vaultDid: VaultDid): string {
    return join(this.rootDir, this.vaultKey(vaultDid), "objects");
  }

  private spacesDir(vaultDid: VaultDid): string {
    return join(this.rootDir, this.vaultKey(vaultDid), "spaces");
  }

  private spaceFilePath(vaultDid: VaultDid, space: string): string {
    return join(this.spacesDir(vaultDid), this.spaceKey(space) + ".json");
  }

  async putObject(obj: MemoryObject): Promise<void> {
    const id = memoryObjectId(obj);
    const objPath = join(this.objectsDir(obj.vault_did), id + ".json");
    const spacePath = this.spaceFilePath(obj.vault_did, obj.space);

    // Ensure directories exist
    await mkdir(dirname(objPath), { recursive: true });
    await mkdir(dirname(spacePath), { recursive: true });

    // Check if object already exists (content-addressed: same object_id = same object)
    const existing = await readJsonSafe<SerializedObject>(objPath);
    if (existing) {
      // Object file already exists — idempotent, no-op
      return;
    }

    // Write object file
    const serialized = serialize(obj);
    await writeFile(objPath, JSON.stringify(serialized), "utf-8");

    // Update space file
    let space: SpaceFile = await readJsonSafe<SpaceFile>(spacePath) ?? { head: ZERO_HASH_HEX, count: "0" };
    space.head = id;
    space.count = (BigInt(space.count) + 1n).toString(10);
    await writeFile(spacePath, JSON.stringify(space), "utf-8");
  }

  async getObject(vaultDid: VaultDid, objectId: string): Promise<MemoryObject | null> {
    const path = join(this.objectsDir(vaultDid), objectId + ".json");
    const data = await readJsonSafe<SerializedObject>(path);
    if (!data) return null;
    return deserialize(data);
  }

  async spaceCount(vaultDid: VaultDid, space: string): Promise<number | bigint> {
    const path = this.spaceFilePath(vaultDid, space);
    const data = await readJsonSafe<SpaceFile>(path);
    if (!data) return 0n;
    return BigInt(data.count);
  }

  async spaceHeadHash(vaultDid: VaultDid, space: string): Promise<string> {
    const path = this.spaceFilePath(vaultDid, space);
    const data = await readJsonSafe<SpaceFile>(path);
    if (!data) return ZERO_HASH_HEX;
    return data.head;
  }

  async listSpaces(vaultDid: VaultDid): Promise<readonly string[]> {
    const dir = this.spacesDir(vaultDid);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }
    return entries
      .filter((e) => e.endsWith(".json"))
      .map((e) => hexDecode(e.slice(0, -5))); // strip ".json" then decode
  }
}
