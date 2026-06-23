/**
 * @mnemosyne/agent — the agent host facade (D10). Composes a Brain + a VaultKeyManager + the spine
 * (and optional L2 recall) into a memory-driven loop. This is the Stage-0 shell that turns
 * verifiable memory into an agent WITH verifiable memory — in the same TS/Node ecosystem, no Web3
 * framework, no new deps.
 *
 * `turn(input)`:
 *   1. (if recall) embed input → recall top-k → for each hit `spine.recallById` + `keys.open` →
 *      assemble a `RecalledContext` of DECRYPTED prior memories.
 *   2. `brain.turn(input, context)` → a reply + `MemoryDraft[]`.
 *   3. for each draft: `keys.seal(utf8(text))` → `spine.append({…, writerDid: agentDid,
 *      capabilityId})` → (if recall) `recall.indexObject(objectId, { text })`.
 *   4. return the reply + the append receipts.
 *
 * The commitment line holds: only ciphertext is committed; the Brain/keys/plaintext never enter a
 * hashed value; memory is owned by the Vault DID and written by the Agent DID (D3/charter).
 *
 * ARCHITECT-OWNED CONTRACT. `AgentConfig`, `TurnResult`, `MnemosyneAgent`, and `createAgent` are
 * FROZEN; DeepSeek implements the body (docs/TASK-deepseek-D10.md).
 */
import type { Spine } from "../spine/spine.js";
import type { AppendReceipt, VaultDid, AgentDid, CapabilityId } from "../spine/types.js";
import type { Recall } from "../recall/recall.js";
import type { Brain, MemoryDraft } from "./brain.js";
import type { VaultKeyManager } from "./key-manager.js";

/** Wiring for an agent: the deterministic core (spine), the Brain, key custody, identity, recall. */
export interface AgentConfig {
  readonly spine: Spine;
  readonly brain: Brain;
  readonly keys: VaultKeyManager;
  readonly vaultDid: VaultDid;
  readonly agentDid: AgentDid;
  /** Capability authorizing this agent's writes. v1: `ROOT_CAPABILITY_ID` (D4). */
  readonly capabilityId: CapabilityId;
  /** Optional L2 recall: when present, `turn` builds context from it and indexes new memories. */
  readonly recall?: Recall;
  /** Top-k memories to recall for context (default 5). */
  readonly recallK?: number;
}

/** The outcome of one turn: the reply + a receipt per committed memory. */
export interface TurnResult {
  readonly reply: string;
  readonly remembered: readonly AppendReceipt[];
}

/** A memory-driven agent over a sovereign vault. */
export interface MnemosyneAgent {
  /** One conversational turn: recall → brain → seal+append decided memories → reply. */
  turn(input: string): Promise<TurnResult>;
  /** Directly commit one memory (no brain reply) — still sealed + appended through the spine. */
  remember(draft: MemoryDraft): Promise<AppendReceipt>;
}

/** Construct an agent from its wiring. */
export function createAgent(_config: AgentConfig): MnemosyneAgent {
  throw new Error("[TODO_D10] createAgent not implemented");
}
