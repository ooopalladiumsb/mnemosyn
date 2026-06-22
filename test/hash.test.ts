import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256, domainHash, concatBytes, toHex, fromHex } from "../src/canonical/hash.js";

const enc = new TextEncoder();

test("sha256('abc') matches the FIPS 180-4 vector", () => {
  assert.equal(toHex(sha256(enc.encode("abc"))), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("toHex/fromHex round-trip", () => {
  const b = new Uint8Array([0x00, 0x0f, 0xa9, 0xff]);
  assert.equal(toHex(b), "000fa9ff");
  assert.deepEqual(fromHex("000fa9ff"), b);
});

test("fromHex rejects odd length and bad chars", () => {
  assert.throws(() => fromHex("abc"), /HEX_ODD_LENGTH/);
  assert.throws(() => fromHex("zz"), /HEX_INVALID_CHAR/);
});

test("domainHash = sha256(utf8(domain) || payload)", () => {
  const payload = enc.encode("payload");
  const expected = sha256(concatBytes(enc.encode("MNEMOSYNE_TEST"), payload));
  assert.deepEqual(domainHash("MNEMOSYNE_TEST", payload), expected);
});

test("domainHash rejects non-ASCII tags", () => {
  assert.throws(() => domainHash("MNÉMO", enc.encode("x")), /DOMAIN_TAG_NONCANONICAL/);
});

test("concatBytes concatenates in order", () => {
  assert.deepEqual(
    concatBytes(new Uint8Array([1, 2]), new Uint8Array([]), new Uint8Array([3])),
    new Uint8Array([1, 2, 3]),
  );
});
