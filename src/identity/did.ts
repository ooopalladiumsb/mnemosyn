/**
 * Identity: Vault DID (sovereign, persistent) vs Agent DID (transient writer). CONTRACT frozen by
 * architect; bodies by DeepSeek (TASK §T4). Delegation/multi-agent enforcement is L4, not L0 —
 * but `capability_id` is carried from day one (D4).
 *
 * Design choice (docs/NOTES-deepseek.md): Vault DID encodes the 32-byte authority pubkey with
 * RFC 4648 base32, LOWER-CASED alphabet `abcdefghijklmnopqrstuvwxyz234567`, NO `=` padding.
 * Lower-case keeps the DID stable under case-folding URLs; 32 bytes → exactly 52 base32 chars.
 */
import type { VaultDid, AgentDid, CapabilityId } from "../spine/types.js";

export const VAULT_DID_PREFIX = "memory://vault/";

const B32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const B32_LOOKUP: ReadonlyMap<string, number> = new Map([...B32_ALPHABET].map((c, i) => [c, i]));

function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 0x1f];
  return out;
}

function base32Decode(s: string): Uint8Array | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s) {
    const idx = B32_LOOKUP.get(ch);
    if (idx === undefined) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** Derive a Vault DID from a 32-byte authority public key: `memory://vault/<base32(pubkey)>`. */
export function vaultDidFromPubkey(authorityPubkey: Uint8Array): VaultDid {
  if (authorityPubkey.length !== 32) {
    throw new Error(`[DID_BAD_PUBKEY_LEN] authority pubkey must be 32 bytes, got ${authorityPubkey.length}`);
  }
  return VAULT_DID_PREFIX + base32Encode(authorityPubkey);
}

/** Validate a Vault DID string shape: correct prefix, base32 charset, decoded length 32. */
export function isVaultDid(s: string): s is VaultDid {
  if (!s.startsWith(VAULT_DID_PREFIX)) return false;
  const body = s.slice(VAULT_DID_PREFIX.length);
  if (body.length === 0) return false;
  const decoded = base32Decode(body);
  if (decoded === null || decoded.length !== 32) return false;
  // Canonical round-trip: reject non-canonical encodings (e.g. stray trailing chars).
  return base32Encode(decoded) === body;
}

/** Build an Agent DID, `agent:<scheme>:<id>`. scheme/id must be non-empty and contain no ':'. */
export function agentDid(scheme: string, id: string): AgentDid {
  if (scheme.length === 0 || id.length === 0) {
    throw new Error("[DID_EMPTY_AGENT_PART] agent scheme and id must be non-empty");
  }
  if (scheme.includes(":") || id.includes(":")) {
    throw new Error("[DID_COLON_IN_AGENT_PART] agent scheme/id must not contain ':'");
  }
  return `agent:${scheme}:${id}`;
}

/** The single constant root capability used in v0 (D4). Real delegation arrives at L4. */
export const ROOT_CAPABILITY_ID: CapabilityId = "cap:root";
