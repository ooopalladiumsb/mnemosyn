/**
 * Conformance (anti-drift, D1): Mnemosyne's vendored canonical-core MUST be byte-identical to
 * paradigm_terra for the shared CE v1.3 primitives. We load terra's published golden.json and
 * compare non-trivially. Terra-only vectors (int256/uint256 not ported; DSL/CAL/MCP/address/frame
 * tags; the CAL state-root genesis content) are skipped WITH A LOGGED NOTE per TASK §T8.1.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { sha256, toHex, domainHash, binaryMerkle, streamTreeRoot } from "../../src/canonical/index.js";
import { encodeUint64 } from "../../src/canonical/integers.js";
import { utf8NfcBytes } from "../../src/canonical/strings.js";
import { canonicalizeString } from "../../src/canonical/jcs.js";
import { CE_V13_TAGS, DOMAIN_TAGS } from "../../src/canonical/domains.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TERRA_GOLDEN = join(__dirname, "..", "..", "..", "paradigm_terra", "canonical", "vectors", "golden.json");

interface Vector {
  id: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

function hexToBytes(h: string): Uint8Array {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}
function noPrefix(h: string): string {
  return h.startsWith("0x") ? h.slice(2) : h;
}

const golden = JSON.parse(readFileSync(TERRA_GOLDEN, "utf8")) as { vectors: Vector[] };
const byId = new Map(golden.vectors.map((v) => [v.id, v]));

// Vectors intentionally NOT asserted (terra-only behaviour or content outside CE shared primitives).
const SKIPPED: Record<string, string> = {
  int256_zero: "int256 not ported to Mnemosyne (uint16/uint64 only)",
  int256_minus_one: "int256 not ported",
  int256_min: "int256 not ported",
  int256_max: "int256 not ported",
  uint256_max: "uint256 not ported",
  ton_address_canonical: "PARADIGM_TERRA_ADDRESS_V1 — terra-only tag",
  dsl_expr_gte_x_0: "DSL_V1.x — terra-only tag",
  cal_v1_hash_example: "CAL_V1 — terra-only tag",
  frame_hello: "framing — terra-only",
  state_root_genesis_empty: "CAL genesis namespace CONTENT is terra-domain; STATE_ROOT machinery is covered via merkle vectors",
};

test("conformance: terra golden.json loaded and non-empty", () => {
  assert.ok(golden.vectors.length >= 15, "expected terra golden vector set");
});

test("conformance: uint64 BE encoding matches terra", () => {
  const v = byId.get("uint64_sequence")!;
  const bytes = encodeUint64(BigInt(v.input["value"] as string));
  assert.equal(toHex(bytes), noPrefix(v.output["bytes_hex"] as string));
});

test("conformance: NFC + UTF-8 matches terra (e+acute → é)", () => {
  const v = byId.get("utf8_nfc_e_acute")!;
  const decomposed = new TextDecoder("utf-8", { fatal: true }).decode(hexToBytes(v.input["decomposed_hex"] as string));
  const bytes = utf8NfcBytes(decomposed);
  assert.equal(toHex(bytes), noPrefix(v.output["bytes_hex"] as string));
  assert.equal(toHex(sha256(bytes)), noPrefix(v.output["sha256"] as string));
});

test("conformance: restricted JCS key sort matches terra", () => {
  const v = byId.get("jcs_sample_b2_a1")!;
  const bytes = canonicalizeString(v.input["json"] as string);
  assert.equal(toHex(bytes), noPrefix(v.output["canonical_utf8_hex"] as string));
  assert.equal(new TextDecoder().decode(bytes), v.output["canonical_text"]);
  assert.equal(toHex(sha256(bytes)), noPrefix(v.output["sha256"] as string));
});

test("conformance: JCS big integer (>2^53) preserved, matches terra", () => {
  const v = byId.get("jcs_big_integer")!;
  const bytes = canonicalizeString(v.input["json"] as string);
  assert.equal(new TextDecoder().decode(bytes), v.output["canonical_text"]);
  assert.equal(toHex(sha256(bytes)), noPrefix(v.output["sha256"] as string));
});

test("conformance: binary Merkle (odd, duplicate-last) matches terra", () => {
  const v = byId.get("merkle_three_leaves_odd_duplicate")!;
  const enc = new TextEncoder();
  const leaves = ["A", "B", "C"].map((s) => sha256(enc.encode(s)));
  const root = binaryMerkle(leaves, DOMAIN_TAGS.MERKLE_NODE_V1);
  assert.equal(toHex(root), noPrefix(v.output["root"] as string));
});

test("conformance: stream-tree root (CE §6.3) matches terra", () => {
  const v = byId.get("merkle_stream_tree_2")!;
  const streams = (v.input["streams"] as Array<Record<string, unknown>>).map((s) => {
    const fill = (hex: string): Uint8Array => {
      const u = new Uint8Array(32);
      u.fill(parseInt(noPrefix(hex), 16));
      return u;
    };
    return {
      streamId: s["streamId"] as string,
      stateHash: fill(s["stateHash_fill"] as string),
      lastEventHash: fill(s["lastEventHash_fill"] as string),
      lastSeqno: s["lastSeqno"] as number,
    };
  });
  assert.equal(toHex(streamTreeRoot(streams)), noPrefix(v.output["root"] as string));
});

test("conformance: CE_V13 domain tags hash identically to terra's (verifies the literals)", () => {
  // terra stores each tag as `sha256(empty||tag)=0x<hex>` = domainHash(tag, <empty>). Matching
  // that hash byte-for-byte proves Mnemosyne's CE_V13 literals equal terra's.
  const v = byId.get("domain_tags_registry")!;
  const expect = (key: string): string => noPrefix((v.output[key] as string).split("=")[1]!);
  const empty = new Uint8Array(0);
  for (const key of ["MERKLE_LEAF_V1", "MERKLE_NODE_V1", "STATE_V1", "STATE_ROOT_V1"] as const) {
    assert.equal(toHex(domainHash(CE_V13_TAGS[key], empty)), expect(key));
  }
});

test("conformance: terra-only vectors are explicitly skipped (logged)", () => {
  const asserted = new Set([
    "uint64_sequence",
    "utf8_nfc_e_acute",
    "jcs_sample_b2_a1",
    "jcs_big_integer",
    "merkle_three_leaves_odd_duplicate",
    "merkle_stream_tree_2",
    "domain_tags_registry",
  ]);
  for (const v of golden.vectors) {
    if (asserted.has(v.id)) continue;
    assert.ok(SKIPPED[v.id], `unhandled terra vector ${v.id} — add an assertion or a skip note`);
    console.log(`[conformance] skipped ${v.id}: ${SKIPPED[v.id]}`);
  }
});
