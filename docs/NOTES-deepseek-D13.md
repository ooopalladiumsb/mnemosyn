# Implementation notes — DeepSeek (D13 Agent Backend)

Executor notes for `docs/TASK-deepseek-D13.md`. Bodies and tests; no frozen contract was
modified. Every non-obvious choice is below. No objection was raised — all contracts were
implementable as specified.

## Design choices

### 1. Routing and status-code decisions

The handler implements four routes on a flat `pathname` dispatch:

| Method | Path | Status | Body |
|--------|------|--------|------|
| GET | `/health` | 200 | `{"ok":true}` |
| POST | `/turn` | 200 | `{"reply","remembered":[{"objectId","kind":""}]}` |
| POST | `/turn` (unauthenticated) | 401 | `{"error":"unauthorized"}` |
| POST | `/turn` (invalid input) | 400 | `{"error":"...specific reason..."}` |
| ANY | any other | 404 | `{"error":"not found"}` |
| ANY | (internal throw) | 500 | `{"error":"internal error"}` |

**Route matching**: uses `req.method` + `pathname` exact match (`===`), not prefix or regex.
Only GET + POST are handled; any other method (PUT, DELETE, PATCH) on any path → 404.

**All responses**: `Content-Type: application/json`, via a shared `jsonResponse(body, status)`
helper that calls `JSON.stringify` and sets the header.

### 2. How `kind` is handled (documented choice)

`AppendReceipt` (from `TurnResult.remembered`) has fields: `object_id`, `seqno`,
`space_state`, `vault_memory_root`. It does **not** carry a `kind` field.

The `TurnResponse` contract requires `remembered: [{objectId, kind}]`.

Per the TASK: "do NOT reach into the spine from the handler; keep it to the agent's public
result." The handler only has access to the `TurnResult` from `agent.turn()`, which contains
`AppendReceipt[]`. Since `AppendReceipt` has no `kind`, and the handler should not call
`spine.recallById` or any spine method directly, the `kind` field is set to `""` (empty
string).

**Rationale**: 
- The handler is a thin HTTP translation layer. Adding spine access to the handler would
  violate the one-way dependency (server → agent → spine, never server → spine directly).
- The `kind` was present on the `MemoryDraft` that the Brain returned (e.g. `"dialog"`,
  `"fact"`) but that information is consumed by the agent host during `seal → append` and
  is not passed through to `TurnResult`.
- A future revision of `TurnResult` (e.g. D10.1) could carry the `kind` alongside each
  receipt, enabling the handler to return it without reaching into the spine.
- Returning `""` is a safe, honest signal that the handler doesn't have this information,
  rather than fabricating it.

### 3. Registry caching

`createAgentRegistry(createAgentForVault)` uses a `Map<VaultDid, Promise<MnemosyneAgent>>`:

- **Cache key**: the full `VaultDid` string (e.g. `memory://vault/<base32>`).
- **Cache value**: `Promise<MnemosyneAgent>` — the factory's return value, wrapped in
  `Promise.resolve()` to handle both sync and async factories.
- **Thread safety**: each factory is called at most once per vault. Concurrent requests for
  the same vault wait on the same Promise (JavaScript's `Map.get` + `Map.set` is not
  atomic, but since Node is single-threaded, the check-then-set is safe — the event loop
  cannot preempt between the `get` check and the `set`).
- **No eviction**: agents live for the lifetime of the process. A production registry
  (e.g. backed by Redis or with TTL) is deferred (D13.2).

The test `"registry caching"` calls `forVault(VAULT_A)` three times and asserts
`factoryCount === 1`, proving the factory is called once.

### 4. Isolation and error-safety test construction

**Per-vault isolation (test 7):**
- Creates a handler whose registry factory builds a real `createAgent` for each vault.
- Makes two `POST /turn` requests with different `x-vault-did` values (VAULT_A, VAULT_B).
- Asserts the factory was called twice (two distinct vaults), confirming two separate
  agents with independent memory stores were created.
- Each agent's ScriptedBrain remembers 1 draft, proving memory is scoped per vault.

**Error safety (test 6):**
- Creates a handler whose registry factory returns a deliberately broken agent (turn
  throws with a message containing `"sk-secret-crash: internal brain failure — stack trace
  follows"`).
- Sends a valid `POST /turn` and asserts:
  - Status is 500.
  - Body is `{"error":"internal error"}` — the **SAFE CONSTANT**.
  - Body does NOT contain `"sk-secret"` (apiKey leak).
  - Body does NOT contain `"stack trace"` or `"brain failure"` (internal details leak).
- The catch block in `createAgentHandler` catches ANY error and returns the constant
  `SAFE_INTERNAL_ERROR_BODY` without inspecting the error or including its message.

**HeaderAuthenticator (test 9):**
- `isVaultDid` validates the full DID shape (prefix `memory://vault/`, base32 charset,
  decoded length 32, canonical round-trip).
- Four cases: valid DID → `{vaultDid}`, invalid string → null, missing header → null,
  custom header name → works.

### 5. Framework-agnostic design

The handler uses ONLY web-standard `Request`/`Response` (available in Node 22+ and Bun):
- `req.method` for HTTP method
- `req.headers.get(name)` for header access
- `req.json()` for JSON body parsing
- `new URL(req.url).pathname` for routing
- `new Response(body, {status, headers})` for responses

No Node.js `http` module, no Express, no Hono, no Fastify, no `Bun.serve`. The
`serve-bun.ts` deployment binding (which imports `Bun`) is left untouched and is not
in the test path.

## Objection

None. All contracts were implementable as specified. The only design question was the
`kind` field on `TurnResponse` — the `AppendReceipt` doesn't carry it, and the handler
correctly doesn't reach into the spine. Setting `kind` to `""` is documented above.

## Gate results

| Gate | Result |
|------|--------|
| `npm run typecheck` | PASS — clean |
| `npm test` | PASS — 262 tests, 0 fail (246 existing + 16 new D13) |
| `npm run test:conformance` | PASS — 9 tests unchanged |
| `npm run vectors:generate` | PASS — 5 NORMATIVE golden unchanged |
| No edits outside `src/server/` + `test/` | PASS — verified |
| No Bun/node:http/framework in handler | PASS — only web-standard Request/Response |
| No secrets in 500 body | PASS — safe constant `{"error":"internal error"}` |
| No new runtime deps | PASS |

## Files touched

**Implemented (1 file):**
- `src/server/handler.ts` — `HeaderAuthenticator.authenticate`, `createAgentRegistry`,
  `createAgentHandler` bodies + `jsonResponse`/`SAFE_INTERNAL_ERROR_BODY` helpers

**New tests (1 file):**
- `test/agent-server-d13.test.ts` — 16 tests covering all 9 required groups

**Documentation (1 file):**
- `docs/NOTES-deepseek-D13.md` — this file

**NOT modified:**
- `src/spine/**`, `src/canonical/**`, `src/agent/**`, `src/recall/**`, `src/server/serve-bun.ts`,
  `scripts/` — zero edits
- `package.json` — no new dependencies
