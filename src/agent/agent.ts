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
import type { Brain, MemoryDraft, ContextHit, RecalledContext } from "./brain.js";
import type { VaultKeyManager } from "./key-manager.js";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

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

/** Internal: commit one draft — seal + append (+ index if recall is wired). */
async function commitDraft(
  draft: MemoryDraft,
  cfg: {
    spine: Spine;
    keys: VaultKeyManager;
    vaultDid: VaultDid;
    agentDid: AgentDid;
    capabilityId: CapabilityId;
    recall?: Recall;
  },
): Promise<AppendReceipt> {
  const plainBytes = ENCODER.encode(draft.text);
  const sealed = await cfg.keys.seal(plainBytes);
  const receipt = await cfg.spine.append({
    vaultDid: cfg.vaultDid,
    space: draft.space,
    kind: draft.kind,
    ciphertext: sealed.ciphertext,
    enc: sealed.enc,
    writerDid: cfg.agentDid,
    capabilityId: cfg.capabilityId,
    ...(draft.tags !== undefined ? { tags: draft.tags } : {}),
  });
  // Keep the recall index current if wired.
  if (cfg.recall) {
    await cfg.recall.indexObject(receipt.object_id, { text: draft.text });
  }
  return receipt;
}

/** Construct an agent from its wiring. */
export function createAgent(config: AgentConfig): MnemosyneAgent {
  const { spine, brain, keys, vaultDid, agentDid, capabilityId, recall, recallK } = config;
  const k = recallK ?? 5;

  return {
    async turn(input: string): Promise<TurnResult> {
      // 1. Build recalled context (if recall is wired).
      let context: RecalledContext = { query: input, hits: [] };
      if (recall) {
        const hits = await recall.recall({ text: input }, k);
        const ctxHits: ContextHit[] = [];
        for (const hit of hits) {
          try {
            const { obj, ciphertext } = await spine.recallById(vaultDid, hit.objectId);
            const plainBytes = await keys.open(ciphertext, obj.enc);
            const text = DECODER.decode(plainBytes);
            ctxHits.push({
              objectId: hit.objectId,
              text,
              kind: obj.kind,
              score: hit.score,
            });
          } catch {
            // If decryption or recall fails for a hit, skip it.
            continue;
          }
        }
        context = { query: input, hits: ctxHits };
      }

      // 2. Brain decides reply + what to remember.
      const bt = await brain.turn(input, context);

      // 3. Commit each draft.
      const receipts: AppendReceipt[] = [];
      for (const draft of bt.remember) {
        receipts.push(
          await commitDraft(draft, { spine, keys, vaultDid, agentDid, capabilityId, recall }),
        );
      }

      return { reply: bt.reply, remembered: receipts };
    },

    async remember(draft: MemoryDraft): Promise<AppendReceipt> {
      return commitDraft(draft, { spine, keys, vaultDid, agentDid, capabilityId, recall });
    },
  };
}
