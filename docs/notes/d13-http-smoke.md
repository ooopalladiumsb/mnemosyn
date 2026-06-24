# D13 — agent backend HTTP smoke (PLAN-D13 M5) — PASS

**Date:** 2026-06-24 · **Service:** `createAgentHandler` bound via `serveBun` (Bun.serve) · **Brain:** DeepSeek `deepseek-v4-flash` · **Status:** ✅ PASS

One real HTTP round-trip through the agent backend, proving the service works end-to-end with a live
LLM. Wiring: `createAgentRegistry((vaultDid) => createAgent(in-memory spine + deepseekBrain +
LocalVaultKeyManager + HashEmbedder recall))` + `HeaderAuthenticator`, served on `localhost:8799`.

## Results
- `GET /health` → **200** `{ ok: true }`.
- `POST /turn` (header `x-vault-did`, body `{input:"remember my project ships in Q3 and codename is
  Mnemosyne"}`) → **200**. Real reply: "Got it! I'll remember that your project ships in Q3 and your
  codename is Mnemosyne." The Brain autonomously remembered **2 facts**; both were recovered from the
  HTTP-committed objects via `spine.recallById` + `keys.open` — "Project ships in Q3", "Codename is
  Mnemosyne" — with `writer_did = agent:claude:srv`.
- `POST /turn` without the auth header → **401**.

The full path holds over HTTP: request → authenticate → per-vault agent → live LLM turn → encrypted
memory commit → recoverable. Only ciphertext is committed; the response carries reply + object ids,
never keys/plaintext.

## Notes
- One-off operator script run under `bun` (Bun.serve needs the Bun runtime), removed after. The
  DeepSeek key was read from `DEEPSEEK_API_KEY` and never persisted. The library's tested path is the
  framework-agnostic `createAgentHandler` (node:test); `serveBun` is the deployment binding.
- The embedder here is `HashEmbedder` (the real Qwen embedder is separately live-proven in
  `d12.2-live-smoke.md`); the D13 smoke validates the HTTP service + brain path.
