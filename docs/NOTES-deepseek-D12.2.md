# Implementation notes — DeepSeek (D12.2 Live Embedder)

Executor notes for `docs/TASK-deepseek-D12.2.md`. Body and tests; no frozen contract was modified.
Every non-obvious choice is below. No objection was raised — all contracts were implementable.

## Design choices

### 1. Request/parse shape

`embed(text)` follows the standard OpenAI-compatible `/embeddings` protocol:

1. **Request**: `POST {baseURL}/embeddings` with JSON body `{ model, input: text }` and
   `Authorization: Bearer {apiKey}` header. Uses `config.fetchImpl ?? fetch` so tests inject a
   mock.

2. **Parse**: `response.json()` → `data[0].embedding` (array of numbers) → `Float32Array.from(...)`.

3. **Validate**: `vec.length === this.dimension` — if not, throw `[EMBED_DIM_MISMATCH]`. This
   catches configuration errors (wrong model for the given dimension) as well as API changes.

4. **Return**: the `Float32Array` — ready for `RecallIndex.add()`.

The `name` is set as `openai-compat:{model}` in the constructor, and `dimension` is read
directly from `config.dimension` (no async lookup — the caller must know it up front, which
matches the frozen `EmbeddingProvider` contract where `dimension` is a synchronous property).

### 2. Error handling: `[EMBED_DIM_MISMATCH]` vs `[EMBED_FAILED]`

Two error categories:

| Error | Code | When |
|---|---|---|
| Dimension wrong | `[EMBED_DIM_MISMATCH]` | API returns correct-looking data but wrong vector length |
| Everything else | `[EMBED_FAILED]` | Network error, non-2xx, non-JSON body, missing/empty `data`, missing/non-array `embedding` |

The separation matters: `[EMBED_DIM_MISMATCH]` is a configuration/setup error (wrong model for
the index dimension), while `[EMBED_FAILED]` is a transient runtime error. Both are fatal to
the `embed()` call — unlike the Brain which has a safe fallback, the embedder throws. This is
by design: recall is a data operation, not a user-facing turn; embedding failure means the
entire recall context build fails, and the caller (agent host) can decide how to handle that
(e.g., fall back to no context for that turn).

**apiKey safety:** The apiKey is used only in the `Authorization` header. In `[EMBED_FAILED]`
messages, the body snippet from non-2xx responses is included (for operator diagnosis), but
the apiKey is never concatenated into any error string. The 401 test asserts this explicitly.

### 3. Factories: geminiEmbedder and jinaEmbedder

Two convenience factories (frozen contracts, already complete in the skeleton):

- **`geminiEmbedder(apiKey, model?, dimension?)`**: Gemini's OpenAI-compat endpoint at
  `https://generativelanguage.googleapis.com/v1beta/openai`. Default model `text-embedding-004`,
  default dimension 768. Free tier.

- **`jinaEmbedder(apiKey, model?, dimension?)`**: Jina AI at `https://api.jina.ai/v1`. Default
  model `jina-embeddings-v3`, default dimension 1024. Free tier.

Both accept optional `extra` for override of any other `OpenAICompatEmbedderConfig` field
(including `fetchImpl` for tests). The `name` reflects `openai-compat:{model}`.

DeepSeek's API has no embeddings endpoint, which is why the embedder is provider-separate from
the Brain's.

### 4. How the seam + apiKey-safety tests are built

**Seam structural test:** Reads `src/recall/openai-compat-embedder.ts` and asserts:
- Imports `"./embedding.js"` (confirmed)
- Does NOT import any of: `spine/`, `agent/`, `./recall-index`, `key-manager`, `canonical/`
  (all forbidden patterns checked via regex)
- This enforces the out-of-root invariant: the embedder is a pure seam that depends only on
  the `EmbeddingProvider` type contract, never on spine internals or agent plumbing.

**apiKey safety:** The 401 unauthorized test creates an embedder with `apiKey: "sk-secret-do-not-leak"`,
triggers a 401, and asserts the error message does NOT contain `"sk-secret"`. Also confirms the
message DOES contain `"401"` (useful for diagnosis) and `"EMBED_FAILED"` (correct error code).

**All tests use injected `fetchImpl`** — five mock factories:
- `mockFetchEmbed(dim, values?)` — returns valid embedding JSON
- `mockFetchStatus(status, bodyText?)` — returns non-2xx
- `mockFetchThrow()` — throws on fetch
- `mockFetchJson(body, status?)` — returns arbitrary JSON/plain-text body

Each captures `{url, method, headers, body}` for request-shape assertions.

### 5. Out-of-root property

Embeds are owner-private, derived, rebuildable — they never enter the spine or any hashed
value. The `OpenAICompatEmbedder` imports ONLY `./embedding.js` types. It does not import
the spine, key-manager, recall-index, or agent. This keeps the trust surface minimal: the
only thing the embedder needs is text → vector, and the only dependency is the
`EmbeddingProvider` contract.

## Objection

None. All contracts were implementable as specified. The `embed()` body is straightforward:
POST → parse → validate → return.

## Gate results

| Gate | Result |
|------|--------|
| `npm run typecheck` | PASS — clean |
| `npm test` | PASS — 246 tests, 0 fail (228 existing + 18 new D12.2) |
| `npm run test:conformance` | PASS — 9 tests unchanged |
| `npm run vectors:generate` | PASS — 5 NORMATIVE golden unchanged |
| Seam (only `./embedding.js` imported) | PASS — verified |
| apiKey never in error message | PASS — verified |
| No edits outside `openai-compat-embedder.ts` + `test/` | PASS — verified |
| No new runtime deps | PASS — built-in `fetch` |

## Files touched

**Implemented (1 file):**
- `src/recall/openai-compat-embedder.ts` — `OpenAICompatEmbedder.embed()` body

**New tests (1 file):**
- `test/openai-compat-embedder-d12_2.test.ts` — 18 tests covering all 8 required test groups

**Documentation (1 file):**
- `docs/NOTES-deepseek-D12.2.md` — this file

**NOT modified:**
- `src/spine/**`, `src/canonical/**`, `src/recall/embedding.ts`, `src/recall/recall-index.ts`,
  `src/recall/recall.ts`, `src/agent/*`, `scripts/` — zero edits
- `package.json` — no new dependencies
