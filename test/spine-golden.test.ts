/**
 * Spine golden (TASK §T8.3): re-run the fixed deterministic scenario and assert it reproduces the
 * committed PRE-NORMATIVE vector byte-for-byte. This proves the generator is deterministic and the
 * committed vector is current (delete it, `npm run vectors:generate`, diff → identical).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runScenario } from "../scripts/spine-scenario.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(__dirname, "..", "vectors", "spine", "golden.json");

test("spine golden reproduces the committed vector", async () => {
  const committed = JSON.parse(readFileSync(GOLDEN, "utf8"));
  assert.equal(committed._status, "PRE-NORMATIVE");
  const live = await runScenario();
  assert.deepEqual(live, committed.scenario);
});

test("golden vault root and per-space states are well-formed 32-byte hex", async () => {
  const live = await runScenario();
  assert.ok(/^[0-9a-f]{64}$/.test(live.final_vault_memory_root));
  for (const v of Object.values(live.final_space_state)) {
    assert.ok(/^[0-9a-f]{64}$/.test(v));
  }
  assert.equal(live.appends.length, 6);
});
