/**
 * Big-endian integer encoders — vendored from CE v1.3, byte-identical to paradigm_terra (D1).
 * CONTRACT frozen by architect; bodies implemented by DeepSeek (TASK §T1).
 */
import { CanonicalEncodingError } from "./errors.js";

const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT16 = (1 << 16) - 1;

/** Encode an unsigned bigint as `byteLen` big-endian bytes. */
function encodeUnsignedBe(value: bigint, byteLen: number): Uint8Array {
  const out = new Uint8Array(byteLen);
  let v = value;
  for (let i = byteLen - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** uint16 big-endian (2 bytes). Throws on out-of-range. */
export function encodeUint16(value: number | bigint): Uint8Array {
  const v = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isInteger(v) || v < 0 || v > MAX_UINT16) {
    throw new CanonicalEncodingError("UINT16_OUT_OF_RANGE", `uint16 must be 0..65535, got ${value}`);
  }
  const out = new Uint8Array(2);
  out[0] = (v >>> 8) & 0xff;
  out[1] = v & 0xff;
  return out;
}

/** uint64 big-endian (8 bytes). Throws on out-of-range / negative. */
export function encodeUint64(value: number | bigint): Uint8Array {
  const v = typeof value === "bigint" ? value : BigInt(value);
  if (v < 0n || v > MAX_UINT64) {
    throw new CanonicalEncodingError("UINT64_OUT_OF_RANGE", `uint64 must be 0..2^64-1, got ${value}`);
  }
  return encodeUnsignedBe(v, 8);
}
