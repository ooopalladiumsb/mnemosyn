/**
 * L3 Semantic — fact model + extraction seam (D7). DERIVED, OUT OF ROOT.
 *
 * A `Fact` is an RDF-style triple (subject, predicate, object) plus its PROVENANCE — the
 * `object_id` of the MemoryObject it was derived from. Facts are owner-private, rebuildable, and
 * NEVER hashed or anchored (the recall/embeddings analogue, one layer up). A `FactExtractor` maps
 * plaintext → triples; like the Brain (`LLMProvider`) and embedding seams it is generally
 * NON-DETERMINISTIC and model-backed, and lives entirely outside the hashed root.
 *
 * ARCHITECT-OWNED CONTRACT. The interfaces and the `DelimitedExtractor` SIGNATURES below are
 * FROZEN; DeepSeek implements the bodies (see docs/TASK-deepseek-L3.md). New exports may be added;
 * the declared names/shapes/signatures may not change.
 */

/** An RDF-style triple. Entities (subject/object) and predicate are plain normalized strings. */
export interface Triple {
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
}

/** A triple plus PROVENANCE: the `object_id` of the MemoryObject it was derived from. */
export interface Fact {
  readonly triple: Triple;
  readonly sourceObjectId: string;
}

/**
 * The fact-extraction seam: plaintext → triples. Real implementations (model/network-backed) are
 * non-deterministic and ship later; they are an untested seam in L3.
 */
export interface FactExtractor {
  readonly name: string;
  extract(text: string): Promise<readonly Triple[]>;
}

/**
 * Deterministic reference extractor for tests / standalone wiring. Parses each line of the form
 * `subject<delimiter>predicate<delimiter>object` into a `Triple`; lines that do not split into
 * exactly three non-empty (trimmed) fields are skipped. It is NOT real NLP — it exists so graph
 * mechanics (dedup, match, neighbors, the out-of-root invariant) are byte-reproducible and
 * golden-pinnable, exactly as L0 used fixed ciphertext and L2 used `HashEmbedder`. Same text →
 * same ordered triples, across runs and platforms.
 */
export class DelimitedExtractor implements FactExtractor {
  readonly name = "delimited-extractor-v1";
  readonly delimiter: string;

  constructor(delimiter = "\t") {
    this.delimiter = delimiter;
  }

  async extract(text: string): Promise<readonly Triple[]> {
    const result: Triple[] = [];
    const lines = text.split("\n");
    for (const line of lines) {
      const parts = line.split(this.delimiter);
      // Split on delimiter, trim each field
      const trimmed = parts.map((p) => p.trim());
      // Skip lines that don't yield exactly three non-empty fields
      if (trimmed.length !== 3) continue;
      if (trimmed[0]!.length === 0 || trimmed[1]!.length === 0 || trimmed[2]!.length === 0) continue;
      result.push({
        subject: trimmed[0]!,
        predicate: trimmed[1]!,
        object: trimmed[2]!,
      });
    }
    return result;
  }
}
