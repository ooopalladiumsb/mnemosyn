/**
 * Deterministic recall scenario shared by the vector generator and the golden test (TASK-deepseek-L2).
 *
 * Fixed HashEmbedder (dim=16), fixed corpus of {objectId, text}, fixed queries.
 * Returns: embedder metadata, corpus (with vectors), and per-query ranked hits.
 * Dimension 16 keeps the golden file compact while exercising all mechanics.
 */
import { HashEmbedder } from "../src/recall/embedding.js";
import { LocalRecallIndex } from "../src/recall/recall-index.js";
import { createRecall } from "../src/recall/recall.js";

const FIXED_DIM = 16;

const FIXED_CORPUS: readonly { objectId: string; text: string }[] = [
  { objectId: "obj:alpha", text: "The quick brown fox jumps over the lazy dog" },
  { objectId: "obj:beta", text: "Pack my box with five dozen liquor jugs" },
  { objectId: "obj:gamma", text: "How vexingly quick daft zebras jump" },
  { objectId: "obj:delta", text: "The five boxing wizards jump quickly" },
  { objectId: "obj:epsilon", text: "Sphinx of black quartz, judge my vow" },
  { objectId: "obj:zeta", text: "Two driven jocks help fax my big quiz" },
  { objectId: "obj:eta", text: "Waltz, bad nymph, for quick jigs vex" },
  { objectId: "obj:theta", text: "the quick brown fox jumps over the lazy dog" },
];

const FIXED_QUERIES: readonly { query: string; k: number }[] = [
  { query: "quick brown fox", k: 3 },
  { query: "lazy dog", k: 2 },
  { query: "vexing zebras", k: 5 },
  { query: "boxing wizards", k: 1 },
  { query: "completely unrelated phrase about spaceships", k: 3 },
  { query: "the quick brown fox jumps over the lazy dog", k: 3 },
  { query: "quick fox", k: 10 },
];

export interface RecallCorpusEntry {
  readonly objectId: string;
  readonly text: string;
  readonly vector: readonly number[];
}

export interface RecallQueryResult {
  readonly query: string;
  readonly k: number;
  readonly hits: readonly { objectId: string; score: number }[];
}

export interface RecallScenarioResult {
  readonly embedder_name: string;
  readonly embedder_dimension: number;
  readonly embedder: { spec: string };
  readonly corpus: readonly RecallCorpusEntry[];
  readonly queries: readonly RecallQueryResult[];
}

export async function runRecallScenario(): Promise<RecallScenarioResult> {
  const embedder = new HashEmbedder(FIXED_DIM);
  const index = new LocalRecallIndex(FIXED_DIM);
  const recall = createRecall({ embedder, index });

  const corpus: RecallCorpusEntry[] = [];
  for (const entry of FIXED_CORPUS) {
    const vec = await embedder.embed(entry.text);
    await recall.indexObject(entry.objectId, { text: entry.text });
    corpus.push({
      objectId: entry.objectId,
      text: entry.text,
      vector: Array.from(vec),
    });
  }

  const queries: RecallQueryResult[] = [];
  for (const { query, k } of FIXED_QUERIES) {
    const hits = await recall.recall({ text: query }, k);
    queries.push({
      query,
      k,
      hits: hits.map((h) => ({ objectId: h.objectId, score: h.score })),
    });
  }

  return {
    embedder_name: embedder.name,
    embedder_dimension: embedder.dimension,
    embedder: { spec: "hash-embedder-v1: SHA-256 counter-expansion to big-endian float32, L2-normalize" },
    corpus,
    queries,
  };
}