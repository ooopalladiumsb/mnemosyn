/**
 * L5 Fabric — StorageAdapter conformance harness (D9). The CONTRACT every storage backend must
 * satisfy, as reusable code (so an adapter author validates offline before wiring a live node).
 *
 * Storage is content-addressed (`mem:<64hex>` ↔ bytes) and OUT OF ROOT (D2): the backend a blob
 * lives in never enters a MemoryObject or any hashed value. The harness therefore checks behaviour,
 * not values: round-trip fidelity + content-address integrity + the coded errors.
 *
 * ARCHITECT-OWNED CONTRACT. The signature below is FROZEN; DeepSeek implements the body
 * (docs/TASK-deepseek-L5.md). New exports may be added; the declared signature may not change.
 */
import type { StorageAdapter } from "../adapters/storage.js";

/** Deterministic 64-hex fixtures derived from fixed bytes. */
const FIXTURES = {
  validRef: "mem:" + "ab".repeat(32),  // 64 lowercase hex, content from 0xab repeated
  validBytes: new Uint8Array([1, 2, 3, 4]),
  altBytes: new Uint8Array([5, 6, 7, 8]),
  badPrefix: "ipfs://" + "ab".repeat(32),
  badHexLen: "mem:abc",
  badHexChar: "mem:" + "AB".repeat(32),  // uppercase
};

function fail(check: string): Error {
  return new Error(`[STORAGE_CONFORMANCE_FAIL] ${check}`);
}

/**
 * Run the StorageAdapter contract against a FRESH adapter obtained from `makeAdapter` (called once;
 * the harness assumes it starts empty). Resolves if the adapter satisfies the contract; otherwise
 * throws `[STORAGE_CONFORMANCE_FAIL] <which check>`. Checks, all on `mem:<64hex>` refs:
 *  - put then get → byte-identical; `has` is false before put, true after.
 *  - idempotent put: same ref + identical bytes is a no-op (no throw, get still byte-identical).
 *  - content-address integrity: same ref + DIFFERENT bytes throws `[CAS_CONFLICT]`.
 *  - get of an absent ref throws `[CAS_MISSING]`; `has` of an absent ref is false.
 *  - a malformed ref (missing prefix / wrong hex length) throws `[CAS_BAD_REF]` on put/get/has.
 */
export async function checkStorageAdapterConformance(
  makeAdapter: () => StorageAdapter | Promise<StorageAdapter>,
): Promise<void> {
  const adapter = await makeAdapter();

  // -- Check: has is false before put --
  if (await adapter.has(FIXTURES.validRef)) {
    throw fail("has must be false before put");
  }

  // -- Check: round-trip put/get --
  await adapter.put(FIXTURES.validRef, FIXTURES.validBytes);
  const got = await adapter.get(FIXTURES.validRef);
  if (got.length !== FIXTURES.validBytes.length || !got.every((b, i) => b === FIXTURES.validBytes[i]!)) {
    throw fail("put/get round-trip must return identical bytes");
  }

  // -- Check: has is true after put --
  if (!(await adapter.has(FIXTURES.validRef))) {
    throw fail("has must be true after put");
  }

  // -- Check: idempotent put (same ref + identical bytes = no-op) --
  await adapter.put(FIXTURES.validRef, FIXTURES.validBytes);
  const got2 = await adapter.get(FIXTURES.validRef);
  if (got2.length !== FIXTURES.validBytes.length || !got2.every((b, i) => b === FIXTURES.validBytes[i]!)) {
    throw fail("idempotent put must return identical bytes");
  }

  // -- Check: content-address integrity (same ref + different bytes → CAS_CONFLICT) --
  let conflictThrown = false;
  try {
    await adapter.put(FIXTURES.validRef, FIXTURES.altBytes);
  } catch (e: any) {
    if (e?.message?.includes("[CAS_CONFLICT]")) {
      conflictThrown = true;
    } else {
      throw fail(`content-address integrity: expected [CAS_CONFLICT], got ${e?.message}`);
    }
  }
  if (!conflictThrown) {
    throw fail("content-address integrity: must throw [CAS_CONFLICT] on different bytes for same ref");
  }

  // -- Check: get of absent ref throws CAS_MISSING --
  const absentRef = "mem:" + "cd".repeat(32);
  let missingThrown = false;
  try {
    await adapter.get(absentRef);
  } catch (e: any) {
    if (e?.message?.includes("[CAS_MISSING]")) {
      missingThrown = true;
    } else {
      throw fail(`absent get: expected [CAS_MISSING], got ${e?.message}`);
    }
  }
  if (!missingThrown) {
    throw fail("absent get: must throw [CAS_MISSING]");
  }

  // -- Check: has of absent ref is false --
  if (await adapter.has(absentRef)) {
    throw fail("has must be false for absent ref");
  }

  // -- Check: bad ref (wrong prefix) throws CAS_BAD_REF on put --
  let badPrefixThrown = false;
  try {
    await adapter.put(FIXTURES.badPrefix, FIXTURES.validBytes);
  } catch (e: any) {
    if (e?.message?.includes("[CAS_BAD_REF]")) {
      badPrefixThrown = true;
    } else {
      throw fail(`bad prefix: expected [CAS_BAD_REF], got ${e?.message}`);
    }
  }
  if (!badPrefixThrown) {
    throw fail("bad prefix: must throw [CAS_BAD_REF]");
  }

  // -- Check: bad ref (wrong hex length) throws CAS_BAD_REF on get --
  let badHexThrown = false;
  try {
    await adapter.get(FIXTURES.badHexLen);
  } catch (e: any) {
    if (e?.message?.includes("[CAS_BAD_REF]")) {
      badHexThrown = true;
    } else {
      throw fail(`bad hex length: expected [CAS_BAD_REF], got ${e?.message}`);
    }
  }
  if (!badHexThrown) {
    throw fail("bad hex length: must throw [CAS_BAD_REF]");
  }

  // -- Check: bad ref (uppercase hex) throws CAS_BAD_REF on has --
  let badCharThrown = false;
  try {
    await adapter.has(FIXTURES.badHexChar);
  } catch (e: any) {
    if (e?.message?.includes("[CAS_BAD_REF]")) {
      badCharThrown = true;
    } else {
      throw fail(`bad hex char: expected [CAS_BAD_REF], got ${e?.message}`);
    }
  }
  if (!badCharThrown) {
    throw fail("bad hex char: must throw [CAS_BAD_REF]");
  }

  // All checks passed.
}
