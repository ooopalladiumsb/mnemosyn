/**
 * Semantic L3 golden (TASK-deepseek-L3 §2.1): re-run the fixed deterministic semantic scenario
 * and assert it reproduces the committed PRE-NORMATIVE vector byte-for-byte. This proves the
 * extraction + dedup + match + ordering are reproducible. All string comparisons are exact.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runSemanticScenario } from "../scripts/semantic-scenario.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(__dirname, "..", "vectors", "semantic", "golden.json");

test("semantic golden reproduces the committed vector", async () => {
  const committed = JSON.parse(readFileSync(GOLDEN, "utf8"));
  assert.equal(committed._status, "NORMATIVE");
  const live = await runSemanticScenario();
  assert.deepEqual(live, committed.scenario);
});

test("semantic golden entities are sorted ascending", async () => {
  const live = await runSemanticScenario();
  for (let i = 1; i < live.entities.length; i++) {
    assert.ok(
      live.entities[i - 1]! < live.entities[i]!,
      `entities should be sorted: ${live.entities[i - 1]} >= ${live.entities[i]}`,
    );
  }
});

test("semantic golden match results are in canonical order", async () => {
  const live = await runSemanticScenario();
  for (const mq of live.match_queries) {
    for (let i = 1; i < mq.results.length; i++) {
      const prev = mq.results[i - 1]!;
      const cur = mq.results[i]!;
      const prevKey = `${prev.subject}|${prev.predicate}|${prev.object}|${prev.sourceObjectId}`;
      const curKey = `${cur.subject}|${cur.predicate}|${cur.object}|${cur.sourceObjectId}`;
      assert.ok(prevKey <= curKey, `match '${mq.label}' not canonically sorted at index ${i}: ${prevKey} > ${curKey}`);
    }
  }
});
