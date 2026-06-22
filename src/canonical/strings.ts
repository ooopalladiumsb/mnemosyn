/**
 * String canonicalization — vendored from CE v1.3, byte-identical to paradigm_terra (D1).
 * CONTRACT frozen by architect; bodies implemented by DeepSeek (TASK §T1).
 *
 * A canonical string MUST contain only code points assigned as of Unicode 15.1 (CE v1.3 §3.2).
 * This keeps NFC identical across the TS/Rust/Go backends despite their differing Unicode versions
 * (Unicode Normalization Stability Policy). See the NFC-pinning note in paradigm_terra.
 */
import { CanonicalEncodingError, NoncanonicalEventError } from "./errors.js";
import { isAssignedCodePoint } from "./unicodeAssigned.js";

const UTF8_ENCODER = new TextEncoder();

/** Throw on the first scalar not assigned as of Unicode 15.1 (CE v1.3 §3.2 domain restriction). */
export function assertAssigned(s: string): void {
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (!isAssignedCodePoint(cp)) {
      throw new NoncanonicalEventError(
        "UTF8_UNASSIGNED_CODEPOINT",
        `code point U+${cp.toString(16).toUpperCase().padStart(4, "0")} is not assigned as of Unicode 15.1`,
      );
    }
  }
}

/**
 * UTF-8 bytes of the NFC-normalized string, restricted to the Unicode 15.1 assigned set.
 * Throws on a leading BOM (U+FEFF) or lone UTF-16 surrogates that survive normalization.
 */
export function utf8NfcBytes(s: string): Uint8Array {
  if (s.length > 0 && s.charCodeAt(0) === 0xfeff) {
    throw new NoncanonicalEventError("UTF8_BOM_FORBIDDEN", "BOM at start of string is forbidden");
  }
  assertAssigned(s);
  const normalized = s.normalize("NFC");
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdfff) {
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < normalized.length) {
        const next = normalized.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          i++; // valid pair, skip low surrogate
          continue;
        }
      }
      throw new NoncanonicalEventError(
        "UTF8_LONE_SURROGATE",
        `lone UTF-16 surrogate U+${code.toString(16).toUpperCase()} at position ${i}`,
      );
    }
  }
  return UTF8_ENCODER.encode(normalized);
}

/**
 * Sanity check: verify the host JS engine implements NFC.
 * "e + combining acute" (U+0065 U+0301) MUST normalize to U+00E9.
 */
function assertNfcAvailable(): void {
  const composed = "é".normalize("NFC");
  if (composed !== "é") {
    throw new CanonicalEncodingError(
      "NFC_UNAVAILABLE",
      `host JS engine NFC normalization is broken or absent (got ${JSON.stringify(composed)})`,
    );
  }
}

assertNfcAvailable();
