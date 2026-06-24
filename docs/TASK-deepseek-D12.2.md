# TASK — DeepSeek (Senior Technical Executor): implement Mnemosyne D12.2 Live Embedder

**From:** Lead Architect · **Date:** 2026-06-24 · **Project:** `projects/mnemosyne/`
**Agent:** `main` (deepseek-v4-pro) · **Plan:** `docs/PLAN-D12.2.md` (you are M2)

**Read first:** `docs/spec/d12.2-live-embedder-v0.1-draft.md`; `src/recall/embedding.ts` (the
`EmbeddingProvider`/`Embedding` contract). Mirror the D12 style (`src/agent/openai-compat-brain.ts` +
`docs/NOTES-deepseek-D12.md`) — same provider-agnostic, injected-fetch, apiKey-safe pattern.

Implement **the body + tests**, OFFLINE only. The skeleton typechecks with `[TODO_D12_2]` stubs. The
LIVE smoke (real embeddings API) is operator-gated (PLAN M5) — NOT your job.

---

## 0. Rules of engagement
1. DO NOT change frozen contracts: `OpenAICompatEmbedderConfig`, `OpenAICompatEmbedder` (ctor +
   `embed`), `geminiEmbedder`, `jinaEmbedder` in `src/recall/openai-compat-embedder.ts`. New helpers OK.
2. DO NOT EDIT anything outside `src/recall/openai-compat-embedder.ts` and `test/`. Zero edits to
   `src/spine/**`, `src/canonical/**`, other `src/recall/*`, `src/agent/*`, `scripts/`.
3. **Out-of-root seam:** the file imports ONLY `./embedding.js` types — NOT the spine, key-manager,
   recall-index, or agent. Embeddings are never hashed/anchored.
4. **No new runtime deps** — built-in `fetch` via `config.fetchImpl ?? fetch`. No SDK.
5. **`apiKey` is secret:** never in a thrown message, log, or returned value.
6. Determinism: tests use an injected `fetchImpl` with canned responses — NO real network. If a
   contract seems wrong, STOP and write the objection in `docs/NOTES-deepseek-D12.2.md`.

---

## 1. Body — `OpenAICompatEmbedder.embed(text)`
Per spec §2:
- `POST {baseURL}/embeddings` via `config.fetchImpl ?? fetch`, bearer `apiKey`, body `{ model: config.model, input: text }`.
- On non-2xx OR a thrown fetch → `throw new Error("[EMBED_FAILED] <short reason, NO apiKey>")`.
- Parse JSON → `data[0].embedding` (array of numbers). Missing/empty/non-array → `[EMBED_FAILED]`.
- Build `Float32Array.from(embedding)`. If `length !== this.dimension` → `[EMBED_DIM_MISMATCH] expected
  ${this.dimension}, got ${length}`.
- Return the `Float32Array`.

---

## 2. Required tests (`test/openai-compat-embedder-d12_2.test.ts`) — injected `fetchImpl`, NO network
1. Well-formed: canned 200 `{data:[{embedding:[…N floats…]}]}` with N == dimension → a `Float32Array`
   of length N with the right values (within 1e-6).
2. Dimension mismatch: returned vector of the wrong length → throws `[EMBED_DIM_MISMATCH]`.
3. Non-2xx (401/500) → throws `[EMBED_FAILED]`; the `apiKey` is NOT in the message.
4. fetch throws (network) → `[EMBED_FAILED]`.
5. Malformed body (no `data`, empty `data`, `embedding` not an array) → `[EMBED_FAILED]`.
6. Request shape: the mock captured `{baseURL}/embeddings`, the bearer header, and `{model, input}`.
7. **Seam (structural):** read the file and assert it imports only `./embedding.js` (no spine/agent/
   recall-index/key-manager).
8. Factories: `geminiEmbedder(key)` → baseURL `https://generativelanguage.googleapis.com/v1beta/openai`,
   model `text-embedding-004`, dimension 768, `name` reflects the model; `jinaEmbedder(key)` →
   `https://api.jina.ai/v1`, `jina-embeddings-v3`, 1024. Custom model/dimension args work.

## 2.1 Golden: NONE (a live model is non-deterministic). Do not touch `scripts/generate-vectors.ts`.

---

## 3. Acceptance gates (all green — do not report done on red)
```
npm run typecheck
npm test                 # 228 stay green + new D12.2, 0 fail
npm run test:conformance # 9, unchanged
npm run vectors:generate # five NORMATIVE golden, unchanged
```
Run via the npm scripts (`node:test`), NOT `bun test`. Confirm: zero edits outside
`src/recall/openai-compat-embedder.ts` + `test/`; imports only `./embedding.js`; no new dep; `apiKey`
never logged/thrown.

---

## 4. NOTES (required) — `docs/NOTES-deepseek-D12.2.md`
The request/parse shape; the `[EMBED_DIM_MISMATCH]`/`[EMBED_FAILED]` rules; how the seam + apiKey-safety
tests are built. Then any objection. End with gate counts + files touched.

You do not commit, push, call any real API, or alter git history. Stay inside `projects/mnemosyne/`.
**Finish ALL deliverables (body + tests + NOTES) before reporting done.** Do not stop at a mid-run summary.
