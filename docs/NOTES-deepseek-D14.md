# Implementation notes — DeepSeek (D14 Telegram Mini App)

Executor notes for `docs/TASK-deepseek-D14.md`. Bodies, tests, and `app/` deliverables.
No frozen contract was modified. No objection was raised.

## Design choices

### 1. Exact initData HMAC steps (Telegram WebApp spec)

`verifyInitData(initData, botToken, opts?)` per Telegram's [WebApp initData validation][1]:

1. **Parse**: `new URLSearchParams(initData)` — handles URL-encoded fields.
2. **Extract hash**: pull the `hash` field; if missing → `null`.
3. **Build data_check_string**: delete `hash` from params, sort remaining keys
   alphabetically, build `key=value` lines joined by `\n`.
4. **Compute secret**: `secret = HMAC_SHA256(key="WebAppData", data=botToken)`.
   Note: "WebAppData" is the HMAC KEY, botToken is the DATA. This is the inverse of
   typical HMAC usage and is explicitly documented here.
5. **Compute hash**: `expected = hex(HMAC_SHA256(key=secret, data=data_check_string))`.
6. **Compare**: `Buffer.from(hash, "hex").equals(Buffer.from(expected, "hex"))`.
   Uses `Buffer.equals()` (same length check + byte comparison). Not strictly
   constant-time at the JS level, but same-length + early-bail on length mismatch is
   sufficient for this use case.
7. **User validation**: `user` field must be present and JSON-parse to an object with a
   numeric `id` field. Missing/non-numeric → `null`.
8. **Freshness**: `auth_date` field checked against `opts.nowSeconds ?? Date.now()/1000`.
   Default `maxAgeSeconds = 86400` (24h). Missing `auth_date` → no freshness check
   (accepted). Stale → `null`.

**Key ordering**: `URLSearchParams.keys()` returns in insertion order, so we sort with
`[...params.keys()].sort()` to produce the canonical `data_check_string` format.

**Never throws**: malformed initData (e.g. invalid UTF-8) is caught by `try/catch` around
the parse, returning `null`. The bot token never appears in any return value or error.

### 2. Vault DID derivation

`vaultDidForTelegramUser(userId, vaultSecret)`:
```
digest = HMAC_SHA256(key=vaultSecret, data="tg:" + userId)
vaultDid = vaultDidFromPubkey(digest)
```

- The HMAC-SHA256 produces a 32-byte digest → valid Ed25519 public key → valid Vault DID.
- Prefix `"tg:"` domain-separates Telegram user IDs from other identity sources.
- Deterministic: same `(userId, vaultSecret)` → same vault DID every time.
- Different vaultSecret → completely different DID (different HMAC key).

### 3. CORS rules

`withCors(handler, opts)`:

- **Preflight (OPTIONS)**: returns 204. If origin is allowed, sets
  `Access-Control-Allow-Origin` to the requesting origin (or `"*"`). Always sets
  `Allow-Methods` (default `GET, POST, OPTIONS`), `Allow-Headers` (default
  `content-type, x-telegram-init-data`), and `Max-Age: 86400`.
- **Normal requests**: delegates to wrapped handler. If origin is allowed, clones the
  Response and adds `Access-Control-Allow-Origin`.
- **Disallowed origin**: no CORS header added (browser blocks the response).
- **`"*"` origin**: any origin is allowed; `Allow-Origin` set to `"*"` (not echoed).

The frontend is served from GitHub Pages (`https://ooopalladiumsb.github.io`) and the
backend from a separate HTTPS host. Without CORS headers, the browser would block
cross-origin `fetch` calls.

### 4. Frontend architecture (`app/index.html`)

- **Single HTML file** — no build step, no bundler, no npm.
- Loads `https://telegram.org/js/telegram-web-app.js` via `<script>` — the official
  Telegram WebApp SDK.
- Applies Telegram theme colors (bg, text, hint, button) from `Telegram.WebApp`.
- Chat UI: message list + text input + Send button.
- On send: reads `Telegram.WebApp.initData`, sends as `x-telegram-init-data` header.
- `BACKEND_URL` is a top-of-file const the operator edits before deploying.
- Handles 200 (renders reply), non-200 (renders error), and network errors gracefully.
- Calls `Telegram.WebApp.ready()` and `Telegram.WebApp.expand()` on startup.

