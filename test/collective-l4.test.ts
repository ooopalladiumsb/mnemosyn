/**
 * L4 Collective tests (TASK-deepseek-L4 §2).
 *
 * Covers:
 *   1. capabilityId determinism + parent-omission
 *   1b. issueGrant + verifyGrant (valid, tampered, bad pubkey, wrong vault)
 *   2. grantAuthorizes scope checks
 *   3. AuthorizingSpine happy path
 *   4. AuthorizingSpine rejections (each coded error)
 *   5. Multi-writer: two agents with different scope grants
 *   6. Spine untouched: same vault_memory_root with vs without L4 facade
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import { createSpine, type AppendInput } from "../src/spine/spine.js";
import { LocalSigned } from "../src/adapters/anchor.js";
import { ed25519PublicKeyFromSeed } from "../src/adapters/checkpoint.js";
import { vaultDidFromPubkey, agentDid, ROOT_CAPABILITY_ID } from "../src/identity/did.js";
import type { EncMeta } from "../src/spine/types.js";
import { MemSpineStore, MemCAS } from "../scripts/mem-store.js";
import {
  capabilityId,
  issueGrant,
  verifyGrant,
  grantAuthorizes,
  type Capability,
  type CapabilityGrant,
} from "../src/collective/capability.js";
import { createAuthorizingSpine } from "../src/collective/authorizing-spine.js";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const FIXED_SEED = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1));
const PUBKEY = ed25519PublicKeyFromSeed(FIXED_SEED);
const VAULT_DID = vaultDidFromPubkey(PUBKEY);
const ENC: EncMeta = { alg: "AES-256-GCM", key_id: "k", nonce_b64: "AAAAAAAAAAAAAAAA", wrap_b64: "" };

/** Build a minimal Capability for the given grantee and scope. */
function makeCap(grantee: string, spaces: readonly string[] | "*"): Capability {
  return {
    schema_version: 1,
    vault_did: VAULT_DID,
    grantee,
    scope: { spaces, actions: ["append"] },
  };
}

/** Create a fresh MemSpineStore-based Spine + wrap in AuthorizingSpine. */
function freshAuthSpine() {
  const spine = createSpine({
    store: new MemSpineStore(),
    storage: new MemCAS(),
    anchor: new LocalSigned(new Uint8Array(32).fill(9)),
  });
  return createAuthorizingSpine({ spine, authorityPublicKey: PUBKEY });
}

/** Build an AppendInput for the given space using a grant's capability_id. */
function authInput(grant: CapabilityGrant, space: string): AppendInput {
  return {
    vaultDid: VAULT_DID,
    space,
    kind: "dialog",
    ciphertext: new Uint8Array([1, 2, 3]),
    enc: ENC,
    writerDid: grant.capability.grantee,
    capabilityId: grant.capability_id,
  };
}

// ---------------------------------------------------------------------------
// 1. capabilityId determinism
// ---------------------------------------------------------------------------

test("capabilityId: same cap → same id; differs when fields change", () => {
  const a = makeCap("agent:claude:alice", ["dialog"]);
  const b = makeCap("agent:claude:alice", ["dialog"]);
  const c = makeCap("agent:claude:bob", ["dialog"]);
  const d = makeCap("agent:claude:alice", ["code"]);

  const idA = Buffer.from(capabilityId(a)).toString("hex");
  assert.equal(idA, Buffer.from(capabilityId(b)).toString("hex"), "identical caps should have same id");
  assert.notEqual(idA, Buffer.from(capabilityId(c)).toString("hex"), "different grantee → different id");
  assert.notEqual(idA, Buffer.from(capabilityId(d)).toString("hex"), "different scope spaces → different id");
});

test("capabilityId: parent-omission rule — cap with parent:undefined equals cap omitting parent", () => {
  const withParent: Capability = { ...makeCap("agent:claude:alice", ["dialog"]), parent: undefined };
  const withoutParent: Capability = makeCap("agent:claude:alice", ["dialog"]);
  // The JCS helper omits `parent` when undefined — both should canonicalize identically.
  const idWith = Buffer.from(capabilityId(withParent)).toString("hex");
  const idWithout = Buffer.from(capabilityId(withoutParent)).toString("hex");
  assert.equal(idWith, idWithout, "parent:undefined should be same as omitted parent");
});

test("capabilityId: pure — no wall-clock, same inputs → same id across calls", () => {
  const cap = makeCap("agent:claude:alice", ["dialog"]);
  const ids = Array.from({ length: 10 }, () => Buffer.from(capabilityId(cap)).toString("hex"));
  assert.ok(ids.every((id) => id === ids[0]));
});

