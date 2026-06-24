# Mnemosyne D12 — Live Brain (OpenAI-compatible)

**Version:** v0.1-draft · **Status:** DRAFT · **Plan:** `docs/PLAN-D12.md`
**Depends on:** D10 (`Brain` seam, `BrainTurn`, `MemoryDraft`, `RecalledContext`).

The first real Brain: an `OpenAICompatBrain` that drives any OpenAI-compatible chat API. Default
wiring = DeepSeek `deepseek-v4-flash`. The Brain stays a pure seam — plaintext in, reply + plaintext
`MemoryDraft`s out; it never imports the spine, encrypts, or holds a key.

---

## 1. Provider-agnostic by config (the "free now, premium later" property)

`OpenAICompatBrainConfig = { baseURL, model, apiKey, systemPrompt?, spaces?, fetchImpl? }`. Switching
DeepSeek → Qwen → Gemini → Anthropic-compat is a config change. `deepseekBrain(apiKey, model?)` is the
default factory (`baseURL = https://api.deepseek.com`, `model = deepseek-v4-flash`). No new runtime
dep — uses the built-in `fetch` (injectable via `fetchImpl` for tests).

---

## 2. The turn protocol (structured JSON)

`turn(input, context)`:
1. **Build messages** for `POST {baseURL}/chat/completions`:
   - **system**: `config.systemPrompt` or the built-in prompt — instruct the model that it is a
     memory-keeping assistant; it must reply to the user AND decide what to remember; it MUST output
     ONLY a JSON object `{"reply": string, "remember": [{"kind": MemoryKind, "space": string, "text":
     string, "tags"?: string[]}]}`. List the allowed `MemoryKind` values (from `spine/types.ts`) and
     the allowed `spaces` (from config, default `["default"]`). `remember` may be empty.
   - **context**: the recalled prior memories (`context.hits` — already-decrypted text + kind), as a
     readable block so the model can use/extend them.
   - **user**: `input`.
   - Request `response_format: { type: "json_object" }` when supported (DeepSeek does); otherwise rely
     on the prompt.
2. **Call** via `(config.fetchImpl ?? fetch)` with `Authorization: Bearer {apiKey}`.
3. **Parse** `choices[0].message.content` as JSON → validate shape → a `BrainTurn`:
   - coerce/skip drafts with an unknown `kind` (fall back to `"fact"`) or a disallowed `space`
     (fall back to the first allowed space); drop drafts with empty `text`.
   - **Safe fallback** — on a non-2xx response, a network error, non-JSON content, or a missing
     `reply`: return `{ reply: <raw text or a brief error notice>, remember: [] }`. NEVER throw a user
     turn away on a parse miss; NEVER fabricate memories on failure.

---

## 3. Boundaries (the commitment line)
- The Brain returns PLAINTEXT drafts; the host (D10 `createAgent`) seals + commits them. The Brain
  imports neither `spine/**` nor `key-manager` and never sees a KEK or ciphertext.
- `apiKey` is config-only: never logged, never hashed, never returned.
- Non-determinism (the live model) is expected and fine — D12 has no golden; the testable surface is
  the deterministic prompt-build + JSON-parse + fallback, exercised with an injected `fetchImpl`.

---

## 4. Conformance & gates (OFFLINE)
1. `npm run typecheck` clean.
2. `npm test` — 206 stay green + new D12 tests.
3. `npm run test:conformance` unchanged; `npm run vectors:generate` stays five golden (no D12 golden).
4. **Parse/fallback (load-bearing):** with an injected `fetchImpl` returning canned bodies —
   a well-formed JSON `{reply,remember}` → the exact `BrainTurn`; malformed JSON / non-2xx / missing
   reply → the safe fallback (reply present, `remember: []`); unknown kind/space coerced per §2.
5. **Seam (structural):** `openai-compat-brain.ts` imports neither the spine nor the key-manager;
   `apiKey` never appears in any thrown message or log.
6. No new runtime deps; no new domain tag.

## 4.1 LIVE smoke (operator-gated, PLAN-D12 M5)
With `DEEPSEEK_API_KEY` set, one real `agent.turn()` (a `createAgent` over `deepseekBrain` +
`LocalVaultKeyManager` + an in-memory spine) returns a real reply and any remembered drafts are
recoverable byte-identical via `recallById` + `open`. Recorded in `docs/notes/`. Not part of the
offline merge.

---

## 5. Decision (proposed — ratify before merge)
**D12 (live Brain).** A provider-agnostic `OpenAICompatBrain` (default DeepSeek `deepseek-v4-flash`)
implementing the `Brain` seam over `/chat/completions`, returning a structured-JSON `BrainTurn` with a
mandatory safe fallback. Pure seam (no spine/keys), `apiKey` config-only, built-in `fetch` (no new
dep), no golden. A real `EmbeddingProvider` is deferred (D12.2). Migration-hard surface frozen by
D12: `OpenAICompatBrainConfig`, `OpenAICompatBrain`, `deepseekBrain`. Parse/fallback correctness (§4.4)
+ the seam boundary (§4.5) are the controlling acceptance criteria.
