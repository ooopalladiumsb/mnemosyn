/**
 * Recall L2 golden (TASK-deepseek-L2 §2.1): re-run the fixed deterministic recall scenario
 * and assert it reproduces the committed PRE-NORMATIVE vector. This proves cosine + top-k +
 * tie-break are deterministic and byte-reproducible.
 *
 * Float scores are compared within 1e-12 tolerance per the spec; objectId order must be EXACT.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runRecallScenario } from "../scripts/recall-scenario.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(__dirname, "..", "vectors", "recall", "golden.json");

const FLOAT_TOLERANCE = 1e-12;

test("recall golden reproduces the committed vector", async () => {
  const committed = JSON.parse(readFileSync(GOLDEN, "utf8"));
  assert.equal(committed._status, "NORMATIVE");
  const live = await runRecallScenario();

  assert.equal(live.embedder_dimension, committed.scenario.embedder_dimension);
  assert.equal(live.embedder_name, committed.scenario.embedder_name);
  assert.deepEqual(live.embedder.spec, committed.scenario.embedder.spec);
  assert.equal(live.corpus.length, committed.scenario.corpus.length);

  // Verify corpus vectors byte-for-byte (Float32Array rendered as arrays)
  for (let i = 0; i < live.corpus.length; i++) {
    const liveEntry = live.corpus[i]!;
    const committedEntry = committed.scenario.corpus[i]!;
    assert.equal(liveEntry.objectId, committedEntry.objectId);
    assert.equal(liveEntry.text, committedEntry.text);
    assert.equal(liveEntry.vector.length, committedEntry.vector.length);
    for (let j = 0; j < liveEntry.vector.length; j++) {
      assert.ok(
        Math.abs(liveEntry.vector[j]! - committedEntry.vector[j]!) < FLOAT_TOLERANCE,
        `corpus[${i}].vector[${j}] mismatch: ${liveEntry.vector[j]} vs ${committedEntry.vector[j]}`,
      );
    }
  }

  // Verify query results
  assert.equal(live.queries.length, committed.scenario.queries.length);
  for (let i = 0; i < live.queries.length; i++) {
    const liveQ = live.queries[i]!;
    const committedQ = committed.scenario.queries[i]!;
    assert.equal(liveQ.query, committedQ.query);
    assert.equal(liveQ.k, committedQ.k);
    assert.equal(liveQ.hits.length, committedQ.hits.length);
    for (let j = 0; j < liveQ.hits.length; j++) {
      const liveHit = liveQ.hits[j]!;
      const committedHit = committedQ.hits[j]!;
      assert.equal(
        liveHit.objectId,
        committedHit.objectId,
        `query[${i}].hits[${j}]: objectId order mismatch: ${liveHit.objectId} vs ${committedHit.objectId}`,
      );
      assert.ok(
        Math.abs(liveHit.score - committedHit.score) < FLOAT_TOLERANCE,
        `query[${i}].hits[${j}]: score mismatch: ${liveHit.score} vs ${committedHit.score}`,
      );
    }
  }
});

test("recall golden scores are within [-1,1] and queries are well-formed", async () => {
  const live = await runRecallScenario();
  for (const q of live.queries) {
    assert.ok(q.k > 0, `k must be > 0, got ${q.k}`);
    const expectedK = Math.min(q.k, live.corpus.length);
    assert.equal(
      q.hits.length,
      expectedK,
      `query "${q.query}" k=${q.k} returned ${q.hits.length} hits, expected ${expectedK}`,
    );
    for (const hit of q.hits) {
      assert.ok(hit.score >= -1 && hit.score <= 1, `score ${hit.score} for ${hit.objectId} not in [-1,1]`);
    }
  }
});
