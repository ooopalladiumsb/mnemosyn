# PLAN — D14: Telegram Mini App (the end-user product) (control document)

**Goal.** The interface a user actually touches: a Telegram Mini App chat over the D13 agent backend
(D12 brain + D12.2 embedder + D13.2 persistence). The user opens the bot, chats, and owns a sovereign
verifiable memory vault. Final step of the TMA arc.

**Why it's different.** Unlike D10–D13.2 (pure, offline-testable logic), D14 is a frontend + bot +
deployment. So it splits three ways: **testable code** (the Telegram-auth crypto + the bot/webhook
handler — `node:test`), **deliverables** (the Mini-App HTML/JS frontend, served + locally smoke-checked),
and **operator steps** (bot token, public HTTPS host, @BotFather registration, the live Telegram test).
DeepSeek does the code; **you** do the deployment (as you did the M5 broadcasts).

---

## Roles
| Who | Role |
|---|---|
| **Claude** | contract (M1); accept the offline code by gates (M3); verify the live test with you (M6). |
| **DeepSeek** | `TelegramInitDataAuthenticator` (+ tests), bot/webhook handler, the Mini-App frontend, the deployment-ready server wiring. |
| **Operator (you)** | @BotFather bot token; a public HTTPS host (tunnel or VPS); register the Mini App; run the live Telegram chat. |

## Scope split — OFFLINE (merges) vs OPERATOR (you, live)
- **OFFLINE / testable** (DeepSeek + Claude): `TelegramInitDataAuthenticator` (validate WebApp initData
  HMAC-SHA256 with the bot token → Telegram user → Vault DID) — pure crypto, `node:test` with crafted
  initData. Plugs into D13's `Authenticator` seam. Plus an `app` entrypoint that wires the agent
  backend (DeepSeek brain + Qwen embedder + `FileSpineStore`) behind the Telegram authenticator, and
  serves the frontend — locally smoke-checkable (`bun` serve + curl).
- **DELIVERABLES** (DeepSeek, served not unit-tested): the Mini-App frontend (`index.html` + a small
  chat UI; Telegram WebApp SDK; calls `POST /turn` with the initData header).
- **OPERATOR / live** (you): bot token, public HTTPS, @BotFather Mini-App URL, the in-Telegram chat.

### Deployment architecture (GitHub Pages = static)
Known: bot **@MnemoVaultBot**; frontend host **https://ooopalladiumsb.github.io/mnemosyn/** (GitHub
Pages, the `mnemosyn` repo). GitHub Pages is **static (HTML/JS only)** → it hosts the **frontend**, but
the **backend** (`POST /turn`, Telegram auth, brain/embedder/spine) CANNOT run there. So:
- **Frontend** (static) → GitHub Pages. Built into `app/`; the operator publishes it to the Pages
  source. It reads a configurable `BACKEND_URL` and calls `${BACKEND_URL}/turn` with the initData header.
- **Backend** (dynamic) → a SEPARATE public HTTPS host (operator's cloudflared tunnel / VPS, M5). The
  frontend calls it CROSS-ORIGIN → the backend handler is **CORS-wrapped** (`withCors`) for the Pages
  origin (`https://ooopalladiumsb.github.io`).

---

## Milestones (track here)
| # | Milestone | Owner | Gate / Done-when | Status |
|---|---|---|---|---|
| **M0** | Ratify framing (vault identity: Telegram-id vs TON-Connect wallet; MVP scope) | You | RATIFIED: Telegram-id (HMAC), TON Connect = D14.2 | ☑ |
| **M1** | Contract: `docs/spec/d14-telegram-miniapp-v0.1-draft.md` + skeleton (`src/telegram/*` + `app/` frontend stub) + `docs/TASK-deepseek-D14.md` | Claude | skeleton typechecks; 275 green; committed | ☑ |
| **M2** | Offline impl: `TelegramInitDataAuthenticator` + tests; bot/webhook handler; Mini-App frontend; deployment wiring | DeepSeek | stubs replaced; NOTES; local serve smoke green | ☐ |
| **M3** | Acceptance | Claude | typecheck ✓ · `npm test` green (+D14 auth tests) · conformance 9/9 · vectors stay 5 · initData-validation correctness (valid passes, tampered/expired/wrong-bot rejected) · no bot-token leak · local serve smoke (`/turn` through Telegram auth) · NOTES reviewed | ☐ |
| **M4** | Commit + push offline | You ratify; Claude prepares | pushed | ☐ |
| **M5** | **OPERATOR** deploy | You | @BotFather bot token; public HTTPS host (tunnel/VPS); Mini-App URL registered; webhook set | ☐ |
| **M6** | **LIVE** Telegram test | You + Claude | open the Mini App in Telegram → chat → real reply → memory persists across restart (D13.2); (TON Connect if in scope) → recorded `docs/notes/` | ☐ |
| **M7** | Release `v1.4.0` (D13.2 + D14) | You | tag + GitHub Release | ☐ |

**Control loop:** M2/M3 are the proven offline ritual; M5/M6 are operator-driven (your bot token +
host). I verify the live test with you. M0 needs your one decision below before M1.

---

## Out of scope (later)
- TEE/confidential hosting (Stage-1 hardening); push notifications; payments/monetization; multi-device
  sync; rate-limit/abuse controls; i18n. A persistent store beyond `FileSpineStore`. Streaming replies.

## Risks & how the plan handles them
- **initData spoofing** → `TelegramInitDataAuthenticator` validates the HMAC-SHA256 over the sorted
  data-check-string with `HMAC(key="WebAppData", botToken)` per Telegram's spec, and rejects a missing/
  wrong hash or a stale `auth_date`. Tested with valid + tampered + expired + wrong-bot vectors.
- **Bot-token leak** → the token lives server-side only (in the authenticator/env), never in the
  frontend or a response; a test asserts it never appears in any output.
- **HTTPS requirement** → Telegram Mini Apps + webhooks require public HTTPS; that's the operator's
  host (M5) — the code is host-agnostic (binds via Bun.serve, served behind your tunnel/VPS).
- **Claude can't test in Telegram** → the live in-app test is operator-run (M6); Claude verifies the
  offline auth + the served `/turn` path and reviews your live result.
