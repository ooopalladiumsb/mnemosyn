# TASK — DeepSeek (Senior Technical Executor): implement Mnemosyne D12 Live Brain

**From:** Lead Architect · **Date:** 2026-06-23 · **Project:** `projects/mnemosyne/`
**Agent:** `main` (deepseek-v4-pro) · **Plan:** `docs/PLAN-D12.md` (you are M2)

**Read first:** `docs/spec/d12-live-brain-v0.1-draft.md`; `src/agent/brain.ts` (the `Brain`/`BrainTurn`/
`MemoryDraft`/`RecalledContext`/`ContextHit` contract); `src/spine/types.ts` (the `MemoryKind` enum).

Implement **bodies and tests**, OFFLINE only. The skeleton typechecks with `[TODO_D12]` stubs. The
LIVE smoke (real DeepSeek API call) is operator-gated (PLAN M5) — NOT your job.

---

## 0. Rules of engagement
1. DO NOT change frozen contracts: `OpenAICompatBrainConfig`, `OpenAICompatBrain` (ctor + `turn`),
   `deepseekBrain` in `src/agent/openai-compat-brain.ts`. New exports/helpers OK.
2. DO NOT EDIT anything outside `src/agent/openai-compat-brain.ts` and `test/`. Zero edits to
   `src/spine/**`, `src/canonical/**`, the other `src/agent/*` files, or `scripts/`.
3. **The Brain is a pure seam:** `openai-compat-brain.ts` must import NEITHER the spine (`../spine/*`)
   NOR the key-manager — only `./brain.js` types and `../spine/types.js` for `MemoryKind`. It never
   encrypts, never holds a key, never sees ciphertext.
4. **No new runtime deps** — use the built-in `fetch` (via `config.fetchImpl ?? fetch`). No SDK.
5. **`apiKey` is secret:** never put it in a thrown error message, a log, or a returned value.
6. Determinism: tests use an injected `fetchImpl` returning canned responses — NO real network in any
   test. If a contract seems wrong, STOP and write the objection in `docs/NOTES-deepseek-D12.md`.

---

## 1. Body to implement — `OpenAICompatBrain.turn(input, context)`
Per spec §2:
- Build the system prompt (unless `config.systemPrompt`): a memory-keeping assistant that must reply
  AND decide what to remember, outputting ONLY JSON `{"reply": string, "remember":
  [{"kind","space","text","tags"?}]}`. Enumerate the allowed `MemoryKind` values and the allowed
  `spaces` (`config.spaces ?? ["default"]`).
- Render `context.hits` (decrypted prior memories: `text` + `kind` + `score`) as a readable context
  block; then the user `input`.
- `POST {baseURL}/chat/completions` via `config.fetchImpl ?? fetch`, headers `Authorization: Bearer
  {apiKey}` + `Content-Type: application/json`, body `{ model, messages, response_format: {type:
  "json_object"}, temperature?: ... }`.
- Parse `choices[0].message.content` as JSON → a `BrainTurn`:
  - validate each draft: unknown `kind` → coerce to `"fact"`; `space` not in allowed → first allowed;
    drop drafts with empty/whitespace `text`. `remember` defaults to `[]`.
  - **Safe fallback** (REQUIRED): on non-2xx, fetch throw, non-JSON content, or missing `reply` →
    return `{ reply: <the raw assistant text if any, else a short neutral notice>, remember: [] }`.
    Never throw out of `turn`; never invent memories on failure.

(Optional helper exports are fine, e.g. a `buildMessages`/`parseBrainTurn` you can unit-test directly.)

---

## 2. Required tests (`test/openai-compat-brain-d12.test.ts`) — injected `fetchImpl`, NO network
1. Well-formed: a canned 200 with `content` = valid JSON `{reply, remember:[2 drafts]}` → `turn`
   returns that exact reply + 2 `MemoryDraft`s (kind/space/text/tags preserved).
2. Empty remember: `{reply, remember:[]}` → reply + no drafts.
3. Coercion: a draft with an unknown `kind` → coerced to `"fact"`; a draft with a disallowed `space`
   → first allowed space; a draft with empty `text` → dropped.
4. Malformed JSON content → safe fallback (reply present — the raw text — , `remember: []`, no throw).
5. Non-2xx (e.g. 401/500) → safe fallback (no throw, `remember: []`); the `apiKey` does NOT appear in
   the fallback reply.
6. fetch throws (network error) → safe fallback (no throw).
7. Request shape: assert the injected fetch was called with `{baseURL}/chat/completions`, the bearer
   header, and the model — capture the request in the mock and check it.
8. **Seam (structural):** read `src/agent/openai-compat-brain.ts` and assert it imports neither
   `../spine/spine` nor `./key-manager` (only `./brain.js` + `../spine/types.js`).
9. `deepseekBrain(key)` builds an `OpenAICompatBrain` with baseURL `https://api.deepseek.com` and
   model `deepseek-v4-flash` (and `name` reflects the model).

## 2.1 Golden: NONE (a live model is non-deterministic). Do not touch `scripts/generate-vectors.ts`.

---

## 3. Acceptance gates (all green — do not report done on red)
```
npm run typecheck
npm test                 # 206 stay green + new D12, 0 fail
npm run test:conformance # 9, unchanged
npm run vectors:generate # five NORMATIVE golden, unchanged
```
Run via the npm scripts (`node:test`), NOT `bun test`. Confirm: zero edits outside
`src/agent/openai-compat-brain.ts` + `test/`; no spine/key import in the Brain; no new dep; `apiKey`
never logged/thrown.

---

## 4. NOTES (required) — `docs/NOTES-deepseek-D12.md`
The system-prompt + JSON schema you used; the parse/coercion rules; the exact safe-fallback behaviour;
how the seam + apiKey-safety tests are built. Then any objection. End with gate counts + files touched.

You do not commit, push, call any real API, or alter git history. Stay inside `projects/mnemosyne/`.
**Finish ALL deliverables (body + tests + NOTES) before reporting done.** Do not stop at a mid-run summary.
