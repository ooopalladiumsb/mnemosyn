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
import type { Authenticator } from "../server/handler.js";
import type { VaultDid } from "../spine/types.js";

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
  _initData: string,
  _botToken: string,
  _opts?: { maxAgeSeconds?: number; nowSeconds?: number },
): VerifiedInitData | null {
  throw new Error("[TODO_D14] verifyInitData not implemented");
}

/** Derive a stable Vault DID from a Telegram user id + a server secret (HMAC → pubkey → DID). */
export function vaultDidForTelegramUser(_userId: string, _vaultSecret: Uint8Array): VaultDid {
  throw new Error("[TODO_D14] vaultDidForTelegramUser not implemented");
}

/** An `Authenticator` (D13 seam) backed by Telegram WebApp initData → a per-Telegram-user vault. */
export class TelegramInitDataAuthenticator implements Authenticator {
  constructor(private readonly config: TelegramAuthConfig) {}

  async authenticate(_req: Request): Promise<{ vaultDid: VaultDid } | null> {
    void this.config; // body reads botToken/vaultSecret/headerName/maxAge (TASK-deepseek-D14)
    throw new Error("[TODO_D14] TelegramInitDataAuthenticator.authenticate not implemented");
  }
}
