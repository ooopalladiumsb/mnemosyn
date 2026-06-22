import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256, toHex } from "../src/canonical/hash.js";
import { binaryMerkle, stateRoot, type StateNamespace } from "../src/canonical/merkle.js";
import { canonicalBytes } from "../src/canonical/jcs.js";
import { DOMAIN_TAGS } from "../src/canonical/domains.js";

const enc = new TextEncoder();

test("single-leaf Merkle root equals the leaf", () => {
  const leaf = sha256(enc.encode("only"));
  assert.deepEqual(binaryMerkle([leaf], DOMAIN_TAGS.MERKLE_NODE_V1), leaf);
});

test("binaryMerkle rejects empty input and bad leaf length", () => {
  assert.throws(() => binaryMerkle([], DOMAIN_TAGS.MERKLE_NODE_V1), /MERKLE_EMPTY/);
  assert.throws(() => binaryMerkle([new Uint8Array(31)], DOMAIN_TAGS.MERKLE_NODE_V1), /MERKLE_BAD_LEAF_LEN/);
});

test("stateRoot is independent of namespace input order", () => {
  const ns: StateNamespace[] = [
    { name: "code", canonicalBytes: canonicalBytes({ count: 1 }) },
    { name: "dialog", canonicalBytes: canonicalBytes({ count: 2 }) },
  ];
  const r1 = toHex(stateRoot(ns));
  const r2 = toHex(stateRoot([ns[1]!, ns[0]!]));
  assert.equal(r1, r2);
});

test("stateRoot rejects empty and duplicate namespaces", () => {
  assert.throws(() => stateRoot([]), /STATE_ROOT_EMPTY/);
  assert.throws(
    () => stateRoot([{ name: "a", canonicalBytes: new Uint8Array() }, { name: "a", canonicalBytes: new Uint8Array() }]),
    /STATE_ROOT_DUPLICATE_NAMESPACE/,
  );
});
