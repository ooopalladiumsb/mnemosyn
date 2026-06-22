/**
 * Deterministic spine scenario shared by the vector generator and the golden test (TASK §T8.3).
 *
 * Fixed inputs only — NO live encryption (ciphertext is supplied as fixed byte arrays so the run
 * is reproducible). One vault, two spaces (`dialog`, `code`), three appends each in a fixed,
 * interleaved order. `created_at` values are present and intentionally NON-monotonic to exercise
 * AI-7 (timestamps must not affect ordering or roots).
 */
import { createSpine, type AppendInput } from "../src/spine/spine.js";
import { spaceStateHash } from "../src/spine/space.js";
import { vaultMemoryRoot } from "../src/spine/vault.js";
import { toHex } from "../src/canonical/hash.js";
import { vaultDidFromPubkey, agentDid, ROOT_CAPABILITY_ID } from "../src/identity/did.js";
import type { EncMeta, MemoryKind } from "../src/spine/types.js";
import { MemSpineStore, MemCAS } from "./mem-store.js";

const FIXED_ENC: EncMeta = {
  alg: "AES-256-GCM",
  key_id: "vault-kek-0",
  nonce_b64: "AAAAAAAAAAAAAAAA", // fixed 12-byte zero nonce, base64 — deterministic, not hashed
  wrap_b64: "",
};

/** 32-byte deterministic authority pubkey: bytes 0..31. */
function fixedPubkey(): Uint8Array {
  return new Uint8Array(Array.from({ length: 32 }, (_, i) => i));
}

/** Deterministic ciphertext for the (space, index) cell. */
function fixedCiphertext(spaceTag: number, i: number): Uint8Array {
  return new Uint8Array([spaceTag, i, 0xde, 0xad, 0xbe, 0xef, i, spaceTag]);
}

export interface ScenarioAppend {
  readonly step: number;
  readonly space: string;
  readonly kind: MemoryKind;
  readonly object_id: string;
  readonly seqno: string;
  readonly space_state: string;
  readonly vault_memory_root: string;
}

export interface ScenarioResult {
  readonly vault_did: string;
  readonly writer_did: string;
  readonly capability_id: string;
  readonly appends: ScenarioAppend[];
  readonly final_space_state: Record<string, string>;
  readonly final_vault_memory_root: string;
}

/** Build the append plan: interleave dialog/code, 3 each, with fixed kinds and created_at. */
function plan(vaultDid: string, writerDid: string): AppendInput[] {
  const cells: Array<{ space: string; tag: number; kind: MemoryKind; createdAt: bigint }> = [
    { space: "dialog", tag: 0x10, kind: "dialog", createdAt: 5000n },
    { space: "code", tag: 0x20, kind: "code", createdAt: 4000n },
    { space: "dialog", tag: 0x10, kind: "dialog", createdAt: 3000n },
    { space: "code", tag: 0x20, kind: "code", createdAt: 9000n },
    { space: "dialog", tag: 0x10, kind: "fact", createdAt: 1000n },
    { space: "code", tag: 0x20, kind: "artifact", createdAt: 8000n },
  ];
  const perSpace = new Map<string, number>();
  return cells.map((c) => {
    const i = perSpace.get(c.space) ?? 0;
    perSpace.set(c.space, i + 1);
    return {
      vaultDid,
      space: c.space,
      kind: c.kind,
      ciphertext: fixedCiphertext(c.tag, i),
      enc: FIXED_ENC,
      writerDid,
      capabilityId: ROOT_CAPABILITY_ID,
      createdAt: c.createdAt,
      tags: [`${c.space}-${i}`],
    };
  });
}

/** Run the fixed scenario and return all observable spine commitments. */
export async function runScenario(): Promise<ScenarioResult> {
  const vaultDid = vaultDidFromPubkey(fixedPubkey());
  const writerDid = agentDid("claude", "golden");
  const store = new MemSpineStore();
  const storage = new MemCAS();
  const anchor = { anchor: async () => { throw new Error("unused"); }, latest: async () => null };
  const spine = createSpine({ store, storage, anchor });

  const appends: ScenarioAppend[] = [];
  let step = 0;
  for (const input of plan(vaultDid, writerDid)) {
    const r = await spine.append(input);
    appends.push({
      step,
      space: input.space,
      kind: input.kind,
      object_id: r.object_id,
      seqno: r.seqno.toString(),
      space_state: r.space_state,
      vault_memory_root: r.vault_memory_root,
    });
    step++;
  }

  // Final per-space state + vault root, recomputed independently from the store.
  const spaces = [...(await store.listSpaces(vaultDid))].sort();
  const final_space_state: Record<string, string> = {};
  const heads = [];
  for (const space of spaces) {
    const count = await store.spaceCount(vaultDid, space);
    let cur = await store.spaceHeadHash(vaultDid, space);
    const ids: string[] = [];
    const ZERO = "00".repeat(32);
    while (cur !== ZERO) {
      const o = await store.getObject(vaultDid, cur);
      if (!o) throw new Error("broken chain");
      ids.push(cur);
      cur = o.prev;
    }
    ids.reverse();
    const head = { vaultDid, space, count, objectIds: ids, lastEventHash: await store.spaceHeadHash(vaultDid, space) };
    heads.push(head);
    final_space_state[space] = toHex(spaceStateHash(head));
  }

  return {
    vault_did: vaultDid,
    writer_did: writerDid,
    capability_id: ROOT_CAPABILITY_ID,
    appends,
    final_space_state,
    final_vault_memory_root: toHex(vaultMemoryRoot(heads)),
  };
}
