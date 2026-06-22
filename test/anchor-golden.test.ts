/**
 * Anchor L1 golden (TASK-deepseek-L1 §2.1): re-run the fixed deterministic anchor scenario
 * and assert it reproduces the committed PRE-NORMATIVE vector byte-for-byte. This proves
 * the chain hashing AND the Ed25519 signature are byte-reproducible.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runAnchorScenario } from "../scripts/anchor-scenario.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(__dirname, "..", "vectors", "anchor", "golden.json");

test("anchor golden reproduces the committed vector", async () => {
  const committed = JSON.parse(readFileSync(GOLDEN, "utf8"));
  assert.equal(committed._status, "NORMATIVE");
  const live = await runAnchorScenario();
  assert.deepEqual(live, committed.scenario);
});

test("anchor golden checkpoint_ids are well-formed 32-byte hex", async () => {
  const live = await runAnchorScenario();
  assert.equal(live.chain.length, 3);
  for (const cp of live.chain) {
    assert.ok(/^[0-9a-f]{64}$/.test(cp.checkpoint_id), "checkpoint_id must be 64 hex chars");
    assert.ok(/^[0-9a-f]{128}$/.test(cp.proof), "proof must be 128 hex chars (Ed25519 sig)");
  }
  assert.ok(/^[0-9a-f]{64}$/.test(live.head.checkpointId));
  assert.equal(live.chain_verification.ok, true);
});
