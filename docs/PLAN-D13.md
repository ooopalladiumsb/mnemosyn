# PLAN — D13: agent backend service (control document)

**Goal.** Turn the D10 agent into a callable HTTP service — the thing the Telegram Mini App (D14)
will call. A framework-agnostic web `fetch` handler (`Request → Response`, works on Node 22 + Bun;
testable under `node:test`) over a per-vault agent registry + auth seam. Now the agent is reachable,
not just a library.

**Boundaries.** D13 is the SERVICE layer only — routing, auth seam, per-vault agent registry,
request/response. Wiring of each vault's spine/brain/embedder/keys is the injected
`createAgentForVault` factory's concern (so secrets stay there, and tests inject fakes). Real auth
(Telegram initData / TON Connect) and a persistent store are explicitly DEFERRED (D13.2 / D14).

---

## Roles
| Who | Role |
|---|---|
| **Claude** | contract (M1); accept by gates (M3); verify the live smoke (M5). |
| **DeepSeek** | implements the handler + registry + HeaderAuthenticator + `node:test` integration tests (no network, fake brain). |
| **Operator (you)** | ratify/merge; run the LIVE smoke (the service wired with real DeepSeek brain + Qwen embedder, one HTTP turn). |

## Scope split — OFFLINE vs LIVE
- **OFFLINE** (DeepSeek + Claude): `createAgentHandler`/`createAgentRegistry`/`HeaderAuthenticator`
  + integration tests that construct a `Request`, call the handler over a registry wired with a
  `ScriptedBrain` agent (no network), and assert routing/auth/turn/isolation/error-safety. **Merges.**
- **LIVE smoke** (operator-gated): bind the handler (Bun or node) with a real
  `createAgentForVault` (DeepSeek `deepseekBrain` + Qwen `OpenAICompatEmbedder` + in-memory spine +
  `LocalVaultKeyManager`), `curl POST /turn` once → a real reply + remembered memories. Recorded.

---

## Milestones
| # | Milestone | Owner | Gate / Done-when | Status |
|---|---|---|---|---|
| **M0** | Ratify framing (web `fetch` handler core + Bun-bind adapter; auth/persistence deferred) | You | confirmed via "go D13" | ☑ |
| **M1** | Contract: `docs/spec/d13-agent-server-v0.1-draft.md` + skeleton (`src/server/*`) + `docs/TASK-deepseek-D13.md` | Claude | skeleton typechecks; 246 green; committed | ☑ |
| **M2** | Offline impl: handler (routes /health,/turn; 401/400/404/500), registry (get-or-create+cache), HeaderAuthenticator + node:test integration tests | DeepSeek | stubs replaced; NOTES written | ☑ |
| **M3** | Acceptance | Claude | typecheck ✓ · `npm test` green (+D13) · conformance 9/9 · vectors stay 5 · handler routes + auth + per-vault isolation + safe errors (no key/stack leak) · NOTES reviewed | ☑ PASS (262/262) |
| **M4** | Commit + push offline | You ratify; Claude prepares | ☑ |
| **M5** | **LIVE** smoke (service + real brain/embedder) | Operator + Claude | service started, one `POST /turn` returns a real reply + remembered memories recoverable; recorded `docs/notes/` | ☐ |
| **M6** | Release `v1.3.0` (batched D12 + D12.2 + D13) | You | tag + GitHub Release | ☐ |

---

## Out of scope (later)
- Real auth: Telegram initData verification + TON Connect → Vault DID from wallet (**D14**).
- Persistent storage (sqlite/disk SpineStore), streaming/WS, rate-limit, multi-tenant quotas (D13.2).
- The Mini-App frontend (**D14**).

## Risks
- **Bun in node:test** → AVOIDED: the core handler is a pure web `fetch` function (no `Bun.serve` in
  the tested path); `serve-bun.ts` is an untested deployment binding (`declare const Bun`).
- **Secret/stack leak in 500s** → the handler returns SAFE JSON errors only; a test asserts no key /
  stack / plaintext appears in any error body.
- **Cross-vault bleed** → the registry caches per vaultDid; a test asserts two vaults keep separate
  agents + memory.
