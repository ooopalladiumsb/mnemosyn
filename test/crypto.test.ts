import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { encrypt, decrypt, contentCommit, contentIdentity } from "../src/crypto/encryption.js";
import { toHex } from "../src/canonical/hash.js";

const enc = new TextEncoder();
const KEK = new Uint8Array(32).fill(7);

test("encrypt → decrypt round-trips the plaintext", () => {
  const plaintext = enc.encode("hello mnemosyne");
  const { ciphertext, enc: meta } = encrypt(plaintext, KEK, "vault-kek-0");
  assert.equal(meta.alg, "AES-256-GCM");
  assert.equal(meta.wrap_b64, ""); // v0: KEK used directly as DEK
  assert.deepEqual(decrypt(ciphertext, meta, KEK), plaintext);
});

test("decrypt throws on tampered ciphertext (GCM auth)", () => {
  const { ciphertext, enc: meta } = encrypt(enc.encode("x"), KEK, "k");
  const tampered = ciphertext.slice();
  tampered[0] ^= 0xff;
  assert.throws(() => decrypt(tampered, meta, KEK));
});

test("encrypt rejects non-32-byte keys", () => {
  assert.throws(() => encrypt(enc.encode("x"), new Uint8Array(16), "k"), /ENC_BAD_KEY_LEN/);
});

test("contentCommit is deterministic over ciphertext", () => {
  const ct = randomBytes(40);
  assert.equal(toHex(contentCommit(ct)), toHex(contentCommit(ct.slice())));
});

test("contentIdentity is a keyed HMAC of plaintext (owner-local)", () => {
  const key = new Uint8Array(32).fill(1);
  const a = toHex(contentIdentity(enc.encode("same"), key));
  const b = toHex(contentIdentity(enc.encode("same"), key));
  const c = toHex(contentIdentity(enc.encode("diff"), key));
  assert.equal(a, b);
  assert.notEqual(a, c);
});
