# Mnemosyne D13 — Agent Backend Service

**Version:** v0.1-draft · **Status:** DRAFT · **Plan:** `docs/PLAN-D13.md`
**Depends on:** D10 (`MnemosyneAgent`), D12/D12.2 (live brain/embedder, wired by the deployment).

The agent as a callable HTTP service — the surface the Telegram Mini App (D14) calls. A
framework-agnostic web `fetch` handler over a per-vault agent registry + an auth seam.

---

## 1. Why a web `fetch` handler (not Express/Bun-locked)
The core is `(req: Request) => Promise<Response>` using web-standard `Request`/`Response` (present in
Node 22 AND Bun). So: it is testable under the project's `node:test` harness by calling it directly
(no server bound, no Bun, no network), and it binds to `Bun.serve` (or any runtime) for deployment in
one line (`serve-bun.ts`). No HTTP framework dependency; no new runtime dep.

## 2. Routes
- `GET /health` → `200 {"ok": true}`.
- `POST /turn` → authenticate → run the vault's agent:
  - body: `{ "input": string }` (JSON). Missing/empty/non-string `input` → `400 {"error":"…"}`.
  - `authenticator.authenticate(req)` → `{ vaultDid }` or `null` (→ `401 {"error":"unauthorized"}`).
  - `agent = await registry.forVault(vaultDid)`; `result = await agent.turn(input)`.
  - `200 TurnResponse { reply, remembered: [{ objectId, kind }] }` (map each `AppendReceipt` →
    `{ objectId: receipt.object_id, kind: <draft kind> }`; `objectId` only — never ciphertext/keys).
- Any other method/path → `404 {"error":"not found"}`.
- An unexpected internal throw → `500 {"error":"internal error"}` — a SAFE constant message; NEVER a
  stack trace, an API key, plaintext, or ciphertext. All responses `Content-Type: application/json`.

## 3. Registry & auth seams
```
interface AgentRegistry { forVault(vaultDid): Promise<MnemosyneAgent> }   // get-or-create + cache
createAgentRegistry(createAgentForVault): AgentRegistry
interface Authenticator { authenticate(req): Promise<{vaultDid} | null> }
class HeaderAuthenticator implements Authenticator   // dev/test: reads `x-vault-did`, validates shape
```
- `createAgentRegistry` caches by `vaultDid` (one agent per vault; `createAgentForVault` called once
  per new vault). The factory wires that vault's spine/brain/embedder/recall/keys — **all secrets live
  inside the factory**, never in the handler or a response.
- `HeaderAuthenticator` reads the `x-vault-did` header and returns it only if it `isVaultDid`-valid;
  else `null`. It is for dev/tests; production auth (Telegram initData / TON Connect) is D14.

## 4. Boundaries
- The handler never touches keys/ciphertext; it speaks only `MnemosyneAgent.turn` and returns the
  reply + object ids. Per-vault isolation is the registry's job (separate agents/memory per vault).
- `serve-bun.ts` (`serveBun(handler,{port})`) is a deployment binding, NOT in any test path.

## 5. Conformance & gates (OFFLINE)
1. `npm run typecheck` clean (incl. `serve-bun.ts` via `declare const Bun`).
2. `npm test` — 246 stay green + new D13 tests.
3. `npm run test:conformance` unchanged; `npm run vectors:generate` stays five golden.
4. **Handler (load-bearing):** with a registry wired over a real `createAgent`+`ScriptedBrain` agent
   (no network) + `HeaderAuthenticator`: `GET /health`→200; `POST /turn` with a valid vault header +
   `{input}` → 200 with the brain's reply and the remembered object ids, AND the memory is recoverable
   from that vault's spine; missing header → 401; bad/missing `input` → 400; other path → 404; an agent
   that throws → 500 with a SAFE body (assert no key/stack/plaintext in it).
5. **Per-vault isolation:** two different `x-vault-did` values get separate agents; a memory written
   under vault A is not visible under vault B.
6. No new runtime deps; no new domain tag.

## 5.1 LIVE smoke (operator-gated, PLAN M5)
Bind the handler with a real `createAgentForVault` (DeepSeek `deepseekBrain` + Qwen
`OpenAICompatEmbedder` + in-memory spine + `LocalVaultKeyManager`); start it; `curl POST /turn` once →
a real reply + remembered memories recoverable. Recorded in `docs/notes/`.

## 6. Decision (proposed — ratify before merge)
**D13 (agent backend).** A framework-agnostic web `fetch` handler (`createAgentHandler`) over a
per-vault `AgentRegistry` (`createAgentRegistry`) + an `Authenticator` seam (`HeaderAuthenticator` for
dev), routing `GET /health` + `POST /turn` with safe 401/400/404/500 JSON. Secrets live in the
injected agent factory; the handler returns only reply + object ids. A thin `serveBun` deployment
binding (untested). Real auth + persistence deferred (D14/D13.2). Migration-hard surface frozen by
D13: `Authenticator`/`HeaderAuthenticator`, `AgentRegistry`/`createAgentRegistry`, `TurnResponse`,
`createAgentHandler`, `serveBun`. Handler correctness (§5.4) + per-vault isolation (§5.5) are the
controlling acceptance criteria.
