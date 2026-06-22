/**
 * Encryption + content identity. CONTRACT frozen by architect; bodies by DeepSeek (TASK §T3).
 *
 * Two cryptographic identities, never conflated (Decision Record D2):
 *   - Storage Commitment  = domainHash(MEMORY_CONTENT_V1, ciphertext)  → anchored, in MemoryObject
 *   - Content Identity     = HMAC(vault_content_key, plaintext)         → owner-local, NEVER anchored
 *
 * Design choices (see docs/NOTES-deepseek.md):
 *   - AES-256-GCM via node:crypto. The 16-byte GCM auth tag is APPENDED to the ciphertext:
 *     stored ciphertext = aes_gcm_ct || tag. `decrypt` splits the trailing 16 bytes back off.
 *   - v0 uses the 32-byte vault KEK DIRECTLY as the data key (no per-object DEK), so
 *     enc.wrap_b64 = "" (no wrapped DEK). The field exists for the future per-object-DEK path.
 *   - The 12-byte GCM nonce is the ONLY non-determinism in the spine, and it is permitted here
 *     because it is NOT hashed: content_commit is over the resulting ciphertext, and the spine
 *     stores whatever ciphertext it is handed.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { domainHash } from "../canonical/hash.js";
import { MNEMOSYNE_TAGS } from "../canonical/domains.js";
import type { EncMeta } from "../spine/types.js";

const GCM_TAG_LEN = 16;
const GCM_NONCE_LEN = 12;
const KEY_LEN = 32;

export interface EncryptResult {
  readonly ciphertext: Uint8Array;
  readonly enc: EncMeta;
}

function assertKey(key: Uint8Array): void {
  if (key.length !== KEY_LEN) {
    throw new Error(`[ENC_BAD_KEY_LEN] vault KEK must be ${KEY_LEN} bytes, got ${key.length}`);
  }
}

/** AES-256-GCM encrypt `plaintext` under the vault key referenced by `keyId`. */
export function encrypt(plaintext: Uint8Array, vaultKek: Uint8Array, keyId: string): EncryptResult {
  assertKey(vaultKek);
  const nonce = randomBytes(GCM_NONCE_LEN);
  const cipher = createCipheriv("aes-256-gcm", vaultKek, nonce);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ciphertext = new Uint8Array(Buffer.concat([ct, tag])); // ct || tag
  const enc: EncMeta = {
    alg: "AES-256-GCM",
    key_id: keyId,
    nonce_b64: Buffer.from(nonce).toString("base64"),
    wrap_b64: "", // v0: KEK used directly as DEK, no wrapped per-object key
  };
  return { ciphertext, enc };
}

/** AES-256-GCM decrypt using `enc` metadata and the vault KEK. Throws on tag mismatch. */
export function decrypt(ciphertext: Uint8Array, enc: EncMeta, vaultKek: Uint8Array): Uint8Array {
  assertKey(vaultKek);
  if (enc.alg !== "AES-256-GCM") {
    throw new Error(`[ENC_BAD_ALG] unsupported alg ${JSON.stringify(enc.alg)}`);
  }
  if (ciphertext.length < GCM_TAG_LEN) {
    throw new Error("[ENC_CIPHERTEXT_TOO_SHORT] ciphertext shorter than GCM tag");
  }
  const nonce = Buffer.from(enc.nonce_b64, "base64");
  const ct = ciphertext.subarray(0, ciphertext.length - GCM_TAG_LEN);
  const tag = ciphertext.subarray(ciphertext.length - GCM_TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", vaultKek, nonce);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(ct), decipher.final()]));
}

/** Storage Commitment over CIPHERTEXT (the value committed into MemoryObject + anchored). */
export function contentCommit(ciphertext: Uint8Array): Uint8Array {
  return domainHash(MNEMOSYNE_TAGS.MEMORY_CONTENT_V1, ciphertext);
}

/**
 * Content Identity: keyed HMAC-SHA256 of PLAINTEXT under a per-vault content key. Owner-local only,
 * for dedup/migration. NEVER stored in MemoryObject, NEVER anchored (would be a guessing oracle).
 */
export function contentIdentity(plaintext: Uint8Array, vaultContentKey: Uint8Array): Uint8Array {
  return new Uint8Array(createHmac("sha256", vaultContentKey).update(plaintext).digest());
}
