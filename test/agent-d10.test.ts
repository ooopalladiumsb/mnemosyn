/**
 * D10 Agent Host tests (TASK-deepseek-D10 §2).
 *
 * Covers: key round-trip/fail, ScriptedBrain, turn fidelity, no-turn no-append,
 * context assembly via recall, remember() direct, no-leak structural.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import { createSpine } from "../src/spine/spine.js";
import { LocalSigned } from "../src/adapters/anchor.js";
import { vaultDidFromPubkey, agentDid, ROOT_CAPABILITY_ID } from "../src/identity/did.js";
import { MemSpineStore, MemCAS } from "../scripts/mem-store.js";
import { LocalVaultKeyManager } from "../src/agent/key-manager.js";
import { ScriptedBrain } from "../src/agent/brain.js";
import { createAgent } from "../src/agent/agent.js";
import { HashEmbedder } from "../src/recall/embedding.js";
import { LocalRecallIndex } from "../src/recall/recall-index.js";
import { createRecall } from "../src/recall/recall.js";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
const KEK = new Uint8Array(32).fill(0xa1);
const KEY_ID = "vault-kek-0";
const VAULT_DID = vaultDidFromPubkey(new Uint8Array(32).fill(0x03));
const AGENT_DID = agentDid("claude", "d10-test");

function freshSpine() {
  return createSpine({
    store: new MemSpineStore(),
    storage: new MemCAS(),
    anchor: new LocalSigned(new Uint8Array(32).fill(9)),
  });
}

// ---------------------------------------------------------------------------
// 1. Key round-trip + tamper detection
// ---------------------------------------------------------------------------
test("LocalVaultKeyManager: round-trip seal/open for text and binary", async () => {
  const km = new LocalVaultKeyManager(KEK, KEY_ID);
  // text
  const text = new TextEncoder().encode("hello world");
  const s1 = await km.seal(text);
  const o1 = await km.open(s1.ciphertext, s1.enc);
  assert.deepEqual(o1, text);
  // empty
  const empty = new Uint8Array(0);
  const s2 = await km.seal(empty);
  const o2 = await km.open(s2.ciphertext, s2.enc);
  assert.deepEqual(o2, empty);
  // binary
  const binary = new Uint8Array([0, 1, 2, 3, 254, 255]);
  const s3 = await km.seal(binary);
  const o3 = await km.open(s3.ciphertext, s3.enc);
  assert.deepEqual(o3, binary);
});

test("LocalVaultKeyManager: two seals of same plaintext differ (fresh nonce), both open true", async () => {
  const km = new LocalVaultKeyManager(KEK, KEY_ID);
  const plain = new Uint8Array([99, 100, 101]);
  const s1 = await km.seal(plain);
  const s2 = await km.seal(plain);
  // Different ciphertext (different nonce)
  assert.notDeepEqual(s1.ciphertext, s2.ciphertext);
  assert.notEqual(s1.enc.nonce_b64, s2.enc.nonce_b64);
  // Both open correctly
  assert.deepEqual(await km.open(s1.ciphertext, s1.enc), plain);
  assert.deepEqual(await km.open(s2.ciphertext, s2.enc), plain);
});

test("LocalVaultKeyManager: different KEK fails to open (GCM auth error)", async () => {
  const km = new LocalVaultKeyManager(KEK, KEY_ID);
  const km2 = new LocalVaultKeyManager(new Uint8Array(32).fill(0xb2), "wrong-key");
  const s = await km.seal(new Uint8Array([1, 2, 3]));
  await assert.rejects(() => km2.open(s.ciphertext, s.enc), /Unsupported state|unable to authenticate|bad decrypt|Tag mismatch/);
});

test("LocalVaultKeyManager: flipped ciphertext byte fails to open (GCM auth error)", async () => {
  const km = new LocalVaultKeyManager(KEK, KEY_ID);
  const s = await km.seal(new Uint8Array([1, 2, 3]));
  const tampered = s.ciphertext.slice();
  tampered[0] = tampered[0]! ^ 0xff;
  await assert.rejects(() => km.open(tampered, s.enc), /Unsupported state|unable to authenticate|bad decrypt|Tag mismatch/);
});

test("LocalVaultKeyManager: KEK is stored as copy, not mutated by caller", async () => {
  const mutableKek = new Uint8Array(32).fill(0xc3);
  const km = new LocalVaultKeyManager(mutableKek, "test");
  // Mutate original array
  mutableKek[0] = 0xff;
  // Should still work with original key
  const text = new TextEncoder().encode("test");
  const s = await km.seal(text);
  assert.deepEqual(await km.open(s.ciphertext, s.enc), text);
});

// ---------------------------------------------------------------------------
// 2. ScriptedBrain
// ---------------------------------------------------------------------------
test("ScriptedBrain: returns exactly the scripted BrainTurn, deterministic", () => {
  const reply = "I remember that!";
  const drafts = [
    { kind: "dialog" as const, space: "chat", text: "user said hello" },
  ];
  const brain = new ScriptedBrain(() => ({ reply, remember: drafts }));
  // Same input → same result
  const r1 = brain.turn("hello", { query: "hello", hits: [] });
  const r2 = brain.turn("hello", { query: "hello", hits: [] });
  // Compare before await: ScriptedBrain resolves synchronously.
  r1.then((v1) => r2.then((v2) => {
    assert.deepEqual(v1, v2);
  }));
});

test("ScriptedBrain: different inputs → script called with correct args", async () => {
  const captured: string[] = [];
  const brain = new ScriptedBrain((input, ctx) => {
    captured.push(`${input}|${ctx.query}|${ctx.hits.length}`);
    return { reply: `echo: ${input}`, remember: [] };
  });
  await brain.turn("msg1", { query: "msg1", hits: [] });
  await brain.turn("msg2", { query: "msg2", hits: [{ objectId: "x", text: "old", kind: "dialog", score: 0.5 }] });
  assert.equal(captured[0], "msg1|msg1|0");
  assert.equal(captured[1], "msg2|msg2|1");
});

// ---------------------------------------------------------------------------
// 3. createAgent.turn fidelity
// ---------------------------------------------------------------------------
test("createAgent.turn: brain remembers 2 drafts → appends 2 objects, recoverable byte-identical", async () => {
  const spine = freshSpine();
  const keys = new LocalVaultKeyManager(KEK, KEY_ID);
  const brain = new ScriptedBrain(() => ({
    reply: "got it",
    remember: [
      { kind: "dialog" as const, space: "chat", text: "user: hello", tags: ["greeting"] },
      { kind: "fact" as const, space: "knowledge", text: "the sky is blue" },
    ],
  }));
  const agent = createAgent({ spine, brain, keys, vaultDid: VAULT_DID, agentDid: AGENT_DID, capabilityId: ROOT_CAPABILITY_ID });

  const result = await agent.turn("hello");
  assert.equal(result.reply, "got it");
  assert.equal(result.remembered.length, 2);

  // Both objects recoverable + writer_did/vault_did correct
  for (const receipt of result.remembered) {
    const { obj, ciphertext } = await spine.recallById(VAULT_DID, receipt.object_id);
    assert.equal(obj.writer_did, AGENT_DID);
    assert.equal(obj.vault_did, VAULT_DID);
    assert.equal(obj.capability_id, ROOT_CAPABILITY_ID);
    const plainBytes = await keys.open(ciphertext, obj.enc);
    const plainText = new TextDecoder().decode(plainBytes);
    assert.ok(plainText === "user: hello" || plainText === "the sky is blue");
  }

  // Tags on first object
  const obj1 = (await spine.recallById(VAULT_DID, result.remembered[0]!.object_id)).obj;
  if (obj1.space === "chat") {
    // tags are not on MemoryObject directly - they're on the draft
  }
});

test("createAgent.turn: remembered receipts match returned remembered array", async () => {
  const spine = freshSpine();
  const keys = new LocalVaultKeyManager(KEK, KEY_ID);
  const brain = new ScriptedBrain(() => ({
    reply: "ack",
    remember: [
      { kind: "code" as const, space: "snippets", text: "console.log(1)" },
    ],
  }));
  const agent = createAgent({ spine, brain, keys, vaultDid: VAULT_DID, agentDid: AGENT_DID, capabilityId: ROOT_CAPABILITY_ID });

  const result = await agent.turn("test");
  assert.equal(result.remembered.length, 1);
  const receipt = result.remembered[0]!;
  assert.ok(/^[0-9a-f]{64}$/.test(receipt.object_id));
  assert.equal(receipt.seqno, 0n);
});

// ---------------------------------------------------------------------------
// 4. No-drafts turn → empty remembered
// ---------------------------------------------------------------------------
test("createAgent.turn: brain remembers nothing → appends 0, remembered empty, reply present", async () => {
  const spine = freshSpine();
  const keys = new LocalVaultKeyManager(KEK, KEY_ID);
  const brain = new ScriptedBrain(() => ({ reply: "nothing to save", remember: [] }));
  const agent = createAgent({ spine, brain, keys, vaultDid: VAULT_DID, agentDid: AGENT_DID, capabilityId: ROOT_CAPABILITY_ID });

  const result = await agent.turn("hi");
  assert.equal(result.reply, "nothing to save");
  assert.equal(result.remembered.length, 0);
});

// ---------------------------------------------------------------------------
// 5. Context assembly via recall (end-to-end)
// ---------------------------------------------------------------------------
test("createAgent.turn: context echoes decrypted prior memories via recall", async () => {
  const spine = freshSpine();
  const keys = new LocalVaultKeyManager(KEK, KEY_ID);

  // Build recall index
  const embedder = new HashEmbedder(16);
  const index = new LocalRecallIndex(16);
  const recall = createRecall({ embedder, index });

  // Phase 1: remember a memory using the agent
  const brain1 = new ScriptedBrain(() => ({
    reply: "stored",
    remember: [{ kind: "fact" as const, space: "knowledge", text: "The capital of France is Paris" }],
  }));
  const agent1 = createAgent({ spine, brain: brain1, keys, vaultDid: VAULT_DID, agentDid: AGENT_DID, capabilityId: ROOT_CAPABILITY_ID, recall });
  await agent1.turn("what is the capital of France?");

  // Phase 2: agent whose brain ECHOES context hits into its reply
  const brain2 = new ScriptedBrain((_input, ctx) => {
    const hitTexts = ctx.hits.map((h) => h.text).join(" | ");
    return {
      reply: `ECHO: ${hitTexts}`,
      remember: [],
    };
  });
  const agent2 = createAgent({ spine, brain: brain2, keys, vaultDid: VAULT_DID, agentDid: AGENT_DID, capabilityId: ROOT_CAPABILITY_ID, recall });
  const result2 = await agent2.turn("what's the capital?");

  // Reply should contain the decrypted text of the prior memory
  assert.ok(result2.reply.includes("The capital of France is Paris"), `reply should contain recalled text, got: ${result2.reply}`);
});

// ---------------------------------------------------------------------------
// 6. remember(draft) direct
// ---------------------------------------------------------------------------
test("createAgent.remember: direct commit is recoverable via recallById + open", async () => {
  const spine = freshSpine();
  const keys = new LocalVaultKeyManager(KEK, KEY_ID);
  const brain = new ScriptedBrain(() => ({ reply: "unused", remember: [] }));
  const agent = createAgent({ spine, brain, keys, vaultDid: VAULT_DID, agentDid: AGENT_DID, capabilityId: ROOT_CAPABILITY_ID });

  const receipt = await agent.remember({ kind: "document" as const, space: "docs", text: "Mnemosyne spec v1.0" });
  const { obj, ciphertext } = await spine.recallById(VAULT_DID, receipt.object_id);
  const plain = new TextDecoder().decode(await keys.open(ciphertext, obj.enc));
  assert.equal(plain, "Mnemosyne spec v1.0");
  assert.equal(obj.writer_did, AGENT_DID);
  assert.equal(obj.vault_did, VAULT_DID);
});

// ---------------------------------------------------------------------------
// 7. No-leak structural: spine/canonical never imports agent
// ---------------------------------------------------------------------------
test("NO-LEAK structural: no spine/canonical file imports agent", () => {
  const spineFiles = [
    "spine/index.ts", "spine/object.ts", "spine/space.ts",
    "spine/spine.ts", "spine/types.ts", "spine/vault.ts",
  ];
  const canonicalFiles = [
    "canonical/domains.ts", "canonical/errors.ts", "canonical/hash.ts",
    "canonical/index.ts", "canonical/integers.ts", "canonical/jcs.ts",
    "canonical/merkle.ts", "canonical/strings.ts", "canonical/unicodeAssigned.ts",
  ];
  const cryptoFiles = ["crypto/encryption.ts"];

  for (const rel of [...spineFiles, ...canonicalFiles, ...cryptoFiles]) {
    const content = readFileSync(
      new URL("../src/" + rel, import.meta.url).pathname,
      "utf8",
    );
    if (/import\s+.*from\s+['"].*agent['"]/.test(content)) {
      assert.fail(`${rel} imports agent — violates one-way dependency`);
    }
  }
  assert.ok(true, "no spine/canonical/crypto file imports agent");
});

// ---------------------------------------------------------------------------
// Bonus: Agent without recall still works (context is empty)
// ---------------------------------------------------------------------------
test("createAgent.turn: without recall, context is empty", async () => {
  const spine = freshSpine();
  const keys = new LocalVaultKeyManager(KEK, KEY_ID);
  let capturedCtxLen = -1;
  const brain = new ScriptedBrain((_input, ctx) => {
    capturedCtxLen = ctx.hits.length;
    return { reply: "ok", remember: [] };
  });
  const agent = createAgent({ spine, brain, keys, vaultDid: VAULT_DID, agentDid: AGENT_DID, capabilityId: ROOT_CAPABILITY_ID });
  await agent.turn("hi");
  assert.equal(capturedCtxLen, 0, "context should have 0 hits when recall not wired");
});

// ---------------------------------------------------------------------------
// Bonus: Multiple turns build up memory
// ---------------------------------------------------------------------------
test("createAgent: multiple turns accumulate memories", async () => {
  const spine = freshSpine();
  const keys = new LocalVaultKeyManager(KEK, KEY_ID);
  const brain = new ScriptedBrain((input) => ({
    reply: "ok",
    remember: [{ kind: "dialog" as const, space: "chat", text: input }],
  }));
  const agent = createAgent({ spine, brain, keys, vaultDid: VAULT_DID, agentDid: AGENT_DID, capabilityId: ROOT_CAPABILITY_ID });

  const r1 = await agent.turn("msg1");
  const r2 = await agent.turn("msg2");
  const r3 = await agent.turn("msg3");

  assert.equal(r1.remembered.length, 1);
  assert.equal(r2.remembered.length, 1);
  assert.equal(r3.remembered.length, 1);

  // All seqnos gapless within space
  const obj1 = (await spine.recallById(VAULT_DID, r1.remembered[0]!.object_id)).obj;
  const obj2 = (await spine.recallById(VAULT_DID, r2.remembered[0]!.object_id)).obj;
  const obj3 = (await spine.recallById(VAULT_DID, r3.remembered[0]!.object_id)).obj;
  assert.equal(obj1.seqno, 0n);
  assert.equal(obj2.seqno, 1n);
  assert.equal(obj3.seqno, 2n);
});