// ---------------------------------------------------------------------------
// 1b. issueGrant + verifyGrant
// ---------------------------------------------------------------------------
test("issueGrant + verifyGrant: valid grant verifies true", () => {
  const cap = makeCap("agent:claude:alice", ["dialog"]);
  const grant = issueGrant(cap, FIXED_SEED);
  assert.equal(grant.capability_id, Buffer.from(capabilityId(cap)).toString("hex"));
  assert.equal(verifyGrant(grant, PUBKEY), true);
});

test("verifyGrant: tampered capability_id → false", () => {
  const grant = issueGrant(makeCap("agent:claude:alice", ["dialog"]), FIXED_SEED);
  assert.equal(verifyGrant({ ...grant, capability_id: grant.capability_id.replace("a", "b") }, PUBKEY), false);
});

test("verifyGrant: tampered proof → false", () => {
  const grant = issueGrant(makeCap("agent:claude:alice", ["dialog"]), FIXED_SEED);
  assert.equal(verifyGrant({ ...grant, proof: grant.proof.replace("a", "b") }, PUBKEY), false);
});

test("verifyGrant: tampered capability grantee → false", () => {
  const grant = issueGrant(makeCap("agent:claude:alice", ["dialog"]), FIXED_SEED);
  const badCap = { ...grant.capability, grantee: "agent:claude:bob" };
  assert.equal(verifyGrant({ ...grant, capability: badCap }, PUBKEY), false);
});

test("verifyGrant: wrong-length pubkey throws", () => {
  const grant = issueGrant(makeCap("agent:claude:alice", ["dialog"]), FIXED_SEED);
  assert.throws(() => verifyGrant(grant, new Uint8Array(31)), /BAD_PUBKEY_LEN/);
});

test("verifyGrant: valid-length wrong pubkey → false", () => {
  const grant = issueGrant(makeCap("agent:claude:alice", ["dialog"]), FIXED_SEED);
  assert.equal(verifyGrant(grant, new Uint8Array(32).fill(0xff)), false);
});

test("verifyGrant: vault_did ≠ vaultDidFromPubkey(pk) → false", () => {
  const seed2 = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 99));
  const pk2 = ed25519PublicKeyFromSeed(seed2);
  const cap: Capability = makeCap("agent:claude:alice", ["dialog"]);
  const grant = issueGrant(cap, FIXED_SEED);
  assert.equal(verifyGrant(grant, pk2), false);
});

// ---------------------------------------------------------------------------
// 2. grantAuthorizes scope checks
// ---------------------------------------------------------------------------
test("grantAuthorizes: in-scope explicit space → true", () => {
  const cap = makeCap("agent:claude:alice", ["dialog", "code"]);
  const grant = issueGrant(cap, FIXED_SEED);
  assert.equal(grantAuthorizes(grant, { vaultDid: VAULT_DID, space: "dialog", action: "append", writerDid: "agent:claude:alice" }), true);
  assert.equal(grantAuthorizes(grant, { vaultDid: VAULT_DID, space: "code", action: "append", writerDid: "agent:claude:alice" }), true);
});

test("grantAuthorizes: wildcard '*' → true", () => {
  const grant = issueGrant(makeCap("agent:claude:alice", "*"), FIXED_SEED);
  assert.equal(grantAuthorizes(grant, { vaultDid: VAULT_DID, space: "anything", action: "append", writerDid: "agent:claude:alice" }), true);
});

test("grantAuthorizes: wrong grantee → false", () => {
  const grant = issueGrant(makeCap("agent:claude:alice", ["dialog"]), FIXED_SEED);
  assert.equal(grantAuthorizes(grant, { vaultDid: VAULT_DID, space: "dialog", action: "append", writerDid: "agent:claude:bob" }), false);
});

test("grantAuthorizes: wrong vault → false", () => {
  const grant = issueGrant(makeCap("agent:claude:alice", ["dialog"]), FIXED_SEED);
  assert.equal(grantAuthorizes(grant, { vaultDid: "memory://vault/other", space: "dialog", action: "append", writerDid: "agent:claude:alice" }), false);
});

test("grantAuthorizes: out-of-scope space → false", () => {
  const grant = issueGrant(makeCap("agent:claude:alice", ["dialog"]), FIXED_SEED);
  assert.equal(grantAuthorizes(grant, { vaultDid: VAULT_DID, space: "code", action: "append", writerDid: "agent:claude:alice" }), false);
});

