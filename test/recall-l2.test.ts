/**
 * L2 Recall tests — TASK-deepseek-L2 §2 (8 required test groups).
 *
 * Covers: HashEmbedder determinism, LocalRecallIndex CRUD + query, tie-break,
 * createRecall facade, rebuild, OUT-OF-ROOT invariant (behavioural + structural).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { HashEmbedder } from "../src/recall/embedding.js";
import { LocalRecallIndex } from "../src/recall/recall-index.js";
import { createRecall, type RecallSource } from "../src/recall/recall.js";

// ---------------------------------------------------------------------------
// 1. HashEmbedder
// ---------------------------------------------------------------------------

test("HashEmbedder: deterministic, same text → identical vector", async () => {
  const e1 = new HashEmbedder(8);
  const e2 = new HashEmbedder(8);
  const v1 = await e1.embed("hello world");
  const v2 = await e2.embed("hello world");
  assert.equal(v1.length, 8);
  assert.equal(v2.length, 8);
  assert.deepEqual(v1, v2);
});

test("HashEmbedder: correct length (default 64)", async () => {
  const e = new HashEmbedder();
  assert.equal(e.dimension, 64);
  const v = await e.embed("test");
  assert.equal(v.length, 64);
});

test("HashEmbedder: L2-normalized (‖v‖ ≈ 1 for non-empty text)", async () => {
  const e = new HashEmbedder(16);
  const v = await e.embed("some text");
  let normSq = 0;
  for (let i = 0; i < v.length; i++) normSq += v[i]! * v[i]!;
  const norm = Math.sqrt(normSq);
  assert.ok(Math.abs(norm - 1) < 1e-6, `expected norm ≈ 1, got ${norm}`);
});

test("HashEmbedder: different texts → different vectors", async () => {
  const e = new HashEmbedder(8);
  const a = await e.embed("alpha");
  const b = await e.embed("beta");
  let same = true;
  for (let i = 0; i < 8; i++) {
    if (a[i] !== b[i]) { same = false; break; }
  }
  assert.equal(same, false);
});

test("HashEmbedder: empty text produces a valid L2-normalized vector", async () => {
  const e = new HashEmbedder(8);
  const v = await e.embed("");
  let normSq = 0;
  for (let i = 0; i < v.length; i++) normSq += v[i]! * v[i]!;
  const norm = Math.sqrt(normSq); assert.ok(Math.abs(norm - 1) < 1e-6, `empty-text norm ${norm} should be ~1 after L2-norm`);
});

// ---------------------------------------------------------------------------
// 2. LocalRecallIndex add/has/size/remove/clear
// ---------------------------------------------------------------------------

test("LocalRecallIndex: add/has/size work correctly", () => {
  const idx = new LocalRecallIndex(8);
  const vec = new Float32Array(8).fill(0.25);
  assert.equal(idx.size(), 0);
  assert.equal(idx.has("obj:1"), false);

  idx.add("obj:1", vec);
  assert.equal(idx.size(), 1);
  assert.equal(idx.has("obj:1"), true);
  assert.equal(idx.has("obj:2"), false);
});

test("LocalRecallIndex: upsert replaces vector, size stable", () => {
  const idx = new LocalRecallIndex(8);
  const v1 = new Float32Array(8).fill(0.1);
  const v2 = new Float32Array(8).fill(0.9);
  idx.add("obj:1", v1);
  assert.equal(idx.size(), 1);
  idx.add("obj:1", v2); // upsert
  assert.equal(idx.size(), 1);
});

test("LocalRecallIndex: remove works", () => {
  const idx = new LocalRecallIndex(8);
  idx.add("obj:1", new Float32Array(8).fill(0.5));
  idx.add("obj:2", new Float32Array(8).fill(0.5));
  assert.equal(idx.size(), 2);
  idx.remove("obj:1");
  assert.equal(idx.size(), 1);
  assert.equal(idx.has("obj:1"), false);
  assert.equal(idx.has("obj:2"), true);
  idx.remove("obj:99"); // no-op
  assert.equal(idx.size(), 1);
});

test("LocalRecallIndex: clear empties the index", () => {
  const idx = new LocalRecallIndex(8);
  idx.add("a", new Float32Array(8).fill(0.5));
  idx.add("b", new Float32Array(8).fill(0.5));
  assert.equal(idx.size(), 2);
  idx.clear();
  assert.equal(idx.size(), 0);
  assert.equal(idx.has("a"), false);
  assert.equal(idx.has("b"), false);
});

test("LocalRecallIndex: add dim-mismatch throws [RECALL_DIM_MISMATCH]", () => {
  const idx = new LocalRecallIndex(8);
  assert.throws(() => idx.add("x", new Float32Array(4)), /RECALL_DIM_MISMATCH/);
});

test("LocalRecallIndex: query dim-mismatch throws [RECALL_DIM_MISMATCH]", () => {
  const idx = new LocalRecallIndex(8);
  assert.throws(() => idx.query(new Float32Array(4), 5), /RECALL_DIM_MISMATCH/);
});

// ---------------------------------------------------------------------------
// 3. query ranking
// ---------------------------------------------------------------------------

test("LocalRecallIndex: identical vector → score ≈ 1", () => {
  const D = 8;
  const idx = new LocalRecallIndex(D);
  const V = new Float32Array(D);
  V[0] = 1; V[1] = 2; V[2] = 3; V[3] = 4; V[4] = 5; V[5] = 6; V[6] = 7; V[7] = 8;
  // L2-normalize V manually so cosine is exactly 1
  let normSq = 0;
  for (let i = 0; i < D; i++) normSq += V[i]! * V[i]!;
  const norm = Math.sqrt(normSq);
  const Vn = new Float32Array(D);
  for (let i = 0; i < D; i++) Vn[i] = V[i]! / norm;

  idx.add("match", Vn);
  const hits = idx.query(Vn, 1);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.objectId, "match");
  assert.ok(Math.abs(hits[0]!.score - 1) < 1e-12);
});

test("LocalRecallIndex: top-k respects k", () => {
  const D = 4;
  const idx = new LocalRecallIndex(D);
  const v0 = new Float32Array([1, 0, 0, 0]);
  const v1 = new Float32Array([0, 1, 0, 0]);
  const v2 = new Float32Array([0, 0, 1, 0]);
  idx.add("a", v0);
  idx.add("b", v1);
  idx.add("c", v2);

  const q = new Float32Array([1, 0, 0, 0]);
  assert.equal(idx.query(q, 1).length, 1);
  assert.equal(idx.query(q, 2).length, 2);
  assert.equal(idx.query(q, 3).length, 3);
});

test("LocalRecallIndex: k <= 0 → []", () => {
  const D = 4;
  const idx = new LocalRecallIndex(D);
  idx.add("x", new Float32Array([1, 0, 0, 0]));
  assert.deepEqual(idx.query(new Float32Array([1, 0, 0, 0]), 0), []);
  assert.deepEqual(idx.query(new Float32Array([1, 0, 0, 0]), -1), []);
});

test("LocalRecallIndex: k > size → all", () => {
  const D = 4;
  const idx = new LocalRecallIndex(D);
  idx.add("x", new Float32Array([1, 0, 0, 0]));
  assert.equal(idx.query(new Float32Array([1, 0, 0, 0]), 100).length, 1);
});

test("LocalRecallIndex: zero-norm query vector → score 0 for all", () => {
  const D = 4;
  const idx = new LocalRecallIndex(D);
  idx.add("a", new Float32Array([1, 0, 0, 0]));
  idx.add("b", new Float32Array([0, 1, 0, 0]));
  const q = new Float32Array(D); // all zeros
  const hits = idx.query(q, 2);
  assert.equal(hits.length, 2);
  for (const h of hits) assert.equal(h.score, 0);
});

// ---------------------------------------------------------------------------
// 4. Tie-break determinism
// ---------------------------------------------------------------------------

test("LocalRecallIndex: tie-break — equal scores → objectId asc", () => {
  const D = 4;
  const idx = new LocalRecallIndex(D);
  const v = new Float32Array([1, 0, 0, 0]);
  idx.add("c", v);
  idx.add("a", v);
  idx.add("b", v);
  const q = new Float32Array([1, 0, 0, 0]);
  const hits = idx.query(q, 3);
  assert.deepEqual(hits.map((h) => h.objectId), ["a", "b", "c"]);
});

test("LocalRecallIndex: tie-break stable across runs", () => {
  for (let run = 0; run < 5; run++) {
    const D = 4;
    const idx = new LocalRecallIndex(D);
    const v = new Float32Array([1, 0, 0, 0]);
    idx.add("z", v);
    idx.add("m", v);
    idx.add("a", v);
    const q = new Float32Array([1, 0, 0, 0]);
    const hits = idx.query(q, 3);
    assert.deepEqual(hits.map((h) => h.objectId), ["a", "m", "z"]);
  }
});

// ---------------------------------------------------------------------------
// 5. createRecall facade
// ---------------------------------------------------------------------------

test("createRecall: dim-mismatch embedder/index throws [RECALL_DIM_MISMATCH]", () => {
  const e = new HashEmbedder(8);
  const idx = new LocalRecallIndex(16);
  assert.throws(() => createRecall({ embedder: e, index: idx }), /RECALL_DIM_MISMATCH/);
});

test("createRecall: indexObject with {text} and {vector} both work", async () => {
  const e = new HashEmbedder(8);
  const idx = new LocalRecallIndex(8);
  const recall = createRecall({ embedder: e, index: idx });

  await recall.indexObject("a", { text: "hello" });
  await recall.indexObject("b", { vector: new Float32Array(8).fill(0.1) });
  assert.equal(idx.size(), 2);
  assert.equal(idx.has("a"), true);
  assert.equal(idx.has("b"), true);
});

test("createRecall: recall returns ranked RecallHits", async () => {
  const D = 8;
  const e = new HashEmbedder(D);
  const idx = new LocalRecallIndex(D);
  const recall = createRecall({ embedder: e, index: idx });

  // Add two vectors: one matching, one not.
  const matchVec = new Float32Array(D);
  matchVec[0] = 1;
  let n = 0; for (let i = 0; i < D; i++) n += matchVec[i]! * matchVec[i]!; n = Math.sqrt(n);
  for (let i = 0; i < D; i++) matchVec[i]! /= n;
  // Orthogonal vector.
  const orthVec = new Float32Array(D);
  orthVec[1] = 1;

  await recall.indexObject("match", { vector: matchVec });
  await recall.indexObject("orth", { vector: orthVec });

  const hits = await recall.recall({ vector: matchVec }, 2);
  assert.equal(hits.length, 2);
  assert.equal(hits[0]!.objectId, "match");
  assert.ok(Math.abs(hits[0]!.score - 1) < 1e-12);
});

test("createRecall: remove drops an object", async () => {
  const D = 8;
  const e = new HashEmbedder(D);
  const idx = new LocalRecallIndex(D);
  const recall = createRecall({ embedder: e, index: idx });

  await recall.indexObject("x", { text: "data" });
  assert.equal(idx.has("x"), true);
  recall.remove("x");
  assert.equal(idx.has("x"), false);
});

test("createRecall: indexObject with text → uses embedder", async () => {
  const D = 8;
  const e = new HashEmbedder(D);
  const idx = new LocalRecallIndex(D);
  const recall = createRecall({ embedder: e, index: idx });

  await recall.indexObject("t1", { text: "The quick brown fox" });
  await recall.indexObject("t2", { text: "The quick brown fox" }); // same text, deterministic → same vector

  const hits = await recall.recall({ text: "The quick brown fox" }, 2);
  // Both have equal scores (same vector), so tie-break by objectId asc
  assert.equal(hits[0]!.objectId, "t1");
  assert.equal(hits[1]!.objectId, "t2");
});

// ---------------------------------------------------------------------------
// 6. rebuild
// ---------------------------------------------------------------------------

test("createRecall: rebuild from async stream reproduces incremental index", async () => {
  const D = 8;
  // Incremental build
  const e1 = new HashEmbedder(D);
  const idx1 = new LocalRecallIndex(D);
  const r1 = createRecall({ embedder: e1, index: idx1 });
  await r1.indexObject("a", { text: "apple" });
  await r1.indexObject("b", { text: "banana" });
  await r1.indexObject("c", { text: "cherry" });

  // Rebuild
  const e2 = new HashEmbedder(D);
  const idx2 = new LocalRecallIndex(D);
  const r2 = createRecall({ embedder: e2, index: idx2 });

  async function* stream() {
    yield { objectId: "a", text: "apple" };
    yield { objectId: "b", text: "banana" };
    yield { objectId: "c", text: "cherry" };
  }

  const count = await r2.rebuild(stream());
  assert.equal(count, 3);
  assert.equal(idx2.size(), 3);

  // Both should produce identical query results.
  const q = await e1.embed("fruit");
  const h1 = idx1.query(q, 3);
  const h2 = idx2.query(q, 3);
  assert.deepEqual(h1, h2);
});

test("createRecall: rebuild clears prior state", async () => {
  const D = 8;
  const e = new HashEmbedder(D);
  const idx = new LocalRecallIndex(D);
  const r = createRecall({ embedder: e, index: idx });

  await r.indexObject("old", { text: "old data" });
  assert.equal(idx.has("old"), true);

  async function* stream() {
    yield { objectId: "new", text: "new data" };
  }
  await r.rebuild(stream());
  assert.equal(idx.has("old"), false);
  assert.equal(idx.has("new"), true);
});

test("createRecall: rebuild returns correct count", async () => {
  const D = 8;
  const e = new HashEmbedder(D);
  const idx = new LocalRecallIndex(D);
  const r = createRecall({ embedder: e, index: idx });

  async function* stream() {
    yield { objectId: "1", text: "one" };
    yield { objectId: "2", text: "two" };
    yield { objectId: "3", text: "three" };
    yield { objectId: "4", text: "four" };
    yield { objectId: "5", text: "five" };
  }
  const count = await r.rebuild(stream());
  assert.equal(count, 5);
  assert.equal(idx.size(), 5);
});

test("createRecall: rebuild over empty stream → count 0, index empty", async () => {
  const D = 8;
  const e = new HashEmbedder(D);
  const idx = new LocalRecallIndex(D);
  const r = createRecall({ embedder: e, index: idx });
  await r.indexObject("pre", { text: "data" });

  async function* empty() {}
  const count = await r.rebuild(empty());
  assert.equal(count, 0);
  assert.equal(idx.size(), 0);
});

// ---------------------------------------------------------------------------
// 7. OUT-OF-ROOT invariant — behavioural
// ---------------------------------------------------------------------------

test("OUT-OF-ROOT: spine scenario root is byte-identical with vs without L2 recall", async () => {
  // Re-use the spine scenario helpers from scripts/
  const spineModule = await import("../src/spine/spine.js");
  const createSpine = spineModule.createSpine;
  type AppendInput = import("../src/spine/spine.js").AppendInput;
  const { toHex } = await import("../src/canonical/hash.js");
  const { vaultMemoryRoot } = await import("../src/spine/vault.js");
  const { vaultDidFromPubkey, agentDid, ROOT_CAPABILITY_ID } = await import("../src/identity/did.js");
  const { MemSpineStore, MemCAS } = await import("../scripts/mem-store.js");

  // Fixed scenario — same as spine-scenario.ts
  const FIXED_ENC = {
    alg: "AES-256-GCM" as const,
    key_id: "vault-kek-0",
    nonce_b64: "AAAAAAAAAAAAAAAA",
    wrap_b64: "",
  };

  function fixedPubkey() {
    return new Uint8Array(Array.from({ length: 32 }, (_, i) => i));
  }

  function fixedCiphertext(spaceTag: number, i: number) {
    return new Uint8Array([spaceTag, i, 0xde, 0xad, 0xbe, 0xef, i, spaceTag]);
  }

  function plan(vaultDid: string, writerDid: string): AppendInput[] {
    const cells = [
      { space: "dialog", tag: 0x10, kind: "dialog" as const, createdAt: 5000n },
      { space: "code", tag: 0x20, kind: "code" as const, createdAt: 4000n },
      { space: "dialog", tag: 0x10, kind: "dialog" as const, createdAt: 3000n },
      { space: "code", tag: 0x20, kind: "code" as const, createdAt: 9000n },
      { space: "dialog", tag: 0x10, kind: "fact" as const, createdAt: 1000n },
      { space: "code", tag: 0x20, kind: "artifact" as const, createdAt: 8000n },
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

  // Run WITHOUT L2
  const vaultDid = vaultDidFromPubkey(fixedPubkey());
  const writerDid = agentDid("claude", "golden");
  const store1 = new MemSpineStore();
  const storage1 = new MemCAS();
  const anchor = { anchor: async () => { throw new Error("unused"); }, latest: async () => null };
  const spine1 = createSpine({ store: store1, storage: storage1, anchor });

  const objectIds: string[] = [];
  const roots: string[] = [];
  const spaceStates: Record<string, string[]> = {};
  for (const input of plan(vaultDid, writerDid)) {
    const r = await spine1.append(input);
    objectIds.push(r.object_id);
    roots.push(r.vault_memory_root);
    const prev = spaceStates[input.space] ?? [];
    prev.push(r.space_state);
    spaceStates[input.space] = prev;
  }
  const rootWithoutL2 = roots[roots.length - 1]!;

  // Run WITH L2 — same scenario but also build recall
  const store2 = new MemSpineStore();
  const storage2 = new MemCAS();
  const spine2 = createSpine({ store: store2, storage: storage2, anchor });

  const embedder = new HashEmbedder(16);
  const index = new LocalRecallIndex(16);
  const recall = createRecall({ embedder, index });

  const objectIdsWith: string[] = [];
  const rootsWith: string[] = [];
  let step = 0;
  for (const input of plan(vaultDid, writerDid)) {
    const r = await spine2.append(input);
    objectIdsWith.push(r.object_id);
    rootsWith.push(r.vault_memory_root);

    // Also index the object (supply a deterministic "plaintext" for the test).
    await recall.indexObject(r.object_id, { text: `object-${step}: ${input.space} ${input.kind}` });

    // Issue a recall — must not affect the spine.
    void await recall.recall({ text: `query-${step}` }, 3);

    step++;
  }
  const rootWithL2 = rootsWith[rootsWith.length - 1]!;

  // Assert all spine commitments are byte-identical.
  assert.equal(rootWithL2, rootWithoutL2, "vault_memory_root must be identical");
  for (let i = 0; i < objectIds.length; i++) {
    assert.equal(objectIdsWith[i], objectIds[i], `object_id[${i}] must be identical`);
  }
  for (let i = 0; i < roots.length; i++) {
    assert.equal(rootsWith[i], roots[i], `vault_memory_root[${i}] must be identical`);
  }
});

// ---------------------------------------------------------------------------
// 8. OUT-OF-ROOT invariant — structural
// ---------------------------------------------------------------------------

test("OUT-OF-ROOT structural: src/spine/ does not import recall", () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const srcDir = join(__dirname, "..", "src");

  const spineFiles = [
    "spine/spine.ts", "spine/object.ts", "spine/space.ts",
    "spine/types.ts", "spine/vault.ts", "spine/index.ts",
  ];
  const canonicalFiles = [
    "canonical/domains.ts", "canonical/errors.ts", "canonical/hash.ts",
    "canonical/index.ts", "canonical/integers.ts", "canonical/jcs.ts",
    "canonical/merkle.ts", "canonical/strings.ts", "canonical/unicodeAssigned.ts",
  ];

  for (const rel of [...spineFiles, ...canonicalFiles]) {
    const content = readFileSync(join(srcDir, rel), "utf8");
    // Check for any import of "../recall" or "recall"
    if (/from\s+["'].*recall/.test(content)) {
      assert.fail(`${rel} imports recall — OUT-OF-ROOT VIOLATION`);
    }
    if (/import\s+.*recall/.test(content)) {
      assert.fail(`${rel} imports recall — OUT-OF-ROOT VIOLATION`);
    }
  }

  // Passes if we reach here (no violation found).
  assert.ok(true);
});
