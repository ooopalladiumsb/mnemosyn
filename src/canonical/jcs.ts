/**
 * Restricted JSON Canonicalization Scheme — vendored from CE v1.3 (D1).
 * Integers only (NO floats), no duplicate keys, no lone surrogates, UTF-8 byte-order key sort.
 * CONTRACT frozen by architect; bodies implemented by DeepSeek (TASK §T1).
 *
 * The frozen public entry is `canonicalBytes(value: Json)` (the value path). `canonicalizeString`
 * and `parseCanonical` are added for the conformance suite (terra's golden vectors feed JSON text,
 * and big-integer vectors exceed 2^53 so they cannot round-trip through JSON.parse).
 */
import { NoncanonicalEventError } from "./errors.js";
import { assertAssigned } from "./strings.js";

/** JSON value admissible under the restricted profile (no floats). */
export type Json =
  | null
  | boolean
  | number // integers only — non-integer numbers MUST throw
  | bigint
  | string
  | readonly Json[]
  | { readonly [k: string]: Json };

type JcsValue = null | boolean | bigint | string | readonly JcsValue[] | { readonly [k: string]: JcsValue };

function err(code: string, msg: string): NoncanonicalEventError {
  return new NoncanonicalEventError(code, msg);
}

// ============================================================================
// Parser (string → JcsValue) with duplicate-key detection
// ============================================================================

class JcsParser {
  private pos = 0;
  constructor(private readonly src: string) {}

