/**
 * (Re)generate the PRE-NORMATIVE spine + anchor golden vectors (TASK §T8.3 + L1 §2.1).
 * Deterministic: re-running this produces byte-identical files.
 * The architect promotes "_status" PRE-NORMATIVE → NORMATIVE.
 *
 *   npm run vectors:generate
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runScenario } from "./spine-scenario.js";
import { runAnchorScenario } from "./anchor-scenario.js";

const BASE = join(dirname(fileURLToPath(import.meta.url)), "..", "vectors");
const SPINE_OUT = join(BASE, "spine", "golden.json");
const ANCHOR_OUT = join(BASE, "anchor", "golden.json");

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
