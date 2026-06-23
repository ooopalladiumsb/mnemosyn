# PLAN — D11: TON AnchorAdapter over paradigm_terra (control document)

**Goal.** Give Mnemosyne **real on-chain anchoring**: the `vault_memory_root` settled on TON using
paradigm_terra's proven anchor-body format. Closes "L1 for real" (today `LocalSigned` is an offline
signature; the TON anchor is a stub) and is the **first live link between the two projects**.

**Discipline (non-negotiable).** Integrate at the **adapter boundary** only — Mnemosyne *replicates*
terra's anchor-body format (spec-compatible, conformance-pinned against terra's golden) and does NOT
import or fork terra's consensus-frozen (PFC-1) runtime. "Spec-compatible, not runtime-coupled."

---

## Roles

| Who | Role |
|---|---|
| **Claude (architect/reviewer)** | writes the contract package; reviews & accepts by gates; verifies the on-chain body before any "settled" ruling. Low hands-on time. |
| **DeepSeek (executor)** | implements bodies + tests + body-golden, OFFLINE, via wingman `--local`. Does the bulk. |
| **Operator (you / RootAuthority)** | ratifies framing & merges; runs the LIVE step (funded testnet wallet, key custody, broadcast). |

---

## Scope split — OFFLINE vs LIVE

- **OFFLINE core** (DeepSeek + Claude, normal ritual): deterministic anchor-body builder + a
  `TonAnchorAdapter` driven by an injected `Broadcaster` seam + body-golden + mock-broadcaster tests.
  Fully testable with zero network. **This is what merges.**
- **LIVE settlement** (Operator-gated, network): broadcast a real `vault_memory_root` to TON testnet
  and verify the on-chain body byte-matches the pinned body. NOT done by DeepSeek (no funded wallet
  in a sandbox); mirrors terra's PP-settlement discipline ("verify on-chain body before settling").

---

## Milestones (track here)

| # | Milestone | Owner | Gate / Done-when | Status |
|---|---|---|---|---|
| **M0** | Ratify framing (body-format fork + offline/live split) | You | RATIFIED: replicate + conformance | ☑ |
| **M1** | Contract package: `docs/spec/d11-ton-anchor-v0.1-draft.md` + frozen skeleton (`src/anchor-ton/`) + `docs/TASK-deepseek-D11.md` | Claude | skeleton typechecks; 192 tests still green; skeleton committed | ☑ |
| **M2** | Offline impl: `buildAnchorBody` + `TonAnchorAdapter(Broadcaster)` + body-golden + tests | DeepSeek (`--local`) | all stub bodies replaced; NOTES written | ☐ |
| **M3** | Acceptance | Claude | typecheck ✓ · `npm test` green (+D11) · conformance 9/9 · `vectors:generate` (+ body golden, deterministic) · frozen L0–D10 untouched · body conformance vs terra format · NOTES/objection reviewed | ☑ PASS (terra-body 4/4) |
| **M4** | Commit + push offline (skeleton→impl) | You ratify; Claude prepares | pushed to `ooopalladiumsb/mnemosyn` | ☑ |
| **M5** | **LIVE** testnet settlement of a real memory_root | Operator (broadcast) + Claude (verify) | SETTLED tx VGhMnVF… · on-chain body cell-hash == pinned (6fb9e8a8…) | ☑ |
| **M6** | Release `v1.2.0` + GitHub Release | You | tag + Release published | ☐ |

**Control loop:** after each milestone Claude reports the gate outcome (pass/fail + numbers); you
tick the box. M2/M3 follow the proven layer ritual; M5 is the only operator-driven, network-gated step.

---

## Out of scope for D11 (later tickets)
- Mainnet anchoring (testnet only here).
- A standing anchor daemon / scheduled re-anchoring (one-shot adapter now).
- Importing terra's CAL/governance authority for memory write-rights (that is a separate D-ticket).
- Live LLM Brain / embedder / extractor (Phase-A seams, independent of anchoring).

---

## Risks & how the plan handles them
- **Body-format drift vs terra** → conformance test pins Mnemosyne's body against terra's anchor-body
  golden (M2/M3). If terra changes its format, the conformance test fails loudly.
- **Coupling to frozen terra runtime** → forbidden; adapter replicates the format, imports nothing
  from terra. Enforced by inspection in M3.
- **Settling a wrong tx** (terra's recorded lesson) → M5 requires on-chain body byte-match BEFORE the
  "settled" ruling; Claude verifies, not the operator's word.
- **Claude bandwidth** → execution is DeepSeek's (M2); Claude touches M1 (one-time) + M3 (gated) only.