  parse(): JcsValue {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.pos !== this.src.length) {
      throw err("JCS_TRAILING_INPUT", `unexpected character at position ${this.pos}`);
    }
    return value;
  }

  private parseValue(): JcsValue {
    this.skipWhitespace();
    if (this.pos >= this.src.length) throw err("JCS_UNEXPECTED_EOF", "unexpected end of input");
    const c = this.src.charCodeAt(this.pos);
    if (c === 0x7b) return this.parseObject();
    if (c === 0x5b) return this.parseArray();
    if (c === 0x22) return this.parseString();
    if (c === 0x74 || c === 0x66) return this.parseBool();
    if (c === 0x6e) return this.parseNull();
    if (c === 0x2d || (c >= 0x30 && c <= 0x39)) return this.parseNumber();
    throw err("JCS_UNEXPECTED_CHAR", `unexpected character at position ${this.pos}: ${this.src[this.pos]}`);
  }

  private parseObject(): { [k: string]: JcsValue } {
    this.expect(0x7b);
    const out: Record<string, JcsValue> = {};
    const seenKeys = new Set<string>();
    this.skipWhitespace();
    if (this.peek() === 0x7d) {
      this.pos++;
      return out;
    }
    while (true) {
      this.skipWhitespace();
      if (this.peek() !== 0x22) throw err("JCS_KEY_NOT_STRING", `expected string key at position ${this.pos}`);
      const key = this.parseString();
      if (seenKeys.has(key)) throw err("JCS_DUPLICATE_KEY", `duplicate key ${JSON.stringify(key)}`);
      seenKeys.add(key);
      this.skipWhitespace();
      this.expect(0x3a);
      out[key] = this.parseValue();
      this.skipWhitespace();
      const next = this.peek();
      if (next === 0x2c) {
        this.pos++;
        continue;
      }
      if (next === 0x7d) {
        this.pos++;
        return out;
      }
      throw err("JCS_EXPECTED_COMMA_OR_BRACE", `expected ',' or '}' at position ${this.pos}`);
    }
  }

  private parseArray(): JcsValue[] {
    this.expect(0x5b);
    const out: JcsValue[] = [];
    this.skipWhitespace();
    if (this.peek() === 0x5d) {
      this.pos++;
      return out;
    }
    while (true) {
      out.push(this.parseValue());
      this.skipWhitespace();
      const next = this.peek();
      if (next === 0x2c) {
        this.pos++;
        continue;
      }
      if (next === 0x5d) {
        this.pos++;
        return out;
      }
      throw err("JCS_EXPECTED_COMMA_OR_BRACKET", `expected ',' or ']' at position ${this.pos}`);
    }
  }

  private parseString(): string {
    this.expect(0x22);
    let result = "";
    while (true) {
      if (this.pos >= this.src.length) throw err("JCS_STRING_UNTERMINATED", "unterminated string");
      const c = this.src.charCodeAt(this.pos);
      if (c === 0x22) {
        this.pos++;
        return result;
      }
      if (c === 0x5c) {
        this.pos++;
        if (this.pos >= this.src.length) throw err("JCS_BAD_ESCAPE", "trailing backslash in string");
        const esc = this.src.charCodeAt(this.pos++);
        switch (esc) {
          case 0x22: result += '"'; break;
          case 0x5c: result += "\\"; break;
          case 0x2f: result += "/"; break;
          case 0x62: result += "\b"; break;
          case 0x66: result += "\f"; break;
          case 0x6e: result += "\n"; break;
          case 0x72: result += "\r"; break;
          case 0x74: result += "\t"; break;
          case 0x75: {
            if (this.pos + 4 > this.src.length) throw err("JCS_BAD_UNICODE_ESCAPE", "truncated \\u escape");
            const hex = this.src.slice(this.pos, this.pos + 4);
            this.pos += 4;
            const code = Number.parseInt(hex, 16);
            if (!Number.isInteger(code) || code < 0 || code > 0xffff || !/^[0-9a-fA-F]{4}$/.test(hex)) {
              throw err("JCS_BAD_UNICODE_ESCAPE", `invalid \\u escape: \\u${hex}`);
            }
            if (code >= 0xd800 && code <= 0xdfff) {
              throw err("JCS_SURROGATE_ESCAPE", `surrogate \\u escape forbidden in canonical JSON: \\u${hex}`);
            }
            result += String.fromCharCode(code);
            break;
          }
          default:
            throw err("JCS_BAD_ESCAPE", `invalid escape \\${String.fromCharCode(esc)}`);
        }
        continue;
      }
      if (c < 0x20) {
        throw err("JCS_CONTROL_IN_STRING", `unescaped control character U+${c.toString(16).padStart(4, "0")}`);
      }
      if (c >= 0xd800 && c <= 0xdfff) {
        if (c >= 0xd800 && c <= 0xdbff && this.pos + 1 < this.src.length) {
          const next = this.src.charCodeAt(this.pos + 1);
          if (next >= 0xdc00 && next <= 0xdfff) {
            result += this.src[this.pos]! + this.src[this.pos + 1]!;
            this.pos += 2;
            continue;
          }
        }
        throw err("JCS_LONE_SURROGATE", `lone surrogate in string input`);
      }
      result += this.src[this.pos]!;
      this.pos++;
    }
  }

  private parseNumber(): bigint {
    const start = this.pos;
    if (this.peek() === 0x2d) this.pos++;
    const intStart = this.pos;
    if (this.peek() === 0x30) {
      this.pos++;
    } else if (this.peek() !== null && this.peek()! >= 0x31 && this.peek()! <= 0x39) {
      while (this.peek() !== null && this.peek()! >= 0x30 && this.peek()! <= 0x39) this.pos++;
    } else {
      throw err("JCS_BAD_NUMBER", `invalid number at position ${start}`);
    }
    const tail = this.peek();
    if (tail === 0x2e) throw err("JCS_FRACTIONAL_FORBIDDEN", `fractional numbers are forbidden`);
    if (tail === 0x65 || tail === 0x45) throw err("JCS_EXPONENT_FORBIDDEN", `exponential notation is forbidden`);
    const text = this.src.slice(start, this.pos);
    if (text.startsWith("+")) throw err("JCS_BAD_NUMBER", `numbers must not start with '+'`);
    const digitPart = this.src.slice(intStart, this.pos);
    if (digitPart.length > 1 && digitPart.startsWith("0")) {
      throw err("JCS_LEADING_ZERO", `numbers must not have leading zeros: ${text}`);
    }
    if (text === "-0") throw err("JCS_NEGATIVE_ZERO", `'-0' is forbidden`);
    return BigInt(text);
  }

  private parseBool(): boolean {
    if (this.src.startsWith("true", this.pos)) {
      this.pos += 4;
      return true;
    }
    if (this.src.startsWith("false", this.pos)) {
      this.pos += 5;
      return false;
    }
    throw err("JCS_BAD_LITERAL", `invalid literal at position ${this.pos}`);
  }

  private parseNull(): null {
    if (this.src.startsWith("null", this.pos)) {
      this.pos += 4;
      return null;
    }
    throw err("JCS_BAD_LITERAL", `invalid literal at position ${this.pos}`);
  }

  private skipWhitespace(): void {
    while (this.pos < this.src.length) {
      const c = this.src.charCodeAt(this.pos);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) this.pos++;
      else break;
    }
  }

  private peek(): number | null {
    return this.pos < this.src.length ? this.src.charCodeAt(this.pos) : null;
  }

  private expect(charCode: number): void {
    if (this.peek() !== charCode) {
      throw err(
        "JCS_EXPECTED_CHAR",
        `expected '${String.fromCharCode(charCode)}' at position ${this.pos}, got '${this.src[this.pos] ?? "<EOF>"}'`,
      );
    }
    this.pos++;
  }
}

