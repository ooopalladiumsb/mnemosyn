import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSpine, type AppendInput } from "../src/spine/spine.js";
import { LocalCAS } from "../src/adapters/storage.js";
import { LocalSigned } from "../src/adapters/anchor.js";
import { vaultDidFromPubkey, agentDid, ROOT_CAPABILITY_ID } from "../src/identity/did.js";
import type { EncMeta } from "../src/spine/types.js";
import { MemSpineStore, MemCAS } from "../scripts/mem-store.js";

const ENC: EncMeta = { alg: "AES-256-GCM", key_id: "k", nonce_b64: "AAAAAAAAAAAAAAAA", wrap_b64: "" };
const VAULT = vaultDidFromPubkey(new Uint8Array(32).fill(3));
const WRITER = agentDid("claude", "t");

function input(space: string, bytes: number[], createdAt?: bigint): AppendInput {
  return {
    vaultDid: VAULT,
    space,
    kind: space === "dialog" ? "dialog" : "code",
    ciphertext: new Uint8Array(bytes),
    enc: ENC,
    writerDid: WRITER,
    capabilityId: ROOT_CAPABILITY_ID,
    ...(createdAt !== undefined ? { createdAt } : {}),
  };
}

function freshSpine() {
  return createSpine({
    store: new MemSpineStore(),
    storage: new MemCAS(),
    anchor: new LocalSigned(new Uint8Array(32).fill(9)),
  });
}

test("append: seqno is gapless per space and prev chains correctly", async () => {
  const spine = freshSpine();
  const r0 = await spine.append(input("dialog", [1]));
  const r1 = await spine.append(input("dialog", [2]));
  assert.equal(r0.seqno, 0n);
  assert.equal(r1.seqno, 1n);
  const { obj } = await spine.recallById(VAULT, r1.object_id);
  assert.equal(obj.prev, r0.object_id);
});

test("D2: content_ref == 'mem:' + content_commit; recall returns stored ciphertext", async () => {
  const spine = freshSpine();
  const r = await spine.append(input("dialog", [9, 8, 7]));
  const { obj, ciphertext } = await spine.recallById(VAULT, r.object_id);
  assert.equal(obj.content_ref, "mem:" + obj.content_commit);
  assert.deepEqual(ciphertext, new Uint8Array([9, 8, 7]));
});

test("D2: LocalCAS stores identical bytes idempotently and rejects a collision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mnemo-cas-"));
  const cas = new LocalCAS(dir);
  const ref = "mem:" + "ab".repeat(32);
  await cas.put(ref, new Uint8Array([1, 2, 3]));
  await cas.put(ref, new Uint8Array([1, 2, 3])); // idempotent no-op
  await assert.rejects(() => cas.put(ref, new Uint8Array([4, 5, 6])), /CAS_CONFLICT/);
  assert.deepEqual(await cas.get(ref), new Uint8Array([1, 2, 3]));
});

test("AI-7: vault_memory_root is independent of created_at across an identical scenario", async () => {
  async function run(cts: bigint[]): Promise<string> {
    const spine = freshSpine();
    let last = "";
    last = (await spine.append(input("dialog", [1], cts[0]))).vault_memory_root;
    last = (await spine.append(input("code", [2], cts[1]))).vault_memory_root;
    last = (await spine.append(input("dialog", [3], cts[2]))).vault_memory_root;
    return last;
  }
  const ascending = await run([1n, 2n, 3n]);
  const descending = await run([3000n, 2000n, 1000n]);
  const none = await (async () => {
    const spine = freshSpine();
    await spine.append(input("dialog", [1]));
    await spine.append(input("code", [2]));
    return (await spine.append(input("dialog", [3]))).vault_memory_root;
  })();
  assert.equal(ascending, descending);
  assert.equal(ascending, none);
});

test("checkpoint: version is monotonic and root matches the live vault root", async () => {
  const spine = freshSpine();
  const r = await spine.append(input("dialog", [1]));
  const c0 = await spine.checkpoint(VAULT);
  const c1 = await spine.checkpoint(VAULT);
  assert.equal(c0.version, 0n);
  assert.equal(c1.version, 1n);
  assert.equal(c0.root, r.vault_memory_root); // single space, single append
  assert.ok(/^[0-9a-f]{128}$/.test(c0.proof)); // Ed25519 signature hex
});