### 5. Backend entry architecture (`app/server.ts`)

Runs under `bun` (uses `declare const Bun` + `serveBun` from `src/server/serve-bun.ts`).

**Per-vault agent factory:**
- `FileSpineStore(DATA_DIR/<vaultKey>)` — persistent object log per user.
- `deepseekBrain(DEEPSEEK_API_KEY)` — the live LLM Brain.
- `jinaEmbedder(EMBED_API_KEY, ...)` — optional semantic recall (Jina AI by default,
  configurable to Qwen/Gemini via env).
- `LocalVaultKeyManager(VAULT_SECRET, "vault-kek-0")` — AES-256-GCM key custody.
- `LocalSigned(ANCHOR_SEED)` — deterministic authority for checkpoints.

**Handler chain:**
```
TelegramInitDataAuthenticator(botToken, vaultSecret)
  → createAgentHandler({registry, authenticator})
    → withCors({origins: [ALLOWED_ORIGIN]})
      → serveBun({port})
```

**Config from env:** `BOT_TOKEN`, `VAULT_SECRET` (64-hex), `DEEPSEEK_API_KEY`,
`EMBED_API_KEY`, `EMBED_BASE_URL`, `EMBED_MODEL`, `EMBED_DIM`, `ALLOWED_ORIGIN`,
`DATA_DIR`, `PORT`.

### 6. Test construction

**initData builder** (`buildInitData`): in-test function that computes the correct
Telegram HMAC hash for a set of fields. Used to generate valid initData strings that
`verifyInitData` should accept. Tests tamper by changing a field value (which invalidates
the hash).

**Bot token leak test:** `JSON.stringify(VerifiedInitData)` is asserted to NOT contain
the bot token string. The `VaultDid` derived from it is also checked.

**CORS integration test:** wraps a real `createAgentHandler` (with D13's
`HeaderAuthenticator`) and verifies that `GET /health` still returns 200 with CORS
headers.

**All tests use fake timestamps** (`nowSeconds: FAKE_NOW`) for deterministic auth_date
checks.

## Objection

None. All contracts were implementable as specified.

## Gate results

| Gate | Result |
|------|--------|
| `npm run typecheck` | PASS — clean |
| `npm test` | PASS — 304 tests, 0 fail (275 existing + 29 new D14) |
| `npm run test:conformance` | PASS — 9 tests unchanged |
| `npm run vectors:generate` | PASS — 5 NORMATIVE golden unchanged |
| No edits outside `src/telegram/` + `src/server/cors.ts` + `test/` + `app/` | PASS |
| No new runtime deps | PASS — only `node:crypto`, `@ton/core` existing |
| Bot token never leaks | PASS — tested |
| `app/` deliverables present | PASS — `index.html`, `server.ts`, `README.md` |

## Files touched

**Implemented (2 files):**
- `src/telegram/init-data-auth.ts` — `verifyInitData`, `vaultDidForTelegramUser`,
  `TelegramInitDataAuthenticator`
- `src/server/cors.ts` — `withCors`

**New tests (1 file):**
- `test/telegram-d14.test.ts` — 29 tests covering initData validation, vault derivation,
  authenticator, CORS

**New `app/` deliverables (3 files):**
- `app/index.html` — static Telegram Mini App frontend
- `app/server.ts` — bun backend entry
- `app/README.md` — deploy notes

**Documentation (1 file):**
- `docs/NOTES-deepseek-D14.md` — this file

**NOT modified:**
- `src/spine/**`, `src/canonical/**`, `src/agent/**`, `src/recall/**`, `src/semantic/**`,
  `src/collective/**`, `src/crypto/**`, `src/adapters/**`, `src/fabric/**`, `src/server/handler.ts`,
  `src/server/serve-bun.ts`, `src/server/index.ts`, `scripts/` — zero edits
- `package.json` — no new dependencies
