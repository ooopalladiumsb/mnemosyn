# TASK — DeepSeek (Senior Technical Executor): implement Mnemosyne D13 Agent Backend

**From:** Lead Architect · **Date:** 2026-06-24 · **Project:** `projects/mnemosyne/`
**Agent:** `main` (deepseek-v4-pro) · **Plan:** `docs/PLAN-D13.md` (you are M2)

**Read first:** `docs/spec/d13-agent-server-v0.1-draft.md`; `src/server/handler.ts` (the contract);
`src/agent/agent.ts` (`MnemosyneAgent`, `createAgent`); `src/agent/brain.ts` (`ScriptedBrain` for
tests); `src/spine/spine.ts` + `scripts/mem-store.ts` (`MemSpineStore`/`MemCAS` for a test spine);
`src/identity/did.ts` (`isVaultDid`, `vaultDidFromPubkey`, `agentDid`, `ROOT_CAPABILITY_ID`).

Implement **bodies + tests**, OFFLINE only (no network — tests use a `ScriptedBrain`). The LIVE smoke
(real brain/embedder over HTTP) is operator-gated (PLAN M5) — NOT your job.

---

## 0. Rules of engagement
1. DO NOT change frozen contracts in `src/server/handler.ts` (`Authenticator`, `HeaderAuthenticator`,
   `AgentRegistry`, `createAgentRegistry`, `TurnResponse`, `createAgentHandler`) or
   `src/server/serve-bun.ts` (`serveBun`). New helpers OK.
2. DO NOT EDIT anything outside `src/server/**` and `test/`. Zero edits to `src/spine`, `src/agent`,
   `src/canonical`, `scripts`, etc. D13 is additive and only CONSUMES the public agent API.
3. **Framework-agnostic core:** `handler.ts` uses only web-standard `Request`/`Response` — NO
   `Bun.serve`, NO `node:http`, NO HTTP framework, no new runtime dep. (`serve-bun.ts` already binds
   Bun and is left as-is.)
4. **Safety:** a `500` (or any error) body is a SAFE CONSTANT JSON (`{"error":"internal error"}`) —
   NEVER a stack trace, an API key, plaintext, or ciphertext. Never log secrets.
5. If a contract seems wrong, STOP and write the objection in `docs/NOTES-deepseek-D13.md`.

---

## 1. Bodies to implement (`src/server/handler.ts`)
- `HeaderAuthenticator.authenticate(req)`: read `req.headers.get(this.headerName)`; return
  `{ vaultDid }` iff it is a string and `isVaultDid(...)` true; else `null`.
- `createAgentRegistry(createAgentForVault)`: keep a `Map<vaultDid, Promise<MnemosyneAgent>>`;
  `forVault` returns the cached promise or creates+caches one (factory called ONCE per vault).
- `createAgentHandler({registry, authenticator})`: return `async (req) => Response`:
  - `GET /health` → `200 {"ok":true}`.
  - `POST /turn` → `authenticate` (null → 401); parse JSON body (non-JSON or missing/empty/non-string
    `input` → 400); `agent = await registry.forVault(vaultDid)`; `r = await agent.turn(input)`;
    `200 { reply: r.reply, remembered: r.remembered.map(x => ({ objectId: x.object_id, kind: ??? })) }`.
    NOTE: `AppendReceipt` has `object_id`/`seqno` but NOT `kind`. For `kind`, either fetch it via the
    agent's vault (do NOT add spine access to the handler) OR — simpler and within the contract —
    return `kind` as the empty-safe value you can get from the receipt; if `kind` is not available
    from `TurnResult`, return `{ objectId }` and set `kind` to `""`. Document your choice in NOTES.
    (Do not reach into the spine from the handler; keep it to the agent's public result.)
  - any other path/method → `404`. A thrown error anywhere → `500` with the safe constant body.
  - all responses: `Content-Type: application/json`.

> If returning a real `kind` cleanly requires it, you MAY add a NEW optional field to the response
> shape ONLY by extending (not altering) `TurnResponse` — but prefer keeping the frozen shape and
> documenting the `kind` source. Do not change `MnemosyneAgent`/`TurnResult`.

## 2. Required tests (`test/agent-server-d13.test.ts`) — node:test, NO network
Build a real registry: `createAgentRegistry((vaultDid) => createAgent({ spine: createSpine({store:new
MemSpineStore(), storage:new MemCAS(), anchor:new LocalSigned(seed)}), brain: new ScriptedBrain(fn),
keys: new LocalVaultKeyManager(kek,"k"), vaultDid, agentDid: agentDid("claude","srv"), capabilityId:
ROOT_CAPABILITY_ID }))` and a `HeaderAuthenticator`. Then, via `new Request("http://x/…", …)` +
`handler(req)`:
1. `GET /health` → 200 `{ok:true}`.
2. `POST /turn` with a valid `x-vault-did` + `{input}` whose ScriptedBrain remembers 1 draft → 200;
   reply == the brain's reply; `remembered` has 1 `{objectId,…}`.
3. Missing/invalid `x-vault-did` → 401.
4. Missing/empty/non-string `input`, or non-JSON body → 400.
5. Unknown path or `GET /turn` → 404.
6. A registry whose agent's `turn` throws → 500 with the SAFE body (assert it contains NO "sk-",
   no stack, no plaintext).
7. **Per-vault isolation:** two vault DIDs → two separate agents (factory called twice); a memory
   written under vault A is NOT retrievable under vault B (e.g. each vault's spine has only its own
   objects).
8. **Registry caching:** two `forVault(sameVault)` calls → the factory ran once (same agent instance).
9. `HeaderAuthenticator`: valid vault DID → `{vaultDid}`; non-vault string / missing → `null`.

## 2.1 Golden: NONE. Do not touch `scripts/generate-vectors.ts`.

---

## 3. Acceptance gates (all green — do not report done on red)
```
npm run typecheck
npm test                 # 246 stay green + new D13, 0 fail
npm run test:conformance # 9, unchanged
npm run vectors:generate # five NORMATIVE golden, unchanged
```
Run via the npm scripts (`node:test`), NOT `bun test`. Confirm: zero edits outside `src/server/**` +
`test/`; the handler imports no `Bun`/`node:http`/framework; no new dep; no secret/stack in any
error body.

## 4. NOTES (required) — `docs/NOTES-deepseek-D13.md`
Routing/status-code decisions; how you got `kind` (or why `""`); registry caching; the isolation +
error-safety test construction. Then any objection. End with gate counts + files touched.

You do not commit, push, start a server, or alter git history. Stay inside `projects/mnemosyne/`.
**Finish ALL deliverables (bodies + tests + NOTES) before reporting done.** Do not stop mid-run.
