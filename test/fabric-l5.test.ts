/**
 * L5 Fabric tests (TASK-deepseek-L5 §2).
 *
 * Covers: harness passes for reference adapters, harness rejects broken adapters,
 * MemoryCAS direct tests, FabricStorage replication/failover/locate,
 * out-of-root equivalence (LocalCAS vs FabricStorage), network seams throw.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalCAS } from "../src/adapters/storage.js";
import { MemoryCAS } from "../src/fabric/memory-cas.js";
import { createFabricStorage, type FabricStorage } from "../src/fabric/fabric-storage.js";
import { checkStorageAdapterConformance } from "../src/fabric/conformance.js";
import { IpfsStorage, BtfsStorage, TonStorage } from "../src/fabric/network-seams.js";

// ---------------------------------------------------------------------------
// 1. Harness passes for the reference adapters
// ---------------------------------------------------------------------------

test("harness: MemoryCAS passes conformance", async () => {
  await checkStorageAdapterConformance(() => new MemoryCAS());
});

test("harness: LocalCAS passes conformance", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mnemo-l5lc-"));
  try {
    await checkStorageAdapterConformance(() => new LocalCAS(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("harness: FabricStorage over 2 MemoryCAS replicas passes conformance", async () => {
  await checkStorageAdapterConformance(() =>
    createFabricStorage([
      { hint: { adapter: "inmem-1", uri: "memory://1" }, storage: new MemoryCAS() },
      { hint: { adapter: "inmem-2", uri: "memory://2" }, storage: new MemoryCAS() },
    ]),
  );
});

// ---------------------------------------------------------------------------
// 2. Harness REJECTS a broken adapter (proves teeth)
// ---------------------------------------------------------------------------

test("harness rejects: adapter that accepts different bytes on same ref", async () => {
  // A store that ignores content-address integrity: always overwrites.
  class BrokenIntegrity {
    private readonly m = new Map<string, Uint8Array>();
    async put(ref: string, bytes: Uint8Array) { this.m.set(ref, bytes.slice()); }
    async get(ref: string) {
      const b = this.m.get(ref); if (!b) throw new Error("[CAS_MISSING] missing");
      return b.slice();
    }
    async has(ref: string) { return this.m.has(ref); }
  }
  await assert.rejects(
    () => checkStorageAdapterConformance(() => new BrokenIntegrity() as any),
    /STORAGE_CONFORMANCE_FAIL/,
  );
});

test("harness rejects: adapter that returns wrong bytes on get", async () => {
  class BrokenGet {
    async put(_ref: string, _bytes: Uint8Array) {}
    async get(_ref: string) { return new Uint8Array([99]); }
    async has(_ref: string) { return false; }
  }
  await assert.rejects(
    () => checkStorageAdapterConformance(() => new BrokenGet() as any),
    /STORAGE_CONFORMANCE_FAIL/,
  );
});

// ---------------------------------------------------------------------------
// 3. MemoryCAS directly
// ---------------------------------------------------------------------------

test("MemoryCAS: round-trip put/get", async () => {
  const cas = new MemoryCAS();
  const ref = "mem:" + "ab".repeat(32);
  const bytes = new Uint8Array([1, 2, 3]);
  await cas.put(ref, bytes);
  const got = await cas.get(ref);
  assert.deepEqual(got, bytes);
});

test("MemoryCAS: idempotent put — same bytes twice succeeds", async () => {
  const cas = new MemoryCAS();
  const ref = "mem:" + "ab".repeat(32);
  await cas.put(ref, new Uint8Array([1]));
  await cas.put(ref, new Uint8Array([1])); // no throw
  assert.deepEqual(await cas.get(ref), new Uint8Array([1]));
});

test("MemoryCAS: CAS_CONFLICT on different bytes", async () => {
  const cas = new MemoryCAS();
  const ref = "mem:" + "ab".repeat(32);
  await cas.put(ref, new Uint8Array([1]));
  await assert.rejects(() => cas.put(ref, new Uint8Array([2])), /CAS_CONFLICT/);
});

test("MemoryCAS: CAS_MISSING on absent get", async () => {
  await assert.rejects(
    () => new MemoryCAS().get("mem:" + "ab".repeat(32)),
    /CAS_MISSING/,
  );
});

test("MemoryCAS: CAS_BAD_REF on malformed ref", async () => {
  const cas = new MemoryCAS();
  await assert.rejects(() => cas.put("bad", new Uint8Array([1])), /CAS_BAD_REF/);
  await assert.rejects(() => cas.get("mem:short"), /CAS_BAD_REF/);
  await assert.rejects(() => cas.has("ipfs://" + "ab".repeat(32)), /CAS_BAD_REF/);
});

test("MemoryCAS: stored bytes are a COPY — mutating input or returned array doesn't affect store", async () => {
  const cas = new MemoryCAS();
  const ref = "mem:" + "ab".repeat(32);
  const input = new Uint8Array([5, 6, 7]);
  await cas.put(ref, input);
  // Mutate input after put — should not affect store
  input[0] = 99;
  const got1 = await cas.get(ref);
  assert.equal(got1[0], 5, "stored bytes should be a copy of the original input");

  // Mutate returned bytes — should not affect subsequent get
  got1[0] = 99;
  const got2 = await cas.get(ref);
  assert.equal(got2[0], 5, "returned bytes should be a fresh copy");
});

// ---------------------------------------------------------------------------
// 4. FabricStorage replication
// ---------------------------------------------------------------------------

test("FabricStorage: put writes to every replica, get returns bytes", async () => {
  const m1 = new MemoryCAS();
  const m2 = new MemoryCAS();
  const fabric = createFabricStorage([
    { hint: { adapter: "r1", uri: "a://1" }, storage: m1 },
    { hint: { adapter: "r2", uri: "a://2" }, storage: m2 },
  ]);
  const ref = "mem:" + "ab".repeat(32);
  const bytes = new Uint8Array([9, 8, 7]);
  await fabric.put(ref, bytes);

  assert.deepEqual(await fabric.get(ref), bytes);
  assert.equal(await m1.has(ref), true);
  assert.equal(await m2.has(ref), true);
  assert.deepEqual(await m1.get(ref), bytes);
  assert.deepEqual(await m2.get(ref), bytes);
});

// ---------------------------------------------------------------------------
// 5. FabricStorage read-failover
// ---------------------------------------------------------------------------

test("FabricStorage: get succeeds when first replica misses, falls through to second", async () => {
  const m1 = new MemoryCAS();
  const m2 = new MemoryCAS();
  const fabric = createFabricStorage([
    { hint: { adapter: "r1", uri: "a://1" }, storage: m1 },
    { hint: { adapter: "r2", uri: "a://2" }, storage: m2 },
  ]);
  const ref = "mem:" + "ab".repeat(32);
  const bytes = new Uint8Array([7, 7, 7]);
  // Only put in m2 (simulating m1 being down or later populated).
  await m2.put(ref, bytes);

  const got = await fabric.get(ref);
  assert.deepEqual(got, bytes);
  assert.equal(await fabric.has(ref), true);
});

test("FabricStorage: CAS_MISSING when no replica holds the ref", async () => {
  const fabric = createFabricStorage([
    { hint: { adapter: "r1", uri: "a://1" }, storage: new MemoryCAS() },
    { hint: { adapter: "r2", uri: "a://2" }, storage: new MemoryCAS() },
  ]);
  await assert.rejects(() => fabric.get("mem:" + "ab".repeat(32)), /CAS_MISSING/);
  assert.equal(await fabric.has("mem:" + "ab".repeat(32)), false);
});

// ---------------------------------------------------------------------------
// 6. FabricStorage.locate
// ---------------------------------------------------------------------------

test("FabricStorage.locate: names replicas that hold the ref in declared order", async () => {
  const m1 = new MemoryCAS();
  const m2 = new MemoryCAS();
  const m3 = new MemoryCAS();
  const fabric = createFabricStorage([
    { hint: { adapter: "a1", uri: "u1" }, storage: m1 },
    { hint: { adapter: "a2", uri: "u2" }, storage: m2 },
    { hint: { adapter: "a3", uri: "u3" }, storage: m3 },
  ]);
  const ref = "mem:" + "ab".repeat(32);
  await m1.put(ref, new Uint8Array([1]));
  await m3.put(ref, new Uint8Array([1]));

  const loc = await fabric.locate(ref);
  assert.equal(loc.replicas.length, 2);
  assert.equal(loc.replicas[0]!.adapter, "a1");
  assert.equal(loc.replicas[1]!.adapter, "a3");
  assert.equal(loc.contentCommit.length, 32);
});

test("FabricStorage.locate: empty replicas when no replica holds ref", async () => {
  const fabric = createFabricStorage([
    { hint: { adapter: "r1", uri: "u1" }, storage: new MemoryCAS() },
  ]);
  const ref = "mem:" + "ab".repeat(32);
  const loc = await fabric.locate(ref);
  assert.equal(loc.replicas.length, 0);
  assert.equal(loc.contentCommit.length, 32);
});

// ---------------------------------------------------------------------------
// 7. Out-of-root equivalence: LocalCAS vs FabricStorage same vault_memory_root
// ---------------------------------------------------------------------------

test("OUT-OF-ROOT equivalence: same vault_memory_root with LocalCAS vs FabricStorage", async () => {
  // Use the spine scenario helpers
  const spineModule = await import("../src/spine/spine.js");
  const createSpine = spineModule.createSpine;
  type AppendInput = import("../src/spine/spine.js").AppendInput;
  const { vaultDidFromPubkey, agentDid, ROOT_CAPABILITY_ID } = await import("../src/identity/did.js");
  const { MemSpineStore } = await import("../scripts/mem-store.js");

  const FIXED_ENC = {
    alg: "AES-256-GCM" as const,
    key_id: "vault-kek-0",
    nonce_b64: "AAAAAAAAAAAAAAAA",
    wrap_b64: "",
  };

  function fixedPubkey() {
    return new Uint8Array(Array.from({ length: 32 }, (_, i) => i));
  }

  function fixedCiphertext(tag: number, i: number) {
    return new Uint8Array([tag, i, 0xde, 0xad, 0xbe, 0xef, i, tag]);
  }

  function plan(vaultDid: string, writerDid: string): AppendInput[] {
    const cells = [
      { space: "dialog", tag: 0x10, kind: "dialog" as const, createdAt: 5000n },
      { space: "code", tag: 0x20, kind: "code" as const, createdAt: 4000n },
      { space: "dialog", tag: 0x10, kind: "dialog" as const, createdAt: 3000n },
    ];
    const perSpace = new Map<string, number>();
    return cells.map((c) => {
      const i = perSpace.get(c.space) ?? 0;
      perSpace.set(c.space, i + 1);
      return {
        vaultDid,
        space: c.space,
        kind: c.kind,
        ciphertext: fixedCiphertext(c.tag, i),
        enc: FIXED_ENC,
        writerDid,
        capabilityId: ROOT_CAPABILITY_ID,
        createdAt: c.createdAt,
        tags: [`${c.space}-${i}`],
      };
    });
  }

  const vaultDid = vaultDidFromPubkey(fixedPubkey());
  const writerDid = agentDid("claude", "golden");
  const anchor = { anchor: async () => { throw new Error("unused"); }, latest: async () => null };

  // Run with LocalCAS (on-disk)
  const dir = await mkdtemp(join(tmpdir(), "mnemo-l5eq-lc-"));
  let localRoot: string;
  let localIds: string[];
  try {
    const store1 = new MemSpineStore();
    const storage1 = new LocalCAS(dir);
    const spine1 = createSpine({ store: store1, storage: storage1, anchor });
    const ids: string[] = [];
    let root = "";
    for (const input of plan(vaultDid, writerDid)) {
      const r = await spine1.append(input);
      ids.push(r.object_id);
      root = r.vault_memory_root;
    }
    localRoot = root;
    localIds = ids;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  // Run with FabricStorage (2 MemoryCAS replicas)
  const fabric = createFabricStorage([
    { hint: { adapter: "r1", uri: "mem://1" }, storage: new MemoryCAS() },
    { hint: { adapter: "r2", uri: "mem://2" }, storage: new MemoryCAS() },
  ]);
  const store2 = new MemSpineStore();
  const spine2 = createSpine({ store: store2, storage: fabric, anchor });
  let fabricRoot = "";
  const fabricIds: string[] = [];
  for (const input of plan(vaultDid, writerDid)) {
    const r = await spine2.append(input);
    fabricIds.push(r.object_id);
    fabricRoot = r.vault_memory_root;
  }

  // Assert byte-identical
  assert.equal(fabricRoot, localRoot);
  for (let i = 0; i < localIds!.length; i++) {
    assert.equal(fabricIds[i], localIds![i]!, `object_id[${i}] must match`);
  }
});

// ---------------------------------------------------------------------------
// 8. Network seams throw [STORAGE_NOT_AVAILABLE]
// ---------------------------------------------------------------------------

test("IpfsStorage: all methods throw [STORAGE_NOT_AVAILABLE]", async () => {
  const s = new IpfsStorage();
  await assert.rejects(() => s.put("mem:" + "ab".repeat(32), new Uint8Array(1)), /STORAGE_NOT_AVAILABLE/);
  await assert.rejects(() => s.get("mem:" + "ab".repeat(32)), /STORAGE_NOT_AVAILABLE/);
  await assert.rejects(() => s.has("mem:" + "ab".repeat(32)), /STORAGE_NOT_AVAILABLE/);
});

test("BtfsStorage: all methods throw [STORAGE_NOT_AVAILABLE]", async () => {
  const s = new BtfsStorage();
  await assert.rejects(() => s.put("mem:" + "ab".repeat(32), new Uint8Array(1)), /STORAGE_NOT_AVAILABLE/);
  await assert.rejects(() => s.get("mem:" + "ab".repeat(32)), /STORAGE_NOT_AVAILABLE/);
  await assert.rejects(() => s.has("mem:" + "ab".repeat(32)), /STORAGE_NOT_AVAILABLE/);
});

test("TonStorage: all methods throw [STORAGE_NOT_AVAILABLE]", async () => {
  const s = new TonStorage();
  await assert.rejects(() => s.put("mem:" + "ab".repeat(32), new Uint8Array(1)), /STORAGE_NOT_AVAILABLE/);
  await assert.rejects(() => s.get("mem:" + "ab".repeat(32)), /STORAGE_NOT_AVAILABLE/);
  await assert.rejects(() => s.has("mem:" + "ab".repeat(32)), /STORAGE_NOT_AVAILABLE/);
});

// ---------------------------------------------------------------------------
// Additional: FabricStorage CAS_BAD_REF on put/get/locate
// ---------------------------------------------------------------------------

test("FabricStorage: CAS_BAD_REF propagates on put/get/locate", async () => {
  const fabric = createFabricStorage([
    { hint: { adapter: "r1", uri: "u1" }, storage: new MemoryCAS() },
  ]);
  await assert.rejects(() => fabric.put("bad", new Uint8Array([1])), /CAS_BAD_REF/);
  await assert.rejects(() => fabric.get("bad"), /CAS_BAD_REF/);
  await assert.rejects(() => fabric.locate("bad"), /CAS_BAD_REF/);
});

// ---------------------------------------------------------------------------
// FabricStorage CAS_CONFLICT propagation
// ---------------------------------------------------------------------------

test("FabricStorage: CAS_CONFLICT from a replica propagates", async () => {
  const m1 = new MemoryCAS();
  const m2 = new MemoryCAS();
  const fabric = createFabricStorage([
    { hint: { adapter: "r1", uri: "u1" }, storage: m1 },
    { hint: { adapter: "r2", uri: "u2" }, storage: m2 },
  ]);
  const ref = "mem:" + "ab".repeat(32);
  // Pre-load m2 with different bytes
  await m2.put(ref, new Uint8Array([9]));
  // Now put through fabric with different bytes → m2 should reject
  await assert.rejects(() => fabric.put(ref, new Uint8Array([1])), /CAS_CONFLICT/);
});
