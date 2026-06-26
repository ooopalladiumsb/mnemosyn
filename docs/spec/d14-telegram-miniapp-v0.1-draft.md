# Mnemosyne D14 — Telegram Mini App

**Version:** v0.1-draft · **Status:** DRAFT · **Plan:** `docs/PLAN-D14.md`
**Depends on:** D13 (`Authenticator` seam, `createAgentHandler`), D13.2 (`FileSpineStore`), D12/D12.2.

The end-user product: a Telegram Mini App chat over the agent backend. Static frontend on GitHub Pages
(`https://ooopalladiumsb.github.io/mnemosyn/`), dynamic backend on a separate HTTPS host, bound by
Telegram WebApp `initData` auth → a per-Telegram-user sovereign vault. Bot: **@MnemoVaultBot**.

---

## 1. Telegram initData auth (testable)
`verifyInitData(initData, botToken, {maxAgeSeconds?, nowSeconds?})` → `VerifiedInitData | null` per the
Telegram WebApp spec: `secret = HMAC_SHA256("WebAppData", botToken)`; the `hash` field must equal
`HMAC_SHA256(secret, data_check_string)` where `data_check_string` = the other fields as `key=value`
lines, sorted by key, joined with `\n`. Reject if the hash is missing/wrong, `user`/`user.id` is
absent, or `auth_date` is older than `maxAgeSeconds` (default 86400). Never throws; never leaks the token.

`vaultDidForTelegramUser(userId, vaultSecret)` = `vaultDidFromPubkey(HMAC_SHA256(vaultSecret,
"tg:"+userId))` — a stable per-user sovereign Vault DID (deterministic; same user → same vault).

`TelegramInitDataAuthenticator implements Authenticator` (D13 seam): read the raw initData from the
configured header (`x-telegram-init-data`), `verifyInitData`, and on success return
`{ vaultDid: vaultDidForTelegramUser(userId, vaultSecret) }`, else `null`. The bot token + vault secret
are config (server-side), never in a response/log.

## 2. CORS (testable)
`withCors(handler, { origins, headers?, methods? })`: answer `OPTIONS` preflight with 204 + the allow
headers; on other requests echo `Access-Control-Allow-Origin` for an allowed `Origin` (or `*`), and
add `Allow-Methods`/`Allow-Headers`. An `Origin` not in `origins` is not granted CORS headers. Needed
because the Pages frontend calls the backend cross-origin (default allowed origin
`https://ooopalladiumsb.github.io`).

## 3. Frontend (deliverable — static, GitHub Pages)
`app/index.html` (+ optional `app/main.js`): a minimal chat UI — message list + input + send. Loads the
Telegram WebApp SDK (`telegram-web-app.js`), reads `Telegram.WebApp.initData`, and on send `POST`s
`${BACKEND_URL}/turn` with header `x-telegram-init-data: <initData>` + body `{input}`, then renders
`reply`. `BACKEND_URL` is configurable (a top-of-file const / `window` global the operator sets).
Self-contained static files (no build step) so the operator can publish them to GitHub Pages. NOTE:
the live Mini App only works inside Telegram (initData is empty in a plain browser) — local/manual
checks aside, the in-app test is operator-run (M6).

## 4. Backend entry (deliverable — deployment glue)
`app/server.ts` (run under `bun`): wire `createAgentHandler({ registry, authenticator })` where
`authenticator = new TelegramInitDataAuthenticator(...)` and `registry` builds per-vault agents
(`deepseekBrain` + Qwen `OpenAICompatEmbedder` + `FileSpineStore(DATA_DIR)` + `LocalVaultKeyManager`),
wrap with `withCors`, and `serveBun` it. Reads config from env: `BOT_TOKEN`, `VAULT_SECRET`,
`DEEPSEEK_API_KEY`, `QWEN_API_KEY` (+ baseURL/model), `ALLOWED_ORIGIN`, `DATA_DIR`, `PORT`. Not a
`node:test` gate (needs bun + live keys); locally smoke-checkable.

## 5. Conformance & gates (OFFLINE)
1. `npm run typecheck` clean.
2. `npm test` — 275 stay green + new D14 tests.
3. `npm run test:conformance` unchanged; `npm run vectors:generate` stays five golden.
4. **initData validation (load-bearing):** a correctly-signed initData (built in-test with a known bot
   token) → `verifyInitData` returns the user; a tampered field / wrong hash / wrong bot token / a
   stale `auth_date` / missing user → `null`. `vaultDidForTelegramUser` is deterministic and
   `isVaultDid`-valid; different users → different vaults. The `TelegramInitDataAuthenticator` over a
   `Request` with the header behaves the same; the bot token never appears in any output.
5. **CORS:** `OPTIONS` → 204 with allow headers; an allowed `Origin` gets `Allow-Origin`; a disallowed
   one does not; the wrapped handler still serves `GET`/`POST` normally.
6. No new runtime deps; no new domain tag; bot token / vault secret never logged or returned.

## 5.1 Operator + LIVE (PLAN M5/M6, NOT offline)
M5: publish `app/` to GitHub Pages; run `app/server.ts` on a public HTTPS host (cloudflared/VPS) with
the env keys; register the Mini-App URL (the Pages URL) + the backend in @BotFather; set `BACKEND_URL`.
M6: open @MnemoVaultBot's Mini App in Telegram → chat → real reply → memory persists across a backend
restart (D13.2). Recorded in `docs/notes/`.

## 6. Decision (proposed — ratify before merge)
**D14 (Telegram Mini App).** A `TelegramInitDataAuthenticator` (D13 seam; validates WebApp initData,
derives a per-user vault from the Telegram id + a server secret) + a `withCors` wrapper, plus a static
Mini-App frontend (`app/`, GitHub Pages) and a `bun` backend entry (`app/server.ts`) wiring the agent
backend behind Telegram auth + CORS + `FileSpineStore`. MVP vault = Telegram id (TON Connect wallet =
D14.2). No new deps; secrets server-side only. Migration-hard surface frozen by D14: `TelegramAuthConfig`,
`VerifiedInitData`, `verifyInitData`, `vaultDidForTelegramUser`, `TelegramInitDataAuthenticator`,
`CorsOptions`, `withCors`. initData-validation correctness (§5.4) is the controlling acceptance criterion.