// ---------------------------------------------------------------------------
// 3. AuthorizingSpine happy path
// ---------------------------------------------------------------------------
test("AuthorizingSpine: authorized append succeeds", async () => {
  const auth = freshAuthSpine();
  const cap = makeCap("agent:claude:alice", ["dialog"]);
  const grant = issueGrant(cap, FIXED_SEED);
  const r = await auth.append(authInput(grant, "dialog"), grant);
  assert.ok(/^[0-9a-f]{64}$/.test(r.object_id));
  const recalled = await auth.recallById(VAULT_DID, r.object_id);
  assert.equal(recalled.obj.writer_did, "agent:claude:alice");
  assert.equal(recalled.obj.capability_id, grant.capability_id);
});

// ---------------------------------------------------------------------------
// 4. AuthorizingSpine rejections
// ---------------------------------------------------------------------------
test("AuthorizingSpine: bad sig → [COLLECTIVE_BAD_GRANT]", async () => {
  const auth = freshAuthSpine();
  const grant = issueGrant(makeCap("agent:claude:alice", ["dialog"]), FIXED_SEED);
  const badGrant = { ...grant, proof: grant.proof.replace("a", "b") };
  await assert.rejects(() => auth.append(authInput(grant, "dialog"), badGrant), /COLLECTIVE_BAD_GRANT/);
});

test("AuthorizingSpine: wrong writer → [COLLECTIVE_UNAUTHORIZED]", async () => {
  const auth = freshAuthSpine();
  const grant = issueGrant(makeCap("agent:claude:alice", ["dialog"]), FIXED_SEED);
  const input: AppendInput = { ...authInput(grant, "dialog"), writerDid: "agent:claude:bob" };
  await assert.rejects(() => auth.append(input, grant), /COLLECTIVE_UNAUTHORIZED/);
});

test("AuthorizingSpine: out-of-scope space → [COLLECTIVE_UNAUTHORIZED]", async () => {
  const auth = freshAuthSpine();
  const grant = issueGrant(makeCap("agent:claude:alice", ["dialog"]), FIXED_SEED);
  await assert.rejects(() => auth.append(authInput(grant, "code"), grant), /COLLECTIVE_UNAUTHORIZED/);
});

test("AuthorizingSpine: cap_id mismatch → [COLLECTIVE_CAPABILITY_MISMATCH]", async () => {
  const auth = freshAuthSpine();
  const grant = issueGrant(makeCap("agent:claude:alice", ["dialog"]), FIXED_SEED);
  const input: AppendInput = { ...authInput(grant, "dialog"), capabilityId: "cap:wrong" };
  await assert.rejects(() => auth.append(input, grant), /COLLECTIVE_CAPABILITY_MISMATCH/);
});

// ---------------------------------------------------------------------------
// 5. Multi-writer
// ---------------------------------------------------------------------------
test("Multi-writer: two agents with different grants to same vault", async () => {
  const auth = freshAuthSpine();
  const gAlice = issueGrant(makeCap("agent:claude:alice", ["dialog"]), FIXED_SEED);
  const gBob = issueGrant(makeCap("agent:claude:bob", ["code"]), FIXED_SEED);

  const rA = await auth.append(authInput(gAlice, "dialog"), gAlice);
  assert.equal(rA.seqno, 0n);
  const rB = await auth.append(authInput(gBob, "code"), gBob);
  assert.equal(rB.seqno, 0n);

  await assert.rejects(() => auth.append(authInput(gAlice, "code"), gAlice), /COLLECTIVE_UNAUTHORIZED/);
  await assert.rejects(() => auth.append(authInput(gBob, "dialog"), gBob), /COLLECTIVE_UNAUTHORIZED/);
});

// ---------------------------------------------------------------------------
// 6. Spine untouched: same vault_memory_root
// ---------------------------------------------------------------------------
test("Spine untouched: same vault_memory_root with vs without AuthorizingSpine", async () => {
  const cap = makeCap("agent:claude:alice", ["dialog"]);
  const grant = issueGrant(cap, FIXED_SEED);
  const input: AppendInput = {
    vaultDid: VAULT_DID, space: "dialog", kind: "dialog",
    ciphertext: new Uint8Array([1, 2, 3]), enc: ENC,
    writerDid: "agent:claude:alice", capabilityId: grant.capability_id,
  };

  // Direct
  const s1 = createSpine({ store: new MemSpineStore(), storage: new MemCAS(), anchor: new LocalSigned(new Uint8Array(32).fill(9)) });
  const r1 = await s1.append(input);

  // Via AuthorizingSpine
  const s2 = createSpine({ store: new MemSpineStore(), storage: new MemCAS(), anchor: new LocalSigned(new Uint8Array(32).fill(9)) });
  const auth = createAuthorizingSpine({ spine: s2, authorityPublicKey: PUBKEY });
  const r2 = await auth.append(input, grant);

  assert.equal(r1.object_id, r2.object_id);
  assert.equal(r1.vault_memory_root, r2.vault_memory_root);
  assert.equal(r1.space_state, r2.space_state);
});