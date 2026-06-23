/**
 * @mnemosyne/agent — Brain seam (D10). The autonomous, NON-DETERMINISTIC decider.
 *
 * Mnemosyne v1.0.0 is verifiable memory; the agent host turns it into an agent WITH verifiable
 * memory. The Brain is the real LLM seam (the empty `adapters/llm.ts` `LLMProvider` was its
 * reserved placeholder): given the user input + recalled memory, it produces a reply and decides
 * WHAT to remember. It never touches the deterministic spine or the hashed root — the host encrypts
 * its `MemoryDraft`s and commits them. Real impls are LLM-backed (untested seam); the deterministic
 * `ScriptedBrain` reference drives the loop in tests (the agent analogue of fixed ciphertext).
 *
 * ARCHITECT-OWNED CONTRACT. The shapes and `ScriptedBrain` SIGNATURES below are FROZEN; DeepSeek
 * implements the bodies (docs/TASK-deepseek-D10.md). New exports may be added.
 */
import type { MemoryKind } from "../spine/types.js";

/** A piece the Brain decides to remember: PLAINTEXT + classification. The host seals + appends it. */
export interface MemoryDraft {
  readonly kind: MemoryKind;
  readonly space: string;
  readonly text: string;
  readonly tags?: readonly string[];
}

/** One recalled memory handed to the Brain as context (already decrypted by the host). */
export interface ContextHit {
  readonly objectId: string;
  readonly text: string;
  readonly kind: MemoryKind;
  readonly score: number;
}

/** The recalled context for a turn (empty when no recall is wired or nothing matches). */
export interface RecalledContext {
  readonly query: string;
  readonly hits: readonly ContextHit[];
}

/** What the Brain returns for one turn: a user-facing reply + zero or more memories to commit. */
export interface BrainTurn {
  readonly reply: string;
  readonly remember: readonly MemoryDraft[];
}

/**
 * The Brain — decides the reply and what to remember. Real implementations call an LLM and are
 * non-deterministic (untested seam). It MUST NOT import the spine, encrypt anything, or hold keys.
 */
export interface Brain {
  readonly name: string;
  turn(input: string, context: RecalledContext): Promise<BrainTurn>;
}

/**
 * Deterministic reference Brain for tests / wiring: delegates to a pure `script` function. Same
 * (input, context) → same `BrainTurn`. Lets the loop be exercised without an LLM.
 */
export class ScriptedBrain implements Brain {
  readonly name = "scripted-brain-v1";

  constructor(private readonly script: (input: string, context: RecalledContext) => BrainTurn) {}

  async turn(input: string, context: RecalledContext): Promise<BrainTurn> {
    return this.script(input, context);
  }
}
