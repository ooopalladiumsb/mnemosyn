/**
 * Hashing primitives — vendored from CE v1.3, byte-identical to paradigm_terra (D1).
 * CONTRACT frozen by architect; bodies implemented by DeepSeek (TASK §T1).
 */
import { createHash } from "node:crypto";
import { isAsciiDomainTag } from "./domains.js";
import { CanonicalEncodingError } from "./errors.js";

const ASCII = new TextEncoder();

/** SHA-256 of `bytes`, 32-byte output. */
export function sha256(bytes: Uint8Array): Uint8Array {
  const h = createHash("sha256");
  h.update(bytes);
  return new Uint8Array(h.digest());
}

/** Domain-separated hash: `SHA-256(utf8(domain) || payload)` per CE v1.3 §7. */
export function domainHash(domain: string, payload: Uint8Array): Uint8Array {
  if (!isAsciiDomainTag(domain)) {
    throw new CanonicalEncodingError(
      "DOMAIN_TAG_NONCANONICAL",
      `domain tag must be ASCII, got ${JSON.stringify(domain)}`,
    );
  }
  const tagBytes = ASCII.encode(domain);
  const combined = new Uint8Array(tagBytes.length + payload.length);
  combined.set(tagBytes, 0);
  combined.set(payload, tagBytes.length);
  return sha256(combined);
}

/** Concatenate byte arrays. */
export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Lowercase hex (no `0x` prefix) of a digest. */
export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** Parse lowercase hex (no `0x` prefix) to bytes. Accepts upper-case on input; rejects odd length. */
export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new CanonicalEncodingError("HEX_ODD_LENGTH", `hex string must have even length, got ${hex.length}`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const hi = parseHexDigit(hex.charCodeAt(2 * i));
    const lo = parseHexDigit(hex.charCodeAt(2 * i + 1));
    if (hi < 0 || lo < 0) {
      throw new CanonicalEncodingError("HEX_INVALID_CHAR", `invalid hex character at position ${2 * i}`);
    }
    out[i] = (hi << 4) | lo;
  }
  return out;
}

function parseHexDigit(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30; // 0-9
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10; // a-f
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10; // A-F (accepted on input)
  return -1;
}
