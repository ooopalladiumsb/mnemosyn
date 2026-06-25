# PLAN — D13.2: persistent SpineStore (control document)

**Goal.** Make a vault's memory survive process restart. Storage (`LocalCAS`) and the anchor
(`LocalSigned({dir})`) already persist; the missing piece is a durable `SpineStore` (today only the
in-memory `MemSpineStore`). D13.2 ships `FileSpineStore` — on-disk objects + space heads — completing
the durable-vault triple (`FileSpineStore` + `LocalCAS` + `LocalSigned({dir})`). Needed before the
TMA (D14) — users expect memory to outlive a restart.

**Boundaries.** File-backed via `node:fs` — no new runtime dep, testable under `node:test` (a
`bun:sqlite` store would be Bun-only and break the gate harness). D13.2 ships the store; wiring it
into the agent backend is deployment (D14).

---

## Roles
| Who | Role |
|---|---|
| **Claude** | contract (M1); accept by gates (M3). |
| **DeepSeek** | implements `FileSpineStore` + `node:test` tests (incl. restart + MemSpineStore equivalence). |
| **Operator (you)** | ratify/merge. (No live step — this is pure local persistence.) |

## Milestones
| # | Milestone | Owner | Gate / Done-when | Status |
|---|---|---|---|---|
| **M0** | Ratify (file-backed `FileSpineStore`; faithful round-trip; hex-encoded keys) | You | confirmed via "D13.2" | ☑ |
| **M1** | Contract: `docs/spec/d13.2-persistent-store-v0.1-draft.md` + skeleton (`src/spine/file-store.ts`) + `docs/TASK-deepseek-D13.2.md` | Claude | skeleton typechecks; 262 green; committed | ☑ |
| **M2** | Offline impl: `FileSpineStore` (put/get/spaceCount/spaceHeadHash/listSpaces over `node:fs`) + tests | DeepSeek | stubs replaced; NOTES written | ☑ |
| **M3** | Acceptance | Claude | typecheck ✓ · `npm test` green (+D13.2) · conformance 9/9 · vectors stay 5 · **MemSpineStore-equivalence** (same `vault_memory_root`) · **restart** (fresh instance recovers) · NOTES reviewed | ☑ PASS (275/275) |
| **M4** | Commit + push | You ratify; Claude prepares | ☑ |

No live step, no release (fold into the next release with D14, or a patch v1.3.1 — your call later).

---

## Out of scope
- SQLite/other backends, compaction, snapshots, concurrent-writer locking, encryption-at-rest (the
  blobs are already ciphertext via the spine; object metadata is non-secret). The TMA (D14).

## Risks
- **Round-trip infidelity** → if `getObject` returns numeric fields with the wrong type/value, the
  object re-hashes to a different `object_id` and the root diverges. The MemSpineStore-equivalence
  test (same root over a scenario) + a "re-hash matches" assertion catch this. Serialize bigints
  explicitly and restore the same integer value.
- **Unsafe filenames** → `vaultDid`/`space` contain `:`/`/`/arbitrary chars → keys are hex-encoded
  from UTF-8 (bijective, always safe).
- **Partial write on crash** → out of scope for D13.2 (no fsync/journaling); note it.
