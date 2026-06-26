# TASK — DeepSeek (Senior Technical Executor): implement Mnemosyne D14 Telegram Mini App

**From:** Lead Architect · **Date:** 2026-06-26 · **Project:** `projects/mnemosyne/`
**Agent:** `main` (deepseek-v4-pro) · **Plan:** `docs/PLAN-D14.md` (you are M2)

**Read first:** `docs/spec/d14-telegram-miniapp-v0.1-draft.md`; `src/telegram/init-data-auth.ts` +
`src/server/cors.ts` (the contracts); `src/server/handler.ts` (`Authenticator`, `createAgentHandler`);
`src/identity/did.ts` (`vaultDidFromPubkey`, `isVaultDid`); `src/agent/*`, `src/recall/*`,
`src/spine/file-store.ts` (for the backend entry wiring). Mirror the D12/D13 style + apiKey-safety.

Implement **the testable bodies + tests** AND the **frontend + backend-entry deliverables**, OFFLINE.
The live in-Telegram test is operator-gated (PLAN M5/M6) — NOT your job.

---

## 0. Rules of engagement
1. DO NOT change frozen contracts: `TelegramAuthConfig`/`VerifiedInitData`/`verifyInitData`/
   `vaultDidForTelegramUser`/`TelegramInitDataAuthenticator` in `src/telegram/init-data-auth.ts`;
   `CorsOptions`/`withCors` in `src/server/cors.ts`. New helpers OK.
2. DO NOT EDIT outside `src/telegram/**`, `src/server/cors.ts`, `test/`, and the NEW `app/` dir. Zero
   edits to `src/spine`, `src/agent`, `src/recall`, `src/canonical`, the rest of `src/server`, `scripts`.
3. **No new runtime deps.** initData HMAC via `node:crypto`. The frontend uses only the Telegram
   WebApp SDK loaded from a `<script>` (no bundler, no npm). No new dependency in `package.json`.
4. **Secrets server-side only:** `botToken`/`vaultSecret`/api keys never appear in a response, a log,
   the frontend, or a thrown message. A test asserts the bot token never leaks.
5. Determinism: tests build initData in-test with a known bot token and compute the expected hash;
   NO real network, NO real Telegram. If a contract seems wrong, STOP → objection in
   `docs/NOTES-deepseek-D14.md`.

---

## 1. Bodies — `src/telegram/init-data-auth.ts` + `src/server/cors.ts`
- `verifyInitData(initData, botToken, opts?)`: parse `initData` as a query string; pull `hash`; build
  `data_check_string` = remaining fields as `key=value` sorted by key joined `\n`; `secret =
  HMAC_SHA256(key="WebAppData", botToken)` (HMAC with "WebAppData" as the KEY, botToken as the data —
  per Telegram spec); compare `hex(HMAC_SHA256(secret, data_check_string))` to `hash` (constant-time if
  easy). Reject (`null`) on mismatch, missing `hash`, missing `user`/`user.id`, or `auth_date` older
  than `maxAgeSeconds` (default 86400; "now" from `opts.nowSeconds` if given). Parse `user` JSON for
  the id. Never throw.
- `vaultDidForTelegramUser(userId, vaultSecret)`: `vaultDidFromPubkey(HMAC_SHA256(vaultSecret,
  "tg:"+userId))` (the HMAC digest is 32 bytes → a valid authority pubkey).
- `TelegramInitDataAuthenticator.authenticate(req)`: read header `config.headerName ??
  "x-telegram-init-data"`; `verifyInitData(...)` with the config; success → `{ vaultDid:
  vaultDidForTelegramUser(userId, config.vaultSecret) }`; else `null`.
- `withCors(handler, opts)`: if `req.method === "OPTIONS"` → `204` with `Access-Control-Allow-Origin`
  (the request `Origin` if allowed, else omit), `Allow-Methods` (`opts.methods ?? GET,POST,OPTIONS`),
  `Allow-Headers` (`opts.headers ?? content-type,x-telegram-init-data`), `Max-Age`. Otherwise call
  `handler(req)` and, if the `Origin` is allowed (`opts.origins === "*"` or includes it), add
  `Access-Control-Allow-Origin` to the response (clone with the extra header). Disallowed origin → no
  CORS header added.

