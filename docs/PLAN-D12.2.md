# PLAN — D12.2: live EmbeddingProvider (OpenAI-compatible) (control document)

**Goal.** Replace the non-semantic `HashEmbedder` with a real, semantic embedder so L2 recall surfaces
the RIGHT memories at scale (today the agent works, but recall ranking is meaningless beyond a handful
of items). Provider-agnostic `OpenAICompatEmbedder` (Gemini / Jina / Qwen / any `/embeddings`).
DeepSeek's API has no embeddings → a separate free provider (Gemini or Jina free tier).

**Why now.** D12 made the agent live; recall quality is the next quality lever before the D13 backend /
D14 TMA. "Free now → premium later" is a config swap (same seam as the Brain).

---

## Roles
| Who | Role |
|---|---|
| **Claude** | contract (M1); accept by gates (M3); verify the live smoke (M5). Low touch. |
| **DeepSeek** | implements `OpenAICompatEmbedder.embed` + injected-fetch tests, OFFLINE (M2). |
| **Operator (you)** | ratify/merge; pick the embeddings provider + key (Gemini/Jina free) and run the LIVE smoke. |

## Scope split — OFFLINE vs LIVE
- **OFFLINE** (DeepSeek + Claude): `embed` POSTs `/embeddings` via an INJECTED `fetchImpl`, parses
  `data[0].embedding` → `Float32Array(dimension)`; tested with canned responses (deterministic,
  NO key, NO network). **This merges.**
- **LIVE smoke** (operator-gated): one real `embed()` against a chosen provider with the operator's
  key, wired into `createRecall` + the agent, showing semantic recall picks the relevant memory among
  several. NEEDS the operator's embeddings key (Gemini/Jina free) — not done by DeepSeek.

---

## Milestones
| # | Milestone | Owner | Gate / Done-when | Status |
|---|---|---|---|---|
| **M0** | Ratify framing (provider-agnostic `OpenAICompatEmbedder`; throw on failure; validate dimension; provider/key picked at M5) | You | confirmed via "D12.2" | ☑ |
| **M1** | Contract: `docs/spec/d12.2-live-embedder-v0.1-draft.md` + skeleton (`src/recall/openai-compat-embedder.ts`) + `docs/TASK-deepseek-D12.2.md` | Claude | skeleton typechecks; 228 green; committed | ☑ |
| **M2** | Offline impl: `embed` (POST + parse + dimension/​error handling) + injected-fetch tests | DeepSeek | stubs replaced; NOTES written | ☐ |
| **M3** | Acceptance | Claude | typecheck ✓ · `npm test` green (+D12.2) · conformance 9/9 · vectors stay 5 · embedder out-of-root (imports only `./embedding.js`) · apiKey-safe · NOTES reviewed | ☐ |
| **M4** | Commit + push offline | You ratify; Claude prepares | pushed | ☐ |
| **M5** | **LIVE** smoke (operator's embeddings key) | Operator + Claude | one real `embed()` + a recall over a few memories returns the semantically-right one; recorded `docs/notes/` | ☐ |

Release (v1.3.0) deferred — batch with D13.

## Out of scope
- Batch/streaming embeds, caching, re-embedding migrations, dimension-reduction. The D13 backend / D14 TMA.

## Risks
- **Wrong dimension vs RecallIndex** → `embed` validates length == `config.dimension`, throws
  `[EMBED_DIM_MISMATCH]`; the index must be built with the same dimension.
- **API failure mid-index** → `embed` throws `[EMBED_FAILED]`; recall/agent resilience to a failed
  index is a separate concern (noted, not in D12.2).
- **Key leak** → `apiKey` config-only, never logged/thrown; tested.
