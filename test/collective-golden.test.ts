/**
 * Collective L4 golden (TASK-deepseek-L4 §2.1): re-run the fixed deterministic collective scenario
 * and assert it reproduces the committed PRE-NORMATIVE vector byte-for-byte. This proves
 * the capability hashing and Ed25519 signature are byte-reproducible.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runCollectiveScenario } from "../scripts/collective-scenario.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(__dirname, "..", "vectors", "collective", "golden.json");

test("collective golden reproduces the committed vector", async () => {
  const committed = JSON.parse(readFileSync(GOLDEN, "utf8"));
  assert.equal(committed._status, "NORMATIVE");
  const live = await runCollectiveScenario();
  assert.deepEqual(live, committed.scenario);
});

test("collective golden capability_ids are well-formed 64-hex", async () => {
  const live = await runCollectiveScenario();
  assert.equal(live.capabilities.length, 3, "should have 3 capabilities");
  for (const cap of live.capabilities) {
    assert.ok(/^[0-9a-f]{64}$/.test(cap.capability_id), "capability_id must be 64 hex chars");
    assert.ok(/^[0-9a-f]{128}$/.test(cap.proof), "proof must be 128 hex chars");
  }
});
