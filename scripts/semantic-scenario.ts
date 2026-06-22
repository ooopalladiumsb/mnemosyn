/**
 * Deterministic semantic scenario shared by the vector generator and the golden test
 * (TASK-deepseek-L3). Fixed DelimitedExtractor (tab delimiter), fixed corpus of
 * {objectId, text} carrying triples, fixed match/neighbors/entities queries.
 * Returns extracted facts and per-query results. All comparisons are exact strings (no float).
 */
import { DelimitedExtractor } from "../src/semantic/fact.js";
import { LocalKnowledgeGraph } from "../src/semantic/knowledge-graph.js";
import { createSemantic } from "../src/semantic/semantic.js";

const FIXED_CORPUS: readonly { objectId: string; text: string }[] = [
  {
    objectId: "obj:alpha",
    text: "Alice\tknows\tBob\nAlice\tloves\tcode\nBob\twrote\tMnemosyne",
  },
  {
    objectId: "obj:beta",
    text: "Bob\tknows\tEve\nEve\treviewed\tMnemosyne\nCarol\tjoined\tteam",
  },
  {
    objectId: "obj:gamma",
    text: "Alice\tmentors\tCarol\nCarol\tcodes\tTypeScript\nBob\treviewed\tcode",
  },
  {
    objectId: "obj:delta",
    text: "line with four\tfields\there\textra\n\nAlice\twrote\tpaper\nBob\tknows\tAlice",
  },
  {
    objectId: "obj:epsilon",
    text: "Dave\tjoined\tteam\nDave\tcodes\tRust\nEve\tmentors\tDave",
  },
];

/** Match/neighbors queries to pin. */
const FIXED_MATCH_QUERIES = [
  { label: "subject:Alice", subject: "Alice" },
  { label: "predicate:knows", predicate: "knows" },
  { label: "object:Mnemosyne", object: "Mnemosyne" },
  { label: "full:Alice:knows:Bob", subject: "Alice", predicate: "knows", object: "Bob" },
  { label: "empty:all", subject: undefined, predicate: undefined, object: undefined },
  { label: "subject:unknown", subject: "UnknownEntity" },
];

const FIXED_NEIGHBOR_QUERIES = ["Alice", "Bob", "Eve", "UnknownEntity"];

export interface SemanticCorpusEntry {
  readonly objectId: string;
  readonly text: string;
  readonly triples: readonly { subject: string; predicate: string; object: string }[];
}

export interface SemanticMatchResult {
  readonly label: string;
  readonly pattern: { subject?: string; predicate?: string; object?: string };
  readonly results: readonly { subject: string; predicate: string; object: string; sourceObjectId: string }[];
}

export interface SemanticNeighborResult {
  readonly entity: string;
  readonly results: readonly { subject: string; predicate: string; object: string; sourceObjectId: string }[];
}

export interface SemanticScenarioResult {
  readonly extractor_name: string;
  readonly delimiter: string;
  readonly corpus: SemanticCorpusEntry[];
  readonly entities: readonly string[];
  readonly fact_count: number;
  readonly match_queries: SemanticMatchResult[];
  readonly neighbor_queries: SemanticNeighborResult[];
}

export async function runSemanticScenario(): Promise<SemanticScenarioResult> {
  const extractor = new DelimitedExtractor();
  const graph = new LocalKnowledgeGraph();
  const sem = createSemantic({ extractor, graph });

  // Index all corpus entries
  const corpus: SemanticCorpusEntry[] = [];
  for (const { objectId, text } of FIXED_CORPUS) {
    const triples = await extractor.extract(text);
    for (const t of triples) {
      graph.addFact({ triple: t, sourceObjectId: objectId });
    }
    corpus.push({
      objectId,
      text,
      triples: triples.map((t) => ({ subject: t.subject, predicate: t.predicate, object: t.object })),
    });
  }

  // Entities
  const entities = graph.entities();

  // Match queries
  const match_queries: SemanticMatchResult[] = [];
  for (const q of FIXED_MATCH_QUERIES) {
    const pattern: { subject?: string; predicate?: string; object?: string } = {};
    if (q.subject !== undefined) pattern.subject = q.subject;
    if (q.predicate !== undefined) pattern.predicate = q.predicate;
    if (q.object !== undefined) pattern.object = q.object;
    const facts = graph.match(pattern);
    match_queries.push({
      label: q.label,
      pattern,
      results: facts.map((f) => ({
        subject: f.triple.subject,
        predicate: f.triple.predicate,
        object: f.triple.object,
        sourceObjectId: f.sourceObjectId,
      })),
    });
  }

  // Neighbor queries
  const neighbor_queries: SemanticNeighborResult[] = [];
  for (const entity of FIXED_NEIGHBOR_QUERIES) {
    const facts = graph.neighbors(entity);
    neighbor_queries.push({
      entity,
      results: facts.map((f) => ({
        subject: f.triple.subject,
        predicate: f.triple.predicate,
        object: f.triple.object,
        sourceObjectId: f.sourceObjectId,
      })),
    });
  }

  return {
    extractor_name: extractor.name,
    delimiter: "\\t",
    corpus,
    entities,
    fact_count: graph.size(),
    match_queries,
    neighbor_queries,
  };
}
