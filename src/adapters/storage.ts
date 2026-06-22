/**
 * StorageAdapter — pure content-address resolver `mem:<hex(commit)> ↔ bytes` (D2). Adapter-native
 * URIs (ipfs://, s3://, …) NEVER appear in a MemoryObject. CONTRACT frozen; LocalCAS by DeepSeek
 * (TASK §T6).
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { Buffer } from "node:buffer";

export const MEM_REF_PREFIX = "mem:";

export interface StorageAdapter {
  /** Store ciphertext under its content-address `ref` (= "mem:" + hex(content_commit)). */
  put(ref: string, bytes: Uint8Array): Promise<void>;
  get(ref: string): Promise<Uint8Array>;
  has(ref: string): Promise<boolean>;
}

/** Extract the hex content-commit from a `mem:` ref, validating shape (64 lowercase hex chars). */
function refToHex(ref: string): string {
  if (!ref.startsWith(MEM_REF_PREFIX)) {
    throw new Error(`[CAS_BAD_REF] content ref must start with "${MEM_REF_PREFIX}", got ${JSON.stringify(ref)}`);
  }
  const hex = ref.slice(MEM_REF_PREFIX.length);
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`[CAS_BAD_REF] content ref hex must be 64 lowercase hex chars, got ${JSON.stringify(hex)}`);
  }
  return hex;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** v0 default: local content-addressed store on disk at `rootDir/<first2hex>/<hex>`. */
export class LocalCAS implements StorageAdapter {
  constructor(private readonly rootDir: string) {}

  private pathFor(ref: string): string {
    const hex = refToHex(ref);
    return join(this.rootDir, hex.slice(0, 2), hex);
  }

  async put(ref: string, bytes: Uint8Array): Promise<void> {
    const path = this.pathFor(ref);
    if (await this.exists(path)) {
      // Content-address integrity: same ref + same bytes = no-op; same ref + different bytes = error.
      const existing = new Uint8Array(await readFile(path));
      if (bytesEqual(existing, bytes)) return;
      throw new Error(`[CAS_CONFLICT] ref ${JSON.stringify(ref)} already stores different bytes`);
    }
    await mkdir(join(this.rootDir, refToHex(ref).slice(0, 2)), { recursive: true });
    await writeFile(path, Buffer.from(bytes));
  }

  async get(ref: string): Promise<Uint8Array> {
    const path = this.pathFor(ref);
    if (!(await this.exists(path))) {
      throw new Error(`[CAS_MISSING] no content stored under ref ${JSON.stringify(ref)}`);
    }
    return new Uint8Array(await readFile(path));
  }

  async has(ref: string): Promise<boolean> {
    return this.exists(this.pathFor(ref));
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }
}
