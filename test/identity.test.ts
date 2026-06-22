import { test } from "node:test";
import assert from "node:assert/strict";
import { vaultDidFromPubkey, isVaultDid, agentDid, VAULT_DID_PREFIX } from "../src/identity/did.js";

const pubkey = new Uint8Array(Array.from({ length: 32 }, (_, i) => i));

test("vaultDidFromPubkey produces a valid, recognized Vault DID", () => {
  const did = vaultDidFromPubkey(pubkey);
  assert.ok(did.startsWith(VAULT_DID_PREFIX));
  assert.ok(isVaultDid(did));
});

test("vaultDidFromPubkey rejects non-32-byte keys", () => {
  assert.throws(() => vaultDidFromPubkey(new Uint8Array(31)), /DID_BAD_PUBKEY_LEN/);
});

test("isVaultDid rejects wrong prefix, bad charset, wrong length", () => {
  assert.equal(isVaultDid("did:web:example"), false);
  assert.equal(isVaultDid(VAULT_DID_PREFIX + "UPPER0189"), false); // 0/1/8/9 not in base32
  assert.equal(isVaultDid(VAULT_DID_PREFIX + "aaaa"), false); // decodes to <32 bytes
});

test("agentDid builds agent:<scheme>:<id> and validates parts", () => {
  assert.equal(agentDid("claude", "sess-1"), "agent:claude:sess-1");
  assert.throws(() => agentDid("", "x"), /DID_EMPTY_AGENT_PART/);
  assert.throws(() => agentDid("a:b", "x"), /DID_COLON_IN_AGENT_PART/);
});