## 2. Deliverables — `app/`
- `app/index.html` (+ optional `app/main.js`, `app/style.css`): a minimal, self-contained chat UI (no
  build step). Loads `https://telegram.org/js/telegram-web-app.js`; reads `Telegram.WebApp.initData`;
  a message list + text input + Send; on send `fetch(`${BACKEND_URL}/turn`, {method:"POST", headers:{
  "content-type":"application/json","x-telegram-init-data": Telegram.WebApp.initData}, body:
  JSON.stringify({input})})` → render `reply`; show errors gracefully. `BACKEND_URL` is a clearly-marked
  top-of-file const the operator edits. Call `Telegram.WebApp.ready()` / `expand()`.
- `app/server.ts` (run under `bun`): build the per-vault `createAgentRegistry((vaultDid) =>
  createAgent({ spine: createSpine({store: new FileSpineStore(DATA_DIR + "/" + <vaultKey>), storage:
  new LocalCAS(...), anchor: new LocalSigned(seed)}), brain: deepseekBrain(DEEPSEEK_API_KEY),
  embedder via OpenAICompatEmbedder(QWEN...), keys: new LocalVaultKeyManager(...), vaultDid, agentDid,
  capabilityId: ROOT_CAPABILITY_ID, recall }))`; `handler = withCors(createAgentHandler({registry,
  authenticator: new TelegramInitDataAuthenticator({botToken: env.BOT_TOKEN, vaultSecret: ...})}),
  {origins:[env.ALLOWED_ORIGIN]})`; `serveBun(handler, {port: env.PORT})`. Read all secrets/config from
  `process.env`. This is deployment glue (NOT a node:test gate); make it run and log a startup line.
- `app/README.md`: how the operator deploys — publish `app/` (the static files) to GitHub Pages, run
  `app/server.ts` on a public HTTPS host with the env vars, set `BACKEND_URL` in the frontend, register
  the Mini-App URL + backend with @BotFather.

## 3. Required tests (`test/telegram-d14.test.ts` + cors in same/sibling) — node:test, NO network
1. `verifyInitData`: build a VALID initData in-test (compute the hash with a known bot token) → returns
   the user id; flip one field (hash mismatch) → `null`; wrong bot token → `null`; stale `auth_date`
   (with `nowSeconds`) → `null`; missing `user` → `null`; the bot token is NOT in any output.
2. `vaultDidForTelegramUser`: deterministic (same id → same DID), `isVaultDid` true, different ids →
   different DIDs.
3. `TelegramInitDataAuthenticator.authenticate`: a `Request` with a valid initData header → `{vaultDid}`
   matching `vaultDidForTelegramUser`; missing/invalid header → `null`.
4. `withCors`: `OPTIONS` from an allowed origin → 204 + `Access-Control-Allow-Origin`; a normal `GET`
   `/health` through the wrapped D13 handler → 200 AND has the allow-origin header for an allowed
   origin; a disallowed origin → no allow-origin header; `"*"` allows any.

## 3.1 Golden: NONE. Do not touch `scripts/generate-vectors.ts`.

---

## 4. Acceptance gates (all green — do not report done on red)
```
npm run typecheck
npm test                 # 275 stay green + new D14, 0 fail
npm run test:conformance # 9, unchanged
npm run vectors:generate # five NORMATIVE golden, unchanged
```
Run via the npm scripts (`node:test`), NOT `bun test`. Confirm: edits only under `src/telegram/**`,
`src/server/cors.ts`, `test/`, `app/`; no new dep; no token/secret in any output. (`app/server.ts`
typechecks too — `tsc` covers `src` only, but keep `app/` valid TS; if it references Bun, use
`declare const Bun` like `src/server/serve-bun.ts`.)

## 5. NOTES (required) — `docs/NOTES-deepseek-D14.md`
The exact initData HMAC steps (key ordering!); the vault-derivation; the CORS rules; how the frontend
+ backend entry are wired and the env they read; the test construction. Then any objection. End with
gate counts + files touched.

You do not commit, push, deploy, or alter git history. Stay inside `projects/mnemosyne/`.
**Finish ALL deliverables (bodies + tests + frontend + backend entry + NOTES) before reporting done.**
Do not stop mid-run.
