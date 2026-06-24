# TASK — DeepSeek (Senior Technical Executor): implement Mnemosyne D13.2 Persistent SpineStore

**From:** Lead Architect · **Date:** 2026-06-24 · **Project:** `projects/mnemosyne/`
**Agent:** `main` (deepseek-v4-pro) · **Plan:** `docs/PLAN-D13.2.md` (you are M2)

**Read first:** `docs/spec/d13.2-persistent-store-v0.1-draft.md`; `src/spine/file-store.ts` (the
contract); `src/spine/spine.ts` (`SpineStore`, `createSpine`); `src/spine/object.ts` (`memoryObjectId`);
`src/spine/types.ts` (`MemoryObject`, `ZERO_HASH_HEX`); `scripts/mem-store.ts` (`MemSpineStore` — the
in-memory behaviour to MATCH); `scripts/spine-scenario.ts` (a scenario to reuse for equivalence).

Implement **the bodies + tests**, OFFLINE (pure local fs, no network). No live step.

---

## 0. Rules of engagement
1. DO NOT change frozen contracts: the `FileSpineStore` class + method signatures in
   `src/spine/file-store.ts`. New private helpers OK.
2. DO NOT EDIT anything outside `src/spine/file-store.ts` and `test/`. Zero edits to other `src/spine/*`,
   `src/canonical`, `src/agent`, `scripts`, etc.
3. **No new runtime deps** — `node:fs`/`node:fs/promises` + `node:path` only.
4. **Faithful round-trip:** `getObject` MUST return an object that re-hashes to the SAME `object_id`
   (`memoryObjectId`) as when stored. Serialize `bigint` integer fields (`seqno`, optional
   `created_at`) as decimal strings (or another documented scheme) and restore them as the SAME
   integer value; `spaceCount` returns a `bigint`. (The MemSpineStore-equivalence test enforces this.)
5. If a contract seems wrong, STOP and write the objection in `docs/NOTES-deepseek-D13.2.md`.

---

## 1. Bodies — `FileSpineStore` (per spec §2/§3)
- Keys: `vaultKey`/`spaceKey` = lowercase hex of UTF-8 bytes of the vault DID / space string.
- `putObject(obj)`: `id = memoryObjectId(obj)`; `mkdir -p <root>/<vaultKey>/objects` and `.../spaces`;
  write `<root>/<vaultKey>/objects/<id>.json` = the serialized object (idempotent — if it exists with
  the same content, no-op); read-or-init the space file `<root>/<vaultKey>/spaces/<spaceKey>.json`,
  set `head = id`, `count = prevCount + 1`, write it. (Use the obj's own `vault_did`/`space`.)
- `getObject(vaultDid, objectId)`: read+deserialize `<root>/<vaultKey>/objects/<objectId>.json`;
  missing → `null`. The returned object must satisfy `memoryObjectId(result) === objectId`.
- `spaceCount(vaultDid, space)`: the space file's `count` as a `bigint`; missing → `0n`.
- `spaceHeadHash(vaultDid, space)`: the space file's `head`; missing → `ZERO_HASH_HEX`.
- `listSpaces(vaultDid)`: read `<root>/<vaultKey>/spaces/`, decode each `spaceKey` (hex→UTF-8) →
  the distinct space strings; missing dir → `[]`.

## 2. Required tests (`test/file-store-d13_2.test.ts`) — node:test, `node:fs.mkdtemp` temp dirs (clean up)
1. Store ops: `putObject` then `getObject` returns an equal object AND `memoryObjectId(result)`
   equals the stored id; `getObject` of an absent id → `null`; `spaceCount`/`spaceHeadHash` of an
   empty space → `0n`/`ZERO_HASH_HEX`; after N appends `spaceCount` == N and `spaceHeadHash` == the
   last id; `listSpaces` returns the distinct spaces.
2. Idempotent put: storing the same object twice does not double the count.
3. Filesystem-safe keys: a vault DID (`memory://vault/…` with `:` and `/`) and a space containing a
   `/` or a unicode char round-trip correctly (`listSpaces` returns the exact space string).
4. **MemSpineStore equivalence (load-bearing):** run the SAME sequence of `spine.append` over
   `createSpine({store:new FileSpineStore(tmp), storage:new MemCAS(), anchor:new LocalSigned(seed)})`
   and over `MemSpineStore`; assert the final `vault_memory_root`, every `object_id`, and the
   `space_state`s are byte-identical. (Reuse `scripts/spine-scenario.ts` helpers or build a small
   multi-space scenario.)
5. **Restart recovery:** after appends on `FileSpineStore(dir)`, construct a FRESH
   `FileSpineStore(dir)`; assert `getObject`/`spaceCount`/`spaceHeadHash`/`listSpaces` match, and a
   spine over the fresh store recomputes the same `vault_memory_root` (e.g. via `checkpoint`/root).

## 2.1 Golden: NONE. Do not touch `scripts/generate-vectors.ts`.

---

## 3. Acceptance gates (all green — do not report done on red)
```
npm run typecheck
npm test                 # 262 stay green + new D13.2, 0 fail
npm run test:conformance # 9, unchanged
npm run vectors:generate # five NORMATIVE golden, unchanged
```
Run via the npm scripts (`node:test`), NOT `bun test`. Confirm: zero edits outside
`src/spine/file-store.ts` + `test/`; only `node:fs`/`node:path`; no new dep.

## 4. NOTES (required) — `docs/NOTES-deepseek-D13.2.md`
The on-disk layout + key encoding; the bigint serialization scheme (and why it preserves `object_id`);
how the equivalence + restart tests are built; the crash/concurrency caveats (out of scope). Then any
objection. End with gate counts + files touched.

You do not commit, push, or alter git history. Stay inside `projects/mnemosyne/`.
**Finish ALL deliverables (bodies + tests + NOTES) before reporting done.** Do not stop mid-run.
