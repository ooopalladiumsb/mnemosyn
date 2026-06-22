/**
 * L3 Semantic tests (TASK-deepseek-L3 §2).
 *
 * Covers: DelimitedExtractor, LocalKnowledgeGraph, createSemantic facade,
 * out-of-root invariant (behavioural + structural), rebuild, canonical-order determinism.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DelimitedExtractor } from "../src/semantic/fact.js";
import { LocalKnowledgeGraph } from "../src/semantic/knowledge-graph.js";
import { createSemantic } from "../src/semantic/semantic.js";

// ---------------------------------------------------------------------------
// 1. DelimitedExtractor
// ---------------------------------------------------------------------------

test("DelimitedExtractor: parses well-formed tab-delimited lines into ordered triples", async () => {
  const ext = new DelimitedExtractor();
  const text = "Alice\tknows\tBob\nAlice\tloves\tcode\nBob\twrote\tpaper";
  const triples = await ext.extract(text);
  assert.equal(triples.length, 3);
  assert.deepEqual(triples[0], { subject: "Alice", predicate: "knows", object: "Bob" });
  assert.deepEqual(triples[1], { subject: "Alice", predicate: "loves", object: "code" });
  assert.deepEqual(triples[2], { subject: "Bob", predicate: "wrote", object: "paper" });
});

test("DelimitedExtractor: skips blank and malformed lines", async () => {
  const ext = new DelimitedExtractor();
  const text = "Alice\tknows\tBob\n\nbad line\n\t\nBob\twrote\tpaper\tonly three";
  const triples = await ext.extract(text);
  assert.equal(triples.length, 1);
  assert.deepEqual(triples[0], { subject: "Alice", predicate: "knows", object: "Bob" });
});

test("DelimitedExtractor: skips lines with empty fields after trim", async () => {
  const ext = new DelimitedExtractor();
  const text = " \tknows\tBob\nAlice\t\tcode\nAlice\tknows\t ";
  const triples = await ext.extract(text);
  assert.equal(triples.length, 0);
});

test("DelimitedExtractor: custom delimiter works", async () => {
  const ext = new DelimitedExtractor("|");
  const text = "a|b|c\nd|e|f";
  const triples = await ext.extract(text);
  assert.equal(triples.length, 2);
  assert.deepEqual(triples[0], { subject: "a", predicate: "b", object: "c" });
  assert.deepEqual(triples[1], { subject: "d", predicate: "e", object: "f" });
});

test("DelimitedExtractor: deterministic (same text -> same triples)", async () => {
  const ext = new DelimitedExtractor();
  const text = "X\tY\tZ\nA\tB\tC";
  const t1 = await ext.extract(text);
  const t2 = await ext.extract(text);
  assert.deepEqual(t1, t2);
});

// ---------------------------------------------------------------------------
// 2. LocalKnowledgeGraph addFact/size/entities
// ---------------------------------------------------------------------------

test("LocalKnowledgeGraph: addFact increments size", () => {
  const g = new LocalKnowledgeGraph();
  assert.equal(g.size(), 0);
  g.addFact({ triple: { subject: "a", predicate: "p", object: "b" }, sourceObjectId: "obj:1" });
  assert.equal(g.size(), 1);
});

test("LocalKnowledgeGraph: dedup — re-add identical fact is no-op, size stable", () => {
  const g = new LocalKnowledgeGraph();
  const f = { triple: { subject: "a", predicate: "p", object: "b" }, sourceObjectId: "obj:1" };
  g.addFact(f);
  assert.equal(g.size(), 1);
  g.addFact(f);
  assert.equal(g.size(), 1);
  // Different source = different fact
  g.addFact({ triple: { subject: "a", predicate: "p", object: "b" }, sourceObjectId: "obj:2" });
  assert.equal(g.size(), 2);
});

test("LocalKnowledgeGraph: removeBySource drops exactly that source's facts", () => {
  const g = new LocalKnowledgeGraph();
  g.addFact({ triple: { subject: "a", predicate: "p", object: "b" }, sourceObjectId: "obj:1" });
  g.addFact({ triple: { subject: "a", predicate: "p", object: "b" }, sourceObjectId: "obj:2" });
  g.addFact({ triple: { subject: "x", predicate: "q", object: "y" }, sourceObjectId: "obj:1" });
  assert.equal(g.size(), 3);
  g.removeBySource("obj:1");
  assert.equal(g.size(), 1); // only obj:2 survives
  g.removeBySource("nonexistent");
  assert.equal(g.size(), 1);
});

test("LocalKnowledgeGraph: clear empties the graph", () => {
  const g = new LocalKnowledgeGraph();
  g.addFact({ triple: { subject: "a", predicate: "p", object: "b" }, sourceObjectId: "obj:1" });
  g.clear();
  assert.equal(g.size(), 0);
  assert.deepEqual(g.entities(), []);
  assert.deepEqual(g.match({}), []);
});

test("LocalKnowledgeGraph: entities returns sorted distinct subjects ∪ objects", () => {
  const g = new LocalKnowledgeGraph();
  g.addFact({ triple: { subject: "zeta", predicate: "p", object: "alpha" }, sourceObjectId: "obj:1" });
  g.addFact({ triple: { subject: "beta", predicate: "q", object: "gamma" }, sourceObjectId: "obj:1" });
  g.addFact({ triple: { subject: "alpha", predicate: "r", object: "beta" }, sourceObjectId: "obj:2" });
  assert.deepEqual(g.entities(), ["alpha", "beta", "gamma", "zeta"]);
});

// ---------------------------------------------------------------------------
// 3. match
// ---------------------------------------------------------------------------

test("LocalKnowledgeGraph: match with full pattern returns matching facts in canonical order", () => {
  const g = new LocalKnowledgeGraph();
  g.addFact({ triple: { subject: "b", predicate: "p", object: "x" }, sourceObjectId: "obj:2" });
  g.addFact({ triple: { subject: "a", predicate: "p", object: "x" }, sourceObjectId: "obj:1" });
  g.addFact({ triple: { subject: "a", predicate: "q", object: "y" }, sourceObjectId: "obj:1" });
  const result = g.match({ subject: "a", predicate: "p", object: "x" });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0]!.triple, { subject: "a", predicate: "p", object: "x" });
});

test("LocalKnowledgeGraph: match wildcards — subject-only, predicate-only, object-only", () => {
  const g = new LocalKnowledgeGraph();
  g.addFact({ triple: { subject: "a", predicate: "p", object: "x" }, sourceObjectId: "obj:1" });
  g.addFact({ triple: { subject: "a", predicate: "q", object: "y" }, sourceObjectId: "obj:1" });
  g.addFact({ triple: { subject: "b", predicate: "p", object: "x" }, sourceObjectId: "obj:1" });

  assert.equal(g.match({ subject: "a" }).length, 2);
  assert.equal(g.match({ predicate: "p" }).length, 2);
  assert.equal(g.match({ object: "x" }).length, 2);
  assert.equal(g.match({ subject: "c" }).length, 0);
});

test("LocalKnowledgeGraph: match with empty pattern returns all facts in canonical order", () => {
  const g = new LocalKnowledgeGraph();
  g.addFact({ triple: { subject: "b", predicate: "p", object: "x" }, sourceObjectId: "obj:2" });
  g.addFact({ triple: { subject: "a", predicate: "p", object: "x" }, sourceObjectId: "obj:1" });
  const all = g.match({});
  assert.equal(all.length, 2);
  assert.equal(all[0]!.triple.subject, "a");
  assert.equal(all[1]!.triple.subject, "b");
});

// ---------------------------------------------------------------------------
// 4. neighbors
// ---------------------------------------------------------------------------

test("LocalKnowledgeGraph: neighbors returns facts where entity is subject OR object", () => {
  const g = new LocalKnowledgeGraph();
  g.addFact({ triple: { subject: "Alice", predicate: "knows", object: "Bob" }, sourceObjectId: "obj:1" });
  g.addFact({ triple: { subject: "Bob", predicate: "wrote", object: "paper" }, sourceObjectId: "obj:1" });
  g.addFact({ triple: { subject: "Eve", predicate: "knows", object: "Alice" }, sourceObjectId: "obj:2" });

  const neighbors = g.neighbors("Alice");
  assert.equal(neighbors.length, 2);
  assert.equal(neighbors[0]!.triple.subject, "Alice");
  assert.equal(neighbors[1]!.triple.subject, "Eve");
});

test("LocalKnowledgeGraph: neighbors of unknown entity returns []", () => {
  const g = new LocalKnowledgeGraph();
  g.addFact({ triple: { subject: "a", predicate: "p", object: "b" }, sourceObjectId: "obj:1" });
  assert.deepEqual(g.neighbors("unknown"), []);
});

// ---------------------------------------------------------------------------
// 5. Canonical order determinism
// ---------------------------------------------------------------------------

test("LocalKnowledgeGraph: canonical order is deterministic across shuffled inserts", () => {
  const facts = [
    { triple: { subject: "c", predicate: "p3", object: "o3" }, sourceObjectId: "src:3" },
    { triple: { subject: "a", predicate: "p1", object: "o1" }, sourceObjectId: "src:1" },
    { triple: { subject: "b", predicate: "p2", object: "o2" }, sourceObjectId: "src:2" },
  ];

  function run(order: number[]): readonly ReturnType<typeof g.match>[0][] {
    const g = new LocalKnowledgeGraph();
    for (const i of order) g.addFact(facts[i]!);
    return g.match({});
  }

  const r1 = run([0, 1, 2]);
  const r2 = run([2, 0, 1]);
  assert.deepEqual(r1, r2);
  assert.equal(r1[0]!.sourceObjectId, "src:1");
  assert.equal(r1[1]!.sourceObjectId, "src:2");
  assert.equal(r1[2]!.sourceObjectId, "src:3");
});

// ---------------------------------------------------------------------------
// 6. createSemantic facade
// ---------------------------------------------------------------------------

test("createSemantic: ingestObject with {text} extracts and tags provenance", async () => {
  const g = new LocalKnowledgeGraph();
  const ext = new DelimitedExtractor();
  const sem = createSemantic({ extractor: ext, graph: g });

  const count = await sem.ingestObject("obj:alpha", { text: "Alice\tknows\tBob\nAlice\tloves\tcode" });
  assert.equal(count, 2);
  assert.equal(g.size(), 2);

  const all = g.match({});
  assert.equal(all[0]!.sourceObjectId, "obj:alpha");
  assert.equal(all[1]!.sourceObjectId, "obj:alpha");
});

test("createSemantic: ingestObject with {triples} bypasses extractor", async () => {
  const g = new LocalKnowledgeGraph();
  const ext = new DelimitedExtractor();
  const sem = createSemantic({ extractor: ext, graph: g });

  const triples = [
    { subject: "X", predicate: "Y", object: "Z" },
  ];
  const count = await sem.ingestObject("obj:1", { triples });
  assert.equal(count, 1);
  assert.equal(g.size(), 1);
});

test("createSemantic: query/neighbors read through the graph", async () => {
  const g = new LocalKnowledgeGraph();
  const ext = new DelimitedExtractor();
  const sem = createSemantic({ extractor: ext, graph: g });

  await sem.ingestObject("obj:1", { text: "Alice\tknows\tBob" });
  const q = sem.query({ subject: "Alice" });
  assert.equal(q.length, 1);
  const n = sem.neighbors("Bob");
  assert.equal(n.length, 1);
});

test("createSemantic: removeObject drops one object's facts", async () => {
  const g = new LocalKnowledgeGraph();
  const ext = new DelimitedExtractor();
  const sem = createSemantic({ extractor: ext, graph: g });

  await sem.ingestObject("obj:1", { text: "a\tb\tc" });
  await sem.ingestObject("obj:2", { text: "d\te\tf" });
  assert.equal(g.size(), 2);

  sem.removeObject("obj:1");
  assert.equal(g.size(), 1);
  assert.equal(g.match({})[0]!.sourceObjectId, "obj:2");
});

// ---------------------------------------------------------------------------
// 7. rebuild
// ---------------------------------------------------------------------------

test("createSemantic: rebuild from async stream reproduces same graph as incremental", async () => {
  const texts = [
    { objectId: "obj:1", text: "Alice\tknows\tBob" },
    { objectId: "obj:2", text: "Bob\twrote\tpaper" },
  ];

  // Incremental
  const g1 = new LocalKnowledgeGraph();
  const sem1 = createSemantic({ extractor: new DelimitedExtractor(), graph: g1 });
  for (const t of texts) await sem1.ingestObject(t.objectId, { text: t.text });
  const incResult = g1.match({});

  // Rebuild
  const g2 = new LocalKnowledgeGraph();
  const sem2 = createSemantic({ extractor: new DelimitedExtractor(), graph: g2 });
  async function* stream() { for (const t of texts) yield t; }
  const count = await sem2.rebuild(stream());
  assert.equal(count, 2);
  assert.deepEqual(g2.match({}), incResult);
});

test("createSemantic: rebuild clears prior state", async () => {
  const g = new LocalKnowledgeGraph();
  const sem = createSemantic({ extractor: new DelimitedExtractor(), graph: g });
  await sem.ingestObject("old", { text: "x\ty\tz" });
  assert.equal(g.size(), 1);

  async function* stream() {
    yield { objectId: "new", text: "a\tb\tc" };
  }
  const count = await sem.rebuild(stream());
  assert.equal(count, 1);
  assert.equal(g.size(), 1);
  const all = g.match({});
  assert.equal(all[0]!.sourceObjectId, "new");
});

test("createSemantic: rebuild over empty stream returns 0, graph empty", async () => {
  const g = new LocalKnowledgeGraph();
  const sem = createSemantic({ extractor: new DelimitedExtractor(), graph: g });
  await sem.ingestObject("pre", { text: "a\tb\tc" });
  async function* empty() {}
  const count = await sem.rebuild(empty());
  assert.equal(count, 0);
  assert.equal(g.size(), 0);
});

// ---------------------------------------------------------------------------
// 8. OUT-OF-ROOT invariant — behavioural
// ---------------------------------------------------------------------------

test("OUT-OF-ROOT: spine scenario root is byte-identical with vs without L3 semantic", async () => {
  // Re-use the spine scenario helpers from scripts/
  const spineModule = await import("../src/spine/spine.js");
  const createSpine = spineModule.createSpine;
  type AppendInput = import("../src/spine/spine.js").AppendInput;
  const { vaultDidFromPubkey, agentDid, ROOT_CAPABILITY_ID } = await import("../src/identity/did.js");
  const { MemSpineStore, MemCAS } = await import("../scripts/mem-store.js");

  // Fixed scenario — same as spine-scenario.ts
  const FIXED_ENC = {
    alg: "AES-256-GCM" as const,
    key_id: "vault-kek-0",
    nonce_b64: "AAAAAAAAAAAAAAAA",
    wrap_b64: "",
  } as const;

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

  // Run WITHOUT L3
  const vaultDid = vaultDidFromPubkey(fixedPubkey());
  const writerDid = agentDid("claude", "golden");
  const store1 = new MemSpineStore();
  const storage1 = new MemCAS();
  const anchor = { anchor: async () => { throw new Error("unused"); }, latest: async () => null };
  const spine1 = createSpine({ store: store1, storage: storage1, anchor });

  let rootWithout: string | undefined;
  let firstObjectId: string | undefined;
  let firstSpaceState: string | undefined;

  for (const input of plan(vaultDid, writerDid)) {
    const r = await spine1.append(input);
    rootWithout = r.vault_memory_root;
    if (!firstObjectId) firstObjectId = r.object_id;
    if (!firstSpaceState) firstSpaceState = r.space_state;
  }

  // Run WITH L3
  const store2 = new MemSpineStore();
  const storage2 = new MemCAS();
  const spine2 = createSpine({ store: store2, storage: storage2, anchor });

  // Build a Semantic facade alongside
  const g = new LocalKnowledgeGraph();
  const sem = createSemantic({ extractor: new DelimitedExtractor(), graph: g });

  let rootWith: string | undefined;
  let firstObjectIdWith: string | undefined;
  let firstSpaceStateWith: string | undefined;

  for (const input of plan(vaultDid, writerDid)) {
    const r = await spine2.append(input);
    rootWith = r.vault_memory_root;
    if (!firstObjectIdWith) firstObjectIdWith = r.object_id;
    if (!firstSpaceStateWith) firstSpaceStateWith = r.space_state;

    // Also build semantic index (text is irrelevant to spine)
    await sem.ingestObject(r.object_id, { text: "dummy\tsubject\tpredicate\tobject" }); // not 3 fields → 0 triples
    // Issue some queries too
    sem.query({});
    sem.neighbors("dummy");
  }

  // Assert byte-identical
  assert.equal(rootWith, rootWithout);
  assert.equal(firstObjectIdWith, firstObjectId);
  assert.equal(firstSpaceStateWith, firstSpaceState);
});

// ---------------------------------------------------------------------------
// 9. OUT-OF-ROOT invariant — structural
// ---------------------------------------------------------------------------

test("OUT-OF-ROOT structural: no spine/canonical file imports semantic", () => {
  const spineFiles = [
    "../src/spine/index.ts",
    "../src/spine/object.ts",
    "../src/spine/space.ts",
    "../src/spine/spine.ts",
    "../src/spine/types.ts",
    "../src/spine/vault.ts",
    "../src/canonical/domains.ts",
    "../src/canonical/errors.ts",
    "../src/canonical/hash.ts",
    "../src/canonical/index.ts",
    "../src/canonical/integers.ts",
    "../src/canonical/jcs.ts",
    "../src/canonical/merkle.ts",
    "../src/canonical/strings.ts",
    "../src/canonical/unicodeAssigned.ts",
  ];

  for (const relPath of spineFiles) {
    const content = readFileSync(
      new URL(relPath, import.meta.url).pathname,
      "utf8",
    );
    // Check for actual module imports of the semantic package, not just the word
    if (
      /import\s+.*from\s+['"].*semantic['"]/.test(content) ||
      /require\s*\(['"].*semantic['"]/.test(content)
    ) {
      assert.fail(`${relPath} imports semantic — violates out-of-root invariant`);
    }
  }
  // Pass: no import found
  assert.ok(true);
});
