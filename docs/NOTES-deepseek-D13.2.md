# Implementation notes — DeepSeek (D13.2 Persistent SpineStore)

Executor notes for `docs/TASK-deepseek-D13.2.md`. Body and tests; no frozen contract was modified.
Every non-obvious choice is below. No objection was raised.

## Design choices

### 1. On-disk layout + key encoding

Under `rootDir`:
```
<root>/<vaultKey>/objects/<object_id>.json   — one immutable MemoryObject
<root>/<vaultKey>/spaces/<spaceKey>.json    — { head, count }
```

**Key encoding:** `vaultKey`/`spaceKey` = lowercase hex of UTF-8 bytes. This is bijective:
- Any vault DID (with `:`, `/`, unicode) → hex → safe filename
- `Buffer.from(s, "utf-8").toString("hex")` — Node built-in
- Recovery: `Buffer.from(hex, "hex").toString("utf-8")`
- The `listSpaces()` method reads `<vaultKey>/spaces/*.json`, strips the `.json` suffix,
  and hex-decodes the remainder to recover the original space string.

This handles DIDs containing `://`, `/vault/`, and any unicode characters. Tested with
`"café-履歴"` and `"path/like/space"`.

**Object file:** immutable — written once, never modified. Idempotency check: if
`readJsonSafe` succeeds (file exists and parses), `putObject` returns early without
updating the space file. Since `object_id` is content-addressed, same object_id = same
content (by construction).

**Space file:** JSON `{ "head": "<object_id|ZERO_HASH_HEX>", "count": "<decimal_string>" }`.
Updated on every `putObject` (increment count, set head to new object_id).

### 2. Bigint serialization scheme

`MemoryObject.seqno` is `number | bigint`. `MemoryObject.created_at` is `number | bigint | undefined`.
JSON cannot natively represent bigint values. To preserve the exact integer value through
serialization (ensuring `memoryObjectId(deserialized) === originalId`):

- **Serialization:** `BigInt(field).toString(10)` → decimal string (e.g., `"0"`, `"1"`, `"5000"`)
- **Deserialization:** `BigInt(decimalString)` → bigint

Both `number` and `bigint` values are coerced to `bigint` before serialization and
restored as `bigint` on deserialization. This is safe because:
- `memoryObjectCanonicalBytes` passes `seqno: obj.seqno` to the JCS serializer
- JCS converts all numbers to bigint internally, and serializes both as the canonical
  integer form (e.g., `0`, `1`, `5000`)
- So `BigInt(0)` and `0` (as number) produce the same canonical bytes → same `object_id`

**Space file count:** also serialized as decimal string (`"0"`, `"1"`, `"2"`), restored
as `BigInt(countString)`. `spaceCount()` returns `bigint` (matching `MemSpineStore`).

### 3. Idempotent put

`FileSpineStore.putObject` is idempotent via file existence check:
- Compute `object_id = memoryObjectId(obj)`
- If `<objectsDir>/<object_id>.json` already exists (checked via `readJsonSafe` returning
  non-null), return early — no space update.
- Otherwise, write the object file and increment the space count/head.

This is correct because `object_id` is a content hash — same content → same id → file
already exists. The MemSpineStore `putObject` also checks seqno and prev consistency,
but `FileSpineStore` does not need to — the spine computes seqno from `spaceCount` and
prev from `spaceHeadHash` before calling `putObject`, so these are always consistent with
what's on disk.

Test: `store.putObject(sameObj)` called twice — count stays at 1 (the second call is a
no-op because the file already exists).

### 4. Equivalence test construction

The load-bearing `MemSpineStore equivalence` test:
- Runs the same 6-appends, 2-space scenario (interleaved dialog+code) on a
  `createSpine({store: new FileSpineStore(tmpdir), ...})` and a
  `createSpine({store: new MemSpineStore(), ...})`
- Asserts byte-identical `vault_memory_root` and every `object_id`

This proves `FileSpineStore` is a faithful drop-in — the serialized/deserialized numerics
round-trip correctly, producing identical hashes to the in-memory reference store.

### 5. Restart recovery test

Two phases:
1. Create a spine with `FileSpineStore(dir)`, append 3 objects (dialog, code, dialog)
2. Construct a FRESH `FileSpineStore(dir)` — no shared state, pure filesystem recovery

Asserts:
- `getObject` returns each object with correct seqno (1n for second dialog append)
- `spaceCount("dialog")` = 2, `spaceCount("code")` = 1
- `spaceHeadHash` matches the last object's id
- `listSpaces` returns `["code", "dialog"]` (order-independent, sorted for comparison)
- Recovered objects re-hash to their original `object_id`
- A spine over the recovered store can compute a checkpoint

### 6. Crash/concurrency caveats (out of scope)

This is a single-process, serial-access store. No journaling, no locking, no atomic
multi-file writes. If the process crashes between writing the object file and updating
the space file, the space count will be stale (missing the object). Recovery from this
requires a future checkpoint/scan mechanism, noted but not in scope for D13.2.

Similarly, concurrent writes from multiple processes would race on the space file.
Production hardening (sqlite, LMDB, or a WAL-based approach) is deferred.

## Objection

None. All contracts were implementable as specified.

## Gate results

| Gate | Result |
|------|--------|
| `npm run typecheck` | PASS — clean |
| `npm test` | PASS — 275 tests, 0 fail (262 existing + 13 new D13.2) |
| `npm run test:conformance` | PASS — 9 tests unchanged |
| `npm run vectors:generate` | PASS — 5 NORMATIVE golden unchanged |
| No edits outside `src/spine/file-store.ts` + `test/` | PASS — verified |
| Only `node:fs`/`node:path` | PASS — no new deps |
| Faithful round-trip | PASS — `memoryObjectId(getObject(id)) === id` |
| MemSpineStore equivalence | PASS — byte-identical vault_memory_root + object_ids |
| Restart recovery | PASS — fresh instance sees all prior state |

## Files touched

**Implemented (1 file):**
- `src/spine/file-store.ts` — `FileSpineStore` full body (putObject, getObject, spaceCount,
  spaceHeadHash, listSpaces) + serialization/deserialization helpers + hex key encoding

**New tests (1 file):**
- `test/file-store-d13_2.test.ts` — 13 tests covering store ops, idempotent put, fs-safe
  keys (unicode + path-like), MemSpineStore equivalence, restart recovery

**Documentation (1 file):**
- `docs/NOTES-deepseek-D13.2.md` — this file

**NOT modified:**
- `src/spine/spine.ts`, `src/spine/object.ts`, `src/spine/space.ts`, `src/spine/types.ts`,
  `src/spine/vault.ts`, `src/spine/index.ts` — zero edits
- `src/canonical/**`, `src/agent/**`, `scripts/` — zero edits
- `package.json` — no new dependencies
