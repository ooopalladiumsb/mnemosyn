import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalBytes, canonicalizeString } from "../src/canonical/jcs.js";

const dec = new TextDecoder();

test("object keys are sorted by UTF-8 byte order", () => {
  assert.equal(dec.decode(canonicalBytes({ b: 2, a: 1 })), '{"a":1,"b":2}');
});

test("bigint integers beyond 2^53 are preserved exactly", () => {
  assert.equal(
    dec.decode(canonicalBytes({ n: 12345678901234567890123456789012345678n })),
    '{"n":12345678901234567890123456789012345678}',
  );
});

test("integer Number is accepted; fractional Number throws", () => {
  assert.equal(dec.decode(canonicalBytes({ x: 7 })), '{"x":7}');
  assert.throws(() => canonicalBytes({ x: 1.5 }), /JCS_FRACTIONAL_FORBIDDEN/);
});

test("nested arrays/objects canonicalize recursively", () => {
  assert.equal(dec.decode(canonicalBytes({ z: [3, { y: 1, x: 2 }], a: true })), '{"a":true,"z":[3,{"x":2,"y":1}]}');
});

test("canonicalizeString rejects duplicate keys", () => {
  assert.throws(() => canonicalizeString('{"a":1,"a":2}'), /JCS_DUPLICATE_KEY/);
});

test("canonicalizeString rejects fractional and exponent numbers", () => {
  assert.throws(() => canonicalizeString("1.5"), /JCS_FRACTIONAL_FORBIDDEN/);
  assert.throws(() => canonicalizeString("1e3"), /JCS_EXPONENT_FORBIDDEN/);
});
