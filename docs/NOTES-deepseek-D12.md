# Implementation notes — DeepSeek (D12 Live Brain)

Executor notes for `docs/TASK-deepseek-D12.md`. Body and tests; no frozen contract was modified.
Every non-obvious choice is below. No objection was raised — all contracts were implementable.

## Design choices

### 1. System prompt + JSON schema design

The built-in system prompt (via exported `buildSystemPrompt(spaces)`) instructs the model:
- It is a memory-keeping assistant — must reply AND decide what to remember
- Outputs ONLY a JSON object `{"reply": string, "remember": [{"kind","space","text","tags"?}]}`
- Enumerates all 10 `MemoryKind` values as allowed: `"dialog", "code", "document", "fact", "artifact", "state", "event", "decision", "skill", "tool_call"`
- Enumerates the allowed spaces from config
- `remember` may be empty; each draft must have non-empty `text`

The prompt is minimal but complete — no personality beyond "helpful and concise." The `response_format: { type: "json_object" }` is set in the API request, which DeepSeek and most OpenAI-compat providers support.

The `systemPrompt` config override lets callers supply a custom prompt (e.g. for a different persona/domain).

### 2. Parse + coercion rules

`parseBrainTurn(content, allowedSpaces)` — exported for unit testing — does:

**JSON parse:** `JSON.parse(content)`. On parse failure: returns `{reply: rawText, remember:[]}` with the raw text truncated to 2000 chars. This keeps the model's reply visible even when the JSON wrapper is wrong.

**Shape validation:** must be a non-null object. Non-object → safe fallback.

**`reply` field:** if present and a non-empty string → used as-is. Missing/invalid → `"(model did not provide a valid reply)"` fallback.

**`remember` field:** if present and array → coercions applied per draft:
1. **Unknown kind:** if `d.kind` is not in `ALLOWED_KINDS` → coerced to `"fact"`. This is the "universal fallback" kind that any memory can be classified as.
2. **Wrong space:** if `d.space` is not in `allowedSpaces` → coerced to `allowedSpaces[0]` (first configured space). The model can't write to spaces the vault doesn't have.
3. **Empty text:** if `d.text` is empty/whitespace → draft dropped entirely. No point remembering nothing.
4. **Missing text:** if `d.text` is not a string → draft dropped.
5. **Tags:** optional string array; non-string entries filtered out; empty array → `undefined`.

**Missing `remember` field:** treated as `[]`.

### 3. Exact safe-fallback behaviour

The `turn()` method has 4 fallback paths, all returning `{reply: "...", remember:[]}` with NO throw:

| Scenario | Reply content | Notes |
|---|---|---|
| Network error (fetch throws) | `"(network error — could not reach the model)"` | Does NOT include apiKey or URL |
| Non-2xx response | `"(model API error {status}[: {snippet}])"` | Raw body truncated to 200 chars; apiKey NOT in reply |
| Non-JSON response body | Raw text (≤2000 chars) or `"(model returned non-JSON response)"` if empty | Uses the model's text output directly |
| Malformed JSON content | Raw text (≤2000 chars) or `"(no content received from model)"` if empty | Wraps raw content in fallback for visibility |
| No `reply` in parsed JSON | `"(model did not provide a valid reply)"` | `remember` also forced to `[]` |
| No choices / empty choice / no message.content | Generic neutral notice | Never fabricates memories on failure |

**Critical:** apiKey NEVER appears in any fallback reply path. The only place it's used is in the `Authorization` header — it's never concatenated into error messages.

The Brain wraps the 401/500 body snippet in the fallback reply (so the operator can diagnose), but strips the auth header.

### 4. Seam + apiKey-safety test construction

**Seam structural test:** Reads `src/agent/openai-compat-brain.ts` and asserts:
- Does NOT import `../spine/spine` or `./key-manager` (regex check)
- DOES import `./brain.js` and `../spine/types.js` (only these)

This enforces the D10 charter: Brain → plaintext in/out, never touches spine internals or KEK.

**apiKey safety:** The 401 unauthorized test creates an `OpenAICompatBrain` with `apiKey: "sk-secret-key-12345"`, triggers a 401 response, and asserts `result.reply` does NOT contain the string `"sk-secret-key"`. This proves the apiKey is not leaked into user-facing output. The apiKey only exits the Brain through the fetch `Authorization` header.

**All tests use injected `fetchImpl`** — NO real network in any test. Three mock factories:
- `mockFetchJson(jsonBody, status)` — returns JSON response, captures request
- `mockFetchText(text, status)` — returns plain text, captures request
- `mockFetchThrow()` — throws, captures request

Each captures `{url, method, headers, body}` for request-shape assertions.

### 5. Exported helpers for testability

Three functions are exported (not part of the frozen contract, but allowed as "new exports"):
- `buildSystemPrompt(spaces)` — builds the memory-aware system prompt
- `buildMessages(input, context, systemPrompt)` — builds the `{role, content}[]` array
- `parseBrainTurn(content, allowedSpaces)` — parses model JSON → `BrainTurn` with coercion + fallback

These are unit-testable in isolation, letting us verify prompt structure and parsing without mocking the full `turn()` flow.

## Objection

None. All contracts were implementable as specified. The Brain remains a pure seam (only `./brain.js` + `../spine/types.js`); the safe fallback covers all failure modes; apiKey never leaks.

## Gate results

| Gate | Result |
|------|--------|
| `npm run typecheck` | PASS — clean |
| `npm test` | PASS — 228 tests, 0 fail (206 existing + 22 new D12) |
| `npm run test:conformance` | PASS — 9 tests unchanged |
| `npm run vectors:generate` | PASS — 5 NORMATIVE golden unchanged |
| Seam (no spine/key-manager import) | PASS — verified |
| apiKey never logged/thrown | PASS — verified |
| No edits outside openai-compat-brain.ts + test/ | PASS — verified |
| No new runtime deps | PASS — `package.json` unchanged, built-in `fetch` |

## Files touched

**Implemented (1 file):**
- `src/agent/openai-compat-brain.ts` — `OpenAICompatBrain.turn()` body + `buildSystemPrompt`, `buildMessages`, `parseBrainTurn` helpers + `deepseekBrain` factory

**New tests (1 file):**
- `test/openai-compat-brain-d12.test.ts` — 22 tests covering all 9 required test groups plus bonus unit tests

**Documentation (1 file):**
- `docs/NOTES-deepseek-D12.md` — this file

**NOT modified:**
- `src/spine/**`, `src/canonical/**`, `src/agent/brain.ts`, `src/agent/key-manager.ts`, `src/agent/agent.ts`, `src/agent/index.ts` — zero edits
- `scripts/generate-vectors.ts` — unchanged
- `package.json` — no new dependencies
