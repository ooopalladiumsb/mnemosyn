/**
 * D14 — Telegram Mini App auth. A `TelegramInitDataAuthenticator` (the D13 `Authenticator` seam) that
 * validates a Telegram WebApp `initData` string per Telegram's spec and maps the Telegram user to a
 * stable Vault DID. Pure crypto (`node:crypto`) → testable under `node:test` with crafted initData.
 *
 * initData validation (Telegram WebApp): `secret = HMAC_SHA256(key="WebAppData", botToken)`; then the
 * `hash` field must equal `HMAC_SHA256(secret, data_check_string)`, where `data_check_string` is the
 * other fields as `key=value` lines sorted by key and joined by `\n`. A stale `auth_date` is rejected.
 * The bot token lives server-side only — never in the frontend, a response, or a log.
 *
 * MVP vault identity (ratified, PLAN-D14 M0): the Vault DID is derived from the Telegram user id +
 * a server secret — `vaultDidFromPubkey(HMAC_SHA256(vaultSecret, "tg:" + userId))` — so each Telegram
 * user gets one stable sovereign vault. (TON Connect "wallet = Vault" is the D14.2 upgrade.)
 *
 * ARCHITECT-OWNED CONTRACT. The config/class + the exported function SIGNATURES are FROZEN; DeepSeek
 * implements the bodies (docs/TASK-deepseek-D14.md). New helpers OK.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Authenticator } from "../server/handler.js";
import type { VaultDid } from "../spine/types.js";
import { vaultDidFromPubkey } from "../identity/did.js";

/** Wiring for Telegram initData auth. `botToken`/`vaultSecret` are secrets — server-side only. */
export interface TelegramAuthConfig {
  readonly botToken: string;
  readonly vaultSecret: Uint8Array;
  /** Reject initData whose `auth_date` is older than this (default 86400 = 24h). */
  readonly maxAgeSeconds?: number;
  /** Request header carrying the raw initData string (default `x-telegram-init-data`). */
  readonly headerName?: string;
  /** For tests only: a fixed "now" (epoch seconds) to make `auth_date` checks deterministic. */
  readonly nowSeconds?: () => number;
}

/** The verified payload of a valid initData: the Telegram user id + the parsed fields. */
export interface VerifiedInitData {
  readonly userId: string;
  readonly params: URLSearchParams;
}

/**
 * Validate a raw `initData` query string against `botToken` (Telegram WebApp spec). Returns the
 * verified payload, or `null` if the hash is missing/wrong, the user is absent, or `auth_date` is
 * older than `maxAgeSeconds`. Never throws on bad input; never leaks the token.
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  opts?: { maxAgeSeconds?: number; nowSeconds?: number },
): VerifiedInitData | null {
  // Parse initData as query string
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }

  // Must have a hash field
  const hash = params.get("hash");
  if (!hash) return null;

  // Remove hash from the data_check_string
  params.delete("hash");

  // Sort remaining keys and build data_check_string
  const sortedKeys = [...params.keys()].sort();
  const dataCheckParts: string[] = [];
  for (const key of sortedKeys) {
    dataCheckParts.push(`${key}=${params.get(key)!}`);
  }
  const dataCheckString = dataCheckParts.join("\n");

  // Compute the secret key: HMAC_SHA256(key="WebAppData", data=botToken)
  const secretHmac = createHmac("sha256", "WebAppData");
  secretHmac.update(botToken);
  const secret = secretHmac.digest();

  // Compute the expected hash: HMAC_SHA256(key=secret, data=data_check_string)
  const hashHmac = createHmac("sha256", secret);
  hashHmac.update(dataCheckString);
  const computedHash = Buffer.from(hashHmac.digest()).toString("hex");

  // Constant-time comparison. timingSafeEqual throws on length mismatch, so guard length first
  // (a wrong-length hash is a reject anyway).
  const hashBuf = Buffer.from(hash, "hex");
  const computedBuf = Buffer.from(computedHash, "hex");
  if (hashBuf.length !== computedBuf.length) return null;
  if (!timingSafeEqual(hashBuf, computedBuf)) return null;

  // Must have user field with valid JSON containing id
  const userRaw = params.get("user");
  if (!userRaw) return null;
  let userObj: unknown;
  try {
    userObj = JSON.parse(userRaw);
  } catch {
    return null;
  }
  if (typeof userObj !== "object" || userObj === null) return null;
  const userId = (userObj as Record<string, unknown>).id;
  if (typeof userId !== "number" || !Number.isInteger(userId)) return null;

  // Check auth_date freshness
  const authDateRaw = params.get("auth_date");
  if (authDateRaw) {
    const maxAge = opts?.maxAgeSeconds ?? 86400;
    const now = opts?.nowSeconds ?? Math.floor(Date.now() / 1000);
    const authDate = parseInt(authDateRaw, 10);
    if (!Number.isInteger(authDate)) return null;
    if (now - authDate > maxAge) return null;
  }

  return { userId: String(userId), params };
}

/** Derive a stable Vault DID from a Telegram user id + a server secret (HMAC → pubkey → DID). */
export function vaultDidForTelegramUser(userId: string, vaultSecret: Uint8Array): VaultDid {
  const hmac = createHmac("sha256", vaultSecret);
  hmac.update("tg:" + userId);
  const digest = new Uint8Array(hmac.digest());
  return vaultDidFromPubkey(digest);
}

/** An `Authenticator` (D13 seam) backed by Telegram WebApp initData → a per-Telegram-user vault. */
export class TelegramInitDataAuthenticator implements Authenticator {
  constructor(private readonly config: TelegramAuthConfig) {}

  async authenticate(req: Request): Promise<{ vaultDid: VaultDid } | null> {
    const headerName = this.config.headerName ?? "x-telegram-init-data";
    const initData = req.headers.get(headerName);
    if (!initData) return null;

    const verified = verifyInitData(initData, this.config.botToken, {
      maxAgeSeconds: this.config.maxAgeSeconds,
      nowSeconds: this.config.nowSeconds ? this.config.nowSeconds() : undefined,
    });
    if (!verified) return null;

    const vaultDid = vaultDidForTelegramUser(verified.userId, this.config.vaultSecret);
    return { vaultDid };
  }
}
