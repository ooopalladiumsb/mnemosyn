/**
 * (Re)generate the PRE-NORMATIVE spine + anchor + recall + semantic golden vectors
 * (TASK §T8.3 + L1 §2.1 + L2 §2.1 + L3 §2.1). Deterministic: re-running this produces
 * byte-identical files. The architect promotes "_status" PRE-NORMATIVE → NORMATIVE.
 *
 *   npm run vectors:generate
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runScenario } from "./spine-scenario.js";
import { runAnchorScenario } from "./anchor-scenario.js";
import { runRecallScenario } from "./recall-scenario.js";
import { runSemanticScenario } from "./semantic-scenario.js";

const BASE = join(dirname(fileURLToPath(import.meta.url)), "..", "vectors");
const SPINE_OUT = join(BASE, "spine", "golden.json");
const ANCHOR_OUT = join(BASE, "anchor", "golden.json");
const RECALL_OUT = join(BASE, "recall", "golden.json");
const SEMANTIC_OUT = join(BASE, "semantic", "golden.json");

export async function generate(): Promise<string[]> {
  const outputs: string[] = [];

  // Spine (L0)
  const spineResult = await runScenario();
  const spineDoc = {
    _status: "PRE-NORMATIVE",
    meta: {
      package: "@mnemosyne/spine",
      spec_basis: "Mnemosyne L0 Spine v0.1-draft (docs/spec/l0-spine-v0.1-draft.md)",
      description:
        "Deterministic spine golden: one vault, spaces dialog+code, 3 interleaved appends each, " +
        "fixed ciphertext (not live-encrypted), non-monotonic created_at (AI-7). Asserts object_id, " +
        "space_state and vault_memory_root. Regenerate with `npm run vectors:generate`.",
    },
    scenario: spineResult,
  };
  const spineJson = JSON.stringify(spineDoc, null, 2) + "\n";
  await mkdir(dirname(SPINE_OUT), { recursive: true });
  await writeFile(SPINE_OUT, spineJson);
  outputs.push(SPINE_OUT);

  // Anchor (L1)
  const anchorResult = await runAnchorScenario();
  const anchorDoc = {
    _status: "PRE-NORMATIVE",
    meta: {
      package: "@mnemosyne/spine",
      spec_basis:
        "Mnemosyne L1 Anchor v0.1-draft (docs/spec/l1-anchor-v0.1-draft.md), D5",
      description:
        "Deterministic anchor golden: fixed seed + fixed root sequence → 3-link checkpoint chain. " +
        "Asserts each checkpoint_id, proof, and head. Proves chain hashing + Ed25519 reproducibility. " +
        "Regenerate with `npm run vectors:generate`.",
    },
    scenario: anchorResult,
  };
  const anchorJson = JSON.stringify(anchorDoc, null, 2) + "\n";
  await mkdir(dirname(ANCHOR_OUT), { recursive: true });
  await writeFile(ANCHOR_OUT, anchorJson);
  outputs.push(ANCHOR_OUT);

  // Recall (L2)
  const recallResult = await runRecallScenario();
  const recallDoc = {
    _status: "PRE-NORMATIVE",
    meta: {
      package: "@mnemosyne/spine",
      spec_basis:
        "Mnemosyne L2 Recall v0.1-draft (docs/spec/l2-recall-v0.1-draft.md), D6",
      description:
        "Deterministic recall golden: fixed HashEmbedder (dim=16), fixed corpus of {objectId, text}, " +
        "fixed queries. Asserts ranked objectId order EXACTLY and scores within 1e-12 tolerance. " +
        "Pins cosine + top-k + tie-break mechanics (NOT semantics). Regenerate with `npm run vectors:generate`.",
    },
    scenario: recallResult,
  };
  const recallJson = JSON.stringify(recallDoc, null, 2) + "\n";
  await mkdir(dirname(RECALL_OUT), { recursive: true });
  await writeFile(RECALL_OUT, recallJson);
  outputs.push(RECALL_OUT);

  // Semantic (L3)
  const semanticResult = await runSemanticScenario();
  const semanticDoc = {
    _status: "PRE-NORMATIVE",
    meta: {
      package: "@mnemosyne/spine",
      spec_basis:
        "Mnemosyne L3 Semantic v0.1-draft (docs/spec/l3-semantic-v0.1-draft.md), D7",
      description:
        "Deterministic semantic golden: fixed DelimitedExtractor (tab), fixed corpus of " +
        "{objectId, text} with triple lines, fixed match/neighbors/entities queries. " +
        "Pins extraction + dedup + match + neighbors + canonical ordering. All strings → exact comparison. " +
        "Regenerate with `npm run vectors:generate`.",
    },
    scenario: semanticResult,
  };
  const semanticJson = JSON.stringify(semanticDoc, null, 2) + "\n";
  await mkdir(dirname(SEMANTIC_OUT), { recursive: true });
  await writeFile(SEMANTIC_OUT, semanticJson);
  outputs.push(SEMANTIC_OUT);

  return outputs;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  generate()
    .then((paths) => paths.forEach((p) => console.log(`wrote ${p}`)))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
