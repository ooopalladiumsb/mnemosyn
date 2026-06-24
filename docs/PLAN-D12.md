# PLAN — D12: live Brain (OpenAI-compatible, DeepSeek) (control document)

**Goal.** Replace the test-only `ScriptedBrain` with a LIVE LLM Brain — the agent talks to a real
model. Provider-agnostic `OpenAICompatBrain`; default = DeepSeek `deepseek-v4-flash` via the existing
`api.deepseek.com` + `DEEPSEEK_API_KEY`. First step of the TMA arc (D12 brain → D13 backend → D14
Telegram Mini App). "Free now, premium later" is a CONFIG swap (the Brain is a seam) — no rebuild.

**Scope note.** D12 = the **Brain only**. A real `EmbeddingProvider` (semantic recall) needs a
separate embeddings provider/key and is a **fast-follow (D12.2)** — until then recall stays
`HashEmbedder` (functional, non-semantic). Not a blocker for the live-brain milestone.

---

## Roles
| Who | Role |
|---|---|
| **Claude** | contract package (M1); accept by gates (M3); verify the live smoke (M5). Low touch. |
| **DeepSeek** | implements `OpenAICompatBrain.turn` + deterministic (injected-fetch) tests, OFFLINE (M2). |
| **Operator (you)** | ratify/merge; run the LIVE smoke (real DeepSeek API call with `DEEPSEEK_API_KEY`). |

## Scope split — OFFLINE vs LIVE
- **OFFLINE** (DeepSeek + Claude): `turn` builds the prompt, calls `/chat/completions` via an
  INJECTED `fetchImpl`, parses the model's JSON `{reply, remember[]}` → `BrainTurn`; tested with
  canned responses (deterministic). **This merges.**
- **LIVE smoke** (operator-gated): one real turn against `api.deepseek.com` with the key → the agent
  produces a real reply + remembers; recorded. NOT done by DeepSeek (needs the key + network).

---

## Milestones (track here)
| # | Milestone | Owner | Gate / Done-when | Status |
|---|---|---|---|---|
| **M0** | Ratify framing (Brain = DeepSeek `deepseek-v4-flash`; JSON `{reply,remember}` protocol; embedder deferred) | You | confirmed via "go D12" | ☑ |
| **M1** | Contract: `docs/spec/d12-live-brain-v0.1-draft.md` + skeleton (`src/agent/openai-compat-brain.ts`) + `docs/TASK-deepseek-D12.md` | Claude | skeleton typechecks; 206 green; committed | ☑ |
| **M2** | Offline impl: `OpenAICompatBrain.turn` (prompt build + JSON parse + safe fallback) + injected-fetch tests | DeepSeek | stubs replaced; NOTES written | ☑ |
| **M3** | Acceptance | Claude | typecheck ✓ · `npm test` green (+D12) · conformance 9/9 · vectors stay 5 · Brain imports no spine/keys (seam) · frozen agent contracts intact · NOTES reviewed | ☑ PASS (228/228, seam clean) |
| **M4** | Commit + push offline | You ratify; Claude prepares | ☑ |
| **M5** | **LIVE** smoke vs DeepSeek API | Operator (run) + Claude (verify) | `DEEPSEEK_API_KEY` set → one real `agent.turn()` → real reply + ≥0 memories committed & recoverable → recorded in `docs/notes/` | ☐ |

Release (v1.3.0) is deferred — batch with D12.2 embedder or the D13 backend when there is a usable surface.

---

## Out of scope (later tickets)
- Real `EmbeddingProvider` / semantic recall (D12.2).
- The agent backend service / HTTP API (D13) and the Telegram Mini App (D14).
- Streaming responses, tool-calling, multi-turn summarization, rate-limit/retry policy.

## Risks
- **Model returns non-JSON / malformed** → `turn` MUST have a safe fallback (reply = raw text,
  remember = []); tested. Never throw a user turn away on a parse miss.
- **Brain leaks the commitment line** → the Brain returns plaintext drafts only; a test asserts
  `src/agent/openai-compat-brain.ts` imports neither the spine nor key-manager.
- **Key in code/logs** → `apiKey` is config; never logged; never hashed.
