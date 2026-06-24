# D12 — live Brain smoke (PLAN-D12 M5) — PASS

**Date:** 2026-06-24 · **Brain:** `openai-compat:deepseek-v4-flash` (api.deepseek.com) · **Status:** ✅ PASS

One real `agent.turn()` against the live DeepSeek API, proving the full agent loop end-to-end with a
real LLM (not `ScriptedBrain`). Wiring: in-memory spine (`MemSpineStore`/`MemCAS`/`LocalSigned`) +
`LocalVaultKeyManager` + `deepseekBrain` + `createRecall(HashEmbedder + LocalRecallIndex)`.

## Turn 1 — converse + autonomous remember
- Input: "remember my favourite colour is teal and that I'm building Mnemosyne…"
- **Real reply:** "Hello! I've noted that teal is your favorite colour, and that you're building
  Mnemosyne. How can I help…" (a genuine model reply, not the safe fallback).
- The Brain **autonomously decided** to remember **2 facts**; the host sealed + appended them.
  Both are **recoverable byte-identical** via `recallById` + `keys.open`:
  - `[fact]` "User's favourite colour is teal."
  - `[fact]` "User is building Mnemosyne, a sovereign verifiable memory system for AI agents."
- Sovereignty held: every committed object carries `writer_did = agent:claude:smoke`,
  `vault_did = memory://vault/…`. The commitment line held — only ciphertext committed; KEK/plaintext
  never hashed.

## Turn 2 — recall → context → LLM
- Input: "What is my favourite colour?"
- recall surfaced the prior memory into context → **reply: "Your favourite colour is teal."** The
  recall→`recallById`→`keys.open`→Brain path is closed end-to-end.

## Notes
- Recall ranking used the non-semantic `HashEmbedder`; it surfaced the right memory here because the
  index is tiny (top-k returns all). Semantic ranking at scale needs a real `EmbeddingProvider`
  (**D12.2**, deferred).
- The smoke was a one-off operator script (removed after the run); the API key was read from
  `DEEPSEEK_API_KEY` and never written anywhere. The library itself ships no live call (only the
  `OpenAICompatBrain` seam + injected-fetch tests).