// ============================================================================
// Validator (Json → JcsValue)
// ============================================================================

function coerceToJcsValue(value: Json, path: string): JcsValue {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw err("JCS_NON_FINITE_NUMBER", `non-finite number at ${path}: ${value}`);
    if (!Number.isInteger(value)) throw err("JCS_FRACTIONAL_FORBIDDEN", `fractional numbers are forbidden at ${path}: ${value}`);
    if (Object.is(value, -0)) throw err("JCS_NEGATIVE_ZERO", `'-0' is forbidden at ${path}`);
    return BigInt(value);
  }
  if (typeof value === "string") {
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        if (i + 1 < value.length) {
          const next = value.charCodeAt(i + 1);
          if (next >= 0xdc00 && next <= 0xdfff) {
            i++;
            continue;
          }
        }
        throw err("JCS_LONE_SURROGATE", `lone surrogate in string at ${path}`);
      }
      if (c >= 0xdc00 && c <= 0xdfff) throw err("JCS_LONE_SURROGATE", `lone low surrogate in string at ${path}`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return (value as readonly Json[]).map((v, i) => coerceToJcsValue(v, `${path}[${i}]`));
  }
  const obj = value as { readonly [k: string]: Json };
  const out: Record<string, JcsValue> = {};
  for (const k of Object.keys(obj)) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = coerceToJcsValue(obj[k]!, `${path}.${k}`);
  }
  return out;
}

// ============================================================================
// Serializer (JcsValue → canonical bytes)
// ============================================================================

const TEXT_ENCODER = new TextEncoder();

function compareUtf8Bytes(a: string, b: string): number {
  const ab = TEXT_ENCODER.encode(a.normalize("NFC"));
  const bb = TEXT_ENCODER.encode(b.normalize("NFC"));
  const len = Math.min(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    const av = ab[i]!;
    const bv = bb[i]!;
    if (av !== bv) return av - bv;
  }
  return ab.length - bb.length;
}

function escapeString(s: string): string {
  if (s.length > 0 && s.charCodeAt(0) === 0xfeff) {
    throw err("UTF8_BOM_FORBIDDEN", "BOM at start of JSON string is forbidden");
  }
  assertAssigned(s);
  let out = '"';
  const normalized = s.normalize("NFC");
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += "\\\\";
    else if (c === 0x08) out += "\\b";
    else if (c === 0x09) out += "\\t";
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0c) out += "\\f";
    else if (c === 0x0d) out += "\\r";
    else if (c < 0x20) out += `\\u${c.toString(16).padStart(4, "0")}`;
    else out += normalized[i];
  }
  return out + '"';
}

function serialize(value: JcsValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "string") return escapeString(value);
  if (Array.isArray(value)) return `[${value.map((v) => serialize(v)).join(",")}]`;
  const obj = value as { readonly [k: string]: JcsValue };
  const keys = Object.keys(obj).slice().sort(compareUtf8Bytes);
  const parts: string[] = [];
  for (const k of keys) parts.push(`${escapeString(k)}:${serialize(obj[k]!)}`);
  return `{${parts.join(",")}}`;
}

// ============================================================================
// Public API
// ============================================================================

/** Canonical UTF-8 byte serialization of `value` under the restricted JCS profile. */
export function canonicalBytes(value: Json): Uint8Array {
  return TEXT_ENCODER.encode(serialize(coerceToJcsValue(value, "$")));
}

/** Parse a JSON string with restricted-JCS validation and return canonical bytes. */
export function canonicalizeString(json: string): Uint8Array {
  return TEXT_ENCODER.encode(serialize(new JcsParser(json).parse()));
}
