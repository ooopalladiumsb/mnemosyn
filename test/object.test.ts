import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryObjectId, memoryObjectCanonicalBytes, metaCommit } from "../src/spine/object.js";
import { ZERO_HASH_HEX, type MemoryObject, type PublicMeta } from "../src/spine/types.js";

function baseObj(createdAt?: number | bigint): MemoryObject {
  return {
    schema_version: 1,
    vault_did: "memory://vault/abc",
    space: "dialog",
    seqno: 0n,
    kind: "dialog",
    content_commit: "11".repeat(32),
    content_ref: "mem:" + "11".repeat(32),
    enc: { alg: "AES-256-GCM", key_id: "k", nonce_b64: "AAAAAAAAAAAAAAAA", wrap_b64: "" },
    meta_commit: "22".repeat(32),
    writer_did: "agent:claude:1",
    capability_id: "cap:root",
    ...(createdAt !== undefined ? { created_at: createdAt } : {}),
    prev: ZERO_HASH_HEX,
  };
}

test("memoryObjectId is deterministic", () => {
  assert.equal(memoryObjectId(baseObj()), memoryObjectId(baseObj()));
});

test("AI-7: object_id is INDEPENDENT of created_at (opaque, not hashed)", () => {
  const idNone = memoryObjectId(baseObj());
  const idA = memoryObjectId(baseObj(1000n));
  const idB = memoryObjectId(baseObj(9999n));
  assert.equal(idA, idNone);
  assert.equal(idB, idNone);
  // canonical bytes must also be identical regardless of created_at
  assert.deepEqual(memoryObjectCanonicalBytes(baseObj(1n)), memoryObjectCanonicalBytes(baseObj(2n)));
});

test("object_id changes when a committed field changes", () => {
  const other: MemoryObject = { ...baseObj(), seqno: 1n };
  assert.notEqual(memoryObjectId(baseObj()), memoryObjectId(other));
});

test("AI-7: meta_commit is independent of created_at", () => {
  const m1: PublicMeta = { schema_version: 1, kind: "dialog", created_at: 1n, tags: ["a"] };
  const m2: PublicMeta = { schema_version: 1, kind: "dialog", created_at: 2n, tags: ["a"] };
  assert.equal(metaCommit(m1), metaCommit(m2));
});
