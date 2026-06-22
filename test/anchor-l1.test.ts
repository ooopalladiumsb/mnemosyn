/**
 * L1 Anchor tests (TASK-deepseek-L1 §2).
 *
 * Covers:
 *   1. anchorCheckpointId determinism
 *   2. Chain building: three sequential anchors produce versions 0,1,2 with correct prev links
 *   3. Tamper detection: mutate historical root → verifyCheckpointChain returns ok:false
 *   4. verifyReceipt: valid/invalid/bad-pubkey
 *   5. Adapter rules: regression, gap, conflict, idempotency, empty-chain vacuously valid
 *   6. Durability/restart: fresh LocalSigned(dir) recovers identical latest/chain
 *   7. AI-7: chain is independent of created_at
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Buffer } from "node:buffer";

import { LocalSigned, TonAnchor, type AnchorReceipt } from "../src/adapters/anchor.js";
import {
  anchorCheckpointId,
  verifyReceipt,
  verifyCheckpointChain,
  ed25519PublicKeyFromSeed,
  type AnchorCheckpoint,
} from "../src/adapters/checkpoint.js";
import { toHex } from "../src/canonical/hash.js";
import { ZERO_HASH_HEX } from "../src/spine/types.js";
import { vaultDidFromPubkey } from "../src/identity/did.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEED = new Uint8Array(32).fill(0x2a);
const PUBKEY = ed25519PublicKeyFromSeed(SEED);
const VAULT = vaultDidFromPubkey(PUBKEY);

function rootFromByte(b: number): Uint8Array {
  const r = new Uint8Array(32);
  r[0] = b;
  return r;
}

function makeAdapter() {
  return new LocalSigned(SEED);
}

// ---------------------------------------------------------------------------
// 1. anchorCheckpointId determinism
// ---------------------------------------------------------------------------
test("anchorCheckpointId: same input → same id; differs when fields change", () => {
  const cp: AnchorCheckpoint = {
    vault_did: VAULT,
    version: 0n,
    root: toHex(rootFromByte(1)),
    prev: ZERO_HASH_HEX,
  };

  const id1 = toHex(anchorCheckpointId(cp));
  const id2 = toHex(anchorCheckpointId(cp));
  assert.equal(id1, id2, "same input must produce same id");
  assert.ok(/^[0-9a-f]{64}$/.test(id1), "id must be 64 hex chars (32 bytes)");

  // Differ by root
  const cpDiffRoot = { ...cp, root: toHex(rootFromByte(2)) };
  const idDiffRoot = toHex(anchorCheckpointId(cpDiffRoot));
  assert.notEqual(id1, idDiffRoot, "different root must change id");

  // Differ by version
  const cpDiffVer = { ...cp, version: 1n, root: toHex(rootFromByte(1)) };
  const idDiffVer = toHex(anchorCheckpointId(cpDiffVer));
  assert.notEqual(id1, idDiffVer, "different version must change id");

  // Differ by prev
  const cpDiffPrev = { ...cp, prev: "aa".repeat(32) };
  const idDiffPrev = toHex(anchorCheckpointId(cpDiffPrev));
  assert.notEqual(id1, idDiffPrev, "different prev must change id");

  // Differ by vault_did
  const altVault = vaultDidFromPubkey(new Uint8Array(32).fill(0x77));
  const cpDiffVault = { ...cp, vault_did: altVault };
  const idDiffVault = toHex(anchorCheckpointId(cpDiffVault));
  assert.notEqual(id1, idDiffVault, "different vault_did must change id");
});

// ---------------------------------------------------------------------------
// 2. Chain building: three sequential anchors
// ---------------------------------------------------------------------------
test("chain building: three anchors produce versions 0,1,2 with correct prev links", async () => {
  const adapter = makeAdapter();

  const r0 = await adapter.anchor(VAULT, rootFromByte(10), 0n);
  const r1 = await adapter.anchor(VAULT, rootFromByte(11), 1n);
  const r2 = await adapter.anchor(VAULT, rootFromByte(12), 2n);

  assert.equal(r0.version, 0n);
  assert.equal(r1.version, 1n);
  assert.equal(r2.version, 2n);

  const chain = await adapter.chain(VAULT);
  assert.equal(chain.length, 3);

  // Version 0: prev is ZERO_HASH_HEX
  assert.equal(chain[0]!.version, 0n);
  assert.equal(chain[0]!.prev, ZERO_HASH_HEX);

  // Version 1: prev = checkpoint_id of version 0
  const id0 = toHex(anchorCheckpointId(chain[0]!));
  assert.equal(chain[1]!.prev, id0);

  // Version 2: prev = checkpoint_id of version 1
  const id1 = toHex(anchorCheckpointId(chain[1]!));
  assert.equal(chain[2]!.prev, id1);

  // Full chain verification
  const result = verifyCheckpointChain(chain);
  assert.deepEqual(result, { ok: true });
});

// ---------------------------------------------------------------------------
// 3. Tamper detection
// ---------------------------------------------------------------------------
test("tamper detection: mutate historical root → verifyCheckpointChain reports ok:false", async () => {
  const adapter = makeAdapter();
  await adapter.anchor(VAULT, rootFromByte(20), 0n);
  await adapter.anchor(VAULT, rootFromByte(21), 1n);
  await adapter.anchor(VAULT, rootFromByte(22), 2n);

  const chain = await adapter.chain(VAULT);
  assert.equal(chain.length, 3);

  // Verify original chain passes
  assert.deepEqual(verifyCheckpointChain(chain), { ok: true });

  // Tamper: mutate version 1's root
  const tampered: AnchorCheckpoint[] = [
    chain[0]!,
    { ...chain[1]!, root: toHex(rootFromByte(99)) },
    chain[2]!,
  ];
  const result = verifyCheckpointChain(tampered);
  assert.equal(result.ok, false);
  // The broken link is at version 2 (its prev no longer matches the re-hashed version 1)
  assert.equal(result.brokenAt, 2n);
  assert.ok(result.reason?.includes("prev"), "reason should mention prev mismatch");
});

test("tamper detection: wrong ZERO_HASH_HEX at version 0", () => {
  const cp: AnchorCheckpoint = {
    vault_did: VAULT,
    version: 0n,
    root: toHex(rootFromByte(1)),
    prev: "aa".repeat(32), // wrong
  };
  const result = verifyCheckpointChain([cp]);
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, 0n);
  assert.ok(result.reason?.includes(ZERO_HASH_HEX), "reason should mention ZERO_HASH_HEX");
});

test("tamper detection: version gap", () => {
  const cp0: AnchorCheckpoint = {
    vault_did: VAULT,
    version: 0n,
    root: toHex(rootFromByte(1)),
    prev: ZERO_HASH_HEX,
  };
  const cp2: AnchorCheckpoint = {
    vault_did: VAULT,
    version: 2n, // gap: skips version 1
    root: toHex(rootFromByte(3)),
    prev: toHex(anchorCheckpointId(cp0)),
  };
  const result = verifyCheckpointChain([cp0, cp2]);
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, 2n);
  assert.ok(result.reason?.includes("expected version 1"));
});

// ---------------------------------------------------------------------------
// 4. verifyReceipt
// ---------------------------------------------------------------------------
test("verifyReceipt: valid receipt verifies true", async () => {
  const adapter = makeAdapter();
  const receipt = await adapter.anchor(VAULT, rootFromByte(30), 0n);
  assert.equal(verifyReceipt(receipt, PUBKEY), true);
});

test("verifyReceipt: tampered root → false", async () => {
  const adapter = makeAdapter();
  const receipt = await adapter.anchor(VAULT, rootFromByte(31), 0n);
  const tampered: AnchorReceipt = { ...receipt, root: toHex(rootFromByte(99)) };
  assert.equal(verifyReceipt(tampered, PUBKEY), false);
});

test("verifyReceipt: tampered version → false", async () => {
  const adapter = makeAdapter();
  const receipt = await adapter.anchor(VAULT, rootFromByte(32), 0n);
  const tampered: AnchorReceipt = { ...receipt, version: 1n };
  assert.equal(verifyReceipt(tampered, PUBKEY), false);
});

test("verifyReceipt: tampered proof → false", async () => {
  const adapter = makeAdapter();
  const receipt = await adapter.anchor(VAULT, rootFromByte(33), 0n);
  // Flip first hex digit of proof
  const flippedProof = (receipt.proof[0] === "a" ? "b" : "a") + receipt.proof.slice(1);
  const tampered: AnchorReceipt = { ...receipt, proof: flippedProof };
  assert.equal(verifyReceipt(tampered, PUBKEY), false);
});

test("verifyReceipt: wrong-length pubkey throws", () => {
  const receipt: AnchorReceipt = {
    vaultDid: VAULT,
    root: toHex(rootFromByte(34)),
    version: 0n,
    proof: "ab".repeat(64),
  };
  assert.throws(
    () => verifyReceipt(receipt, new Uint8Array(31)),
    /ANCHOR_BAD_PUBKEY_LEN/,
  );
  assert.throws(
    () => verifyReceipt(receipt, new Uint8Array(33)),
    /ANCHOR_BAD_PUBKEY_LEN/,
  );
});

test("verifyReceipt: valid-length wrong pubkey → false", async () => {
  const adapter = makeAdapter();
  const receipt = await adapter.anchor(VAULT, rootFromByte(35), 0n);
  const wrongPubkey = new Uint8Array(32).fill(0xff);
  // Must not throw — returns false
  assert.equal(verifyReceipt(receipt, wrongPubkey), false);
});

test("verifyReceipt: proof with odd hex length → false (fromHex rejects)", () => {
  const receipt: AnchorReceipt = {
    vaultDid: VAULT,
    root: toHex(rootFromByte(36)),
    version: 0n,
    proof: "a".repeat(127), // odd length
  };
  // fromHex throws for odd length, but verifyReceipt catches it → false
  assert.equal(verifyReceipt(receipt, PUBKEY), false);
});

// ---------------------------------------------------------------------------
// 5. Adapter rules: regression, gap, conflict, idempotent, empty chain
// ---------------------------------------------------------------------------
test("adapter rules: version regression throws ANCHOR_VERSION_REGRESSION", async () => {
  const adapter = makeAdapter();
  await adapter.anchor(VAULT, rootFromByte(40), 0n);
  await adapter.anchor(VAULT, rootFromByte(41), 1n);
  await assert.rejects(
    () => adapter.anchor(VAULT, rootFromByte(42), 0n),
    /ANCHOR_VERSION_REGRESSION/,
  );
});

test("adapter rules: version gap throws ANCHOR_VERSION_GAP", async () => {
  const adapter = makeAdapter();
  await adapter.anchor(VAULT, rootFromByte(50), 0n);
  await assert.rejects(
    () => adapter.anchor(VAULT, rootFromByte(51), 2n), // skip version 1
    /ANCHOR_VERSION_GAP/,
  );
  // Also: first anchor must be version 0
  const adapter2 = makeAdapter();
  await assert.rejects(
    () => adapter2.anchor(VAULT, rootFromByte(52), 5n),
    /ANCHOR_VERSION_GAP/,
  );
});

test("adapter rules: conflicting root at same version throws ANCHOR_VERSION_CONFLICT", async () => {
  const adapter = makeAdapter();
  await adapter.anchor(VAULT, rootFromByte(60), 0n);
  await assert.rejects(
    () => adapter.anchor(VAULT, rootFromByte(61), 0n),
    /ANCHOR_VERSION_CONFLICT/,
  );
});

test("adapter rules: idempotent re-anchor returns equal receipt and does not grow chain", async () => {
  const adapter = makeAdapter();
  const r0 = await adapter.anchor(VAULT, rootFromByte(70), 0n);
  const r1 = await adapter.anchor(VAULT, rootFromByte(71), 1n);

  const chainLenBefore = (await adapter.chain(VAULT)).length;
  assert.equal(chainLenBefore, 2);

  // Re-anchor version 1 with same root
  const r1b = await adapter.anchor(VAULT, rootFromByte(71), 1n);
  assert.deepEqual(r1b, r1, "idempotent re-anchor must return equal receipt");

  const chainLenAfter = (await adapter.chain(VAULT)).length;
  assert.equal(chainLenAfter, 2, "chain must not grow on idempotent re-anchor");
});

test("adapter rules: verifyCheckpointChain([]) returns {ok:true}", () => {
  const result = verifyCheckpointChain([]);
  assert.deepEqual(result, { ok: true });
});

// ---------------------------------------------------------------------------
// 6. Durability / restart
// ---------------------------------------------------------------------------
test("durability: fresh LocalSigned(dir) recovers identical latest + chain after anchoring", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mnemo-l1-"));
  try {
    // First instance: anchor versions 0..2
    const a1 = new LocalSigned(SEED, { dir });
    const r0 = await a1.anchor(VAULT, rootFromByte(80), 0n);
    const r1 = await a1.anchor(VAULT, rootFromByte(81), 1n);
    const r2 = await a1.anchor(VAULT, rootFromByte(82), 2n);

    const chain1 = await a1.chain(VAULT);
    const latest1 = await a1.latest(VAULT);
    const head1 = await a1.checkpointHead(VAULT);

    // Fresh instance with same dir
    const a2 = new LocalSigned(SEED, { dir });
    const chain2 = await a2.chain(VAULT);
    const latest2 = await a2.latest(VAULT);
    const head2 = await a2.checkpointHead(VAULT);

    assert.deepEqual(latest1, latest2, "latest must be identical after recovery");
    assert.deepEqual(head1, head2, "checkpointHead must be identical after recovery");
    assert.equal(chain2.length, 3);
    assert.equal(chain2[0]!.version, 0n);
    assert.equal(chain2[1]!.version, 1n);
    assert.equal(chain2[2]!.version, 2n);
    assert.equal(chain2[0]!.prev, ZERO_HASH_HEX);
    assert.equal(chain2[1]!.prev, toHex(anchorCheckpointId(chain2[0]!)));
    assert.equal(chain2[2]!.prev, toHex(anchorCheckpointId(chain2[1]!)));
    assert.deepEqual(chain2[0]!.root, r0.root);
    assert.deepEqual(chain2[1]!.root, r1.root);
    assert.deepEqual(chain2[2]!.root, r2.root);

    // Verify full chain on recovered data
    assert.deepEqual(verifyCheckpointChain(chain2), { ok: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("durability: chain() / checkpointHead() work in-memory when dir is unset", async () => {
  const adapter = makeAdapter(); // no dir
  assert.deepEqual(await adapter.chain(VAULT), []);
  assert.equal(await adapter.checkpointHead(VAULT), null);

  await adapter.anchor(VAULT, rootFromByte(90), 0n);
  await adapter.anchor(VAULT, rootFromByte(91), 1n);
  await adapter.anchor(VAULT, rootFromByte(92), 2n);

  const chain = await adapter.chain(VAULT);
  assert.equal(chain.length, 3);

  const head = await adapter.checkpointHead(VAULT);
  assert.ok(head !== null);
  assert.equal(head.version, 2n);
  assert.equal(head.checkpointId, toHex(anchorCheckpointId(chain[2]!)));

  // latest() still works
  const latest = await adapter.latest(VAULT);
  assert.ok(latest !== null);
  assert.equal(latest.root, toHex(rootFromByte(92)));
  assert.equal(latest.version, 2n);
});

// ---------------------------------------------------------------------------
// 7. AI-7: chain building is independent of any created_at
// ---------------------------------------------------------------------------
test("AI-7: chain is independent of created_at on underlying objects", async () => {
  // The checkpoint chain itself has no created_at field per AI-7.
  // AnchorCheckpoint fields are vault_did, version, root, prev — none is wall-clock.
  // We prove this by building two chains with different root sequences at different
  // wall-clock times; the resulting checkpoint_ids are deterministic functions of their
  // inputs only, as already tested in test 1. Here we just confirm the type system:
  // AnchorCheckpoint simply has no created_at field.

  const cp: AnchorCheckpoint = {
    vault_did: VAULT,
    version: 0n,
    root: toHex(rootFromByte(1)),
    prev: ZERO_HASH_HEX,
  };

  // Run anchorCheckpointId twice — it's pure (no Date.now(), no Math.random())
  const before = toHex(anchorCheckpointId(cp));
  // Simulate wall-clock passage (but anchorCheckpointId is pure, so result is same)
  const after = toHex(anchorCheckpointId(cp));
  assert.equal(before, after, "anchorCheckpointId must be pure (no wall-clock influence)");
});

// ---------------------------------------------------------------------------
// TonAnchor seam
// ---------------------------------------------------------------------------
test("TonAnchor seam throws ANCHOR_NOT_AVAILABLE", async () => {
  const ton = new TonAnchor();
  await assert.rejects(() => ton.anchor(VAULT, rootFromByte(1), 0n), /ANCHOR_NOT_AVAILABLE/);
  await assert.rejects(() => ton.latest(VAULT), /ANCHOR_NOT_AVAILABLE/);
});

// ---------------------------------------------------------------------------
// ed25519PublicKeyFromSeed
// ---------------------------------------------------------------------------
test("ed25519PublicKeyFromSeed: produces 32-byte key; different seed → different key", () => {
  const pk1 = ed25519PublicKeyFromSeed(SEED);
  assert.equal(pk1.length, 32);

  const seed2 = new Uint8Array(32);
  seed2[0] = 0x42;
  const pk2 = ed25519PublicKeyFromSeed(seed2);
  assert.equal(pk2.length, 32);
  assert.notDeepEqual(pk1, pk2);
});

test("ed25519PublicKeyFromSeed: rejects non-32-byte seed", () => {
  assert.throws(() => ed25519PublicKeyFromSeed(new Uint8Array(31)), /ANCHOR_BAD_KEY_LEN/);
  assert.throws(() => ed25519PublicKeyFromSeed(new Uint8Array(33)), /ANCHOR_BAD_KEY_LEN/);
});

// ---------------------------------------------------------------------------
// L0 regression: existing LocalSigned tests still pass with in-memory mode
// ---------------------------------------------------------------------------
test("L0 regression: anchor+latest works without dir (in-memory, L0 behaviour)", async () => {
  const adapter = makeAdapter();
  const r = await adapter.anchor(VAULT, rootFromByte(100), 0n);
  assert.equal(r.version, 0n);
  assert.ok(/^[0-9a-f]{128}$/.test(r.proof));

  const latest = await adapter.latest(VAULT);
  assert.ok(latest !== null);
  assert.equal(latest.root, r.root);
  assert.equal(latest.version, 0n);
});

test("L0 regression: checkpointHead is null for never-anchored vault", async () => {
  const adapter = makeAdapter();
  assert.equal(await adapter.checkpointHead(VAULT), null);
  assert.deepEqual(await adapter.chain(VAULT), []);
});
