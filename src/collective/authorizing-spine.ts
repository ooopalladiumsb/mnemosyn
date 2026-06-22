/**
 * L4 Collective — authorizing spine facade (D8). Wraps a `Spine` and gates `append` behind a
 * `CapabilityGrant`: the write is admitted only if the grant is authentic (verifyGrant) AND
 * authorizes the (writer, space, append) AND the object's `capabilityId` references that grant.
 *
 * The L0 spine is NOT modified — this facade calls its existing `append` after the checks pass
 * (ratified: separate verifier, frozen L0 intact). Reads/checkpoint pass straight through (reads
 * are unguarded in v1). DeepSeek implements the body (docs/TASK-deepseek-L4.md).
 *
 * ARCHITECT-OWNED CONTRACT. The interface and `createAuthorizingSpine` signature are FROZEN.
 */
import type { Spine, AppendInput } from "../spine/spine.js";
import type { AppendReceipt, MemoryObject, VaultDid } from "../spine/types.js";
import type { AnchorReceipt } from "../adapters/anchor.js";
import type { CapabilityGrant } from "./capability.js";
import { verifyGrant, grantAuthorizes } from "./capability.js";

/**
 * A `Spine`-shaped facade whose `append` requires a `CapabilityGrant`. Throws on an unauthorized
 * write (`[COLLECTIVE_BAD_GRANT]` — grant not authentic for the configured authority;
 * `[COLLECTIVE_UNAUTHORIZED]` — grant does not cover this writer/space/action;
 * `[COLLECTIVE_CAPABILITY_MISMATCH]` — `input.capabilityId !== grant.capability_id`).
 */
export interface AuthorizingSpine {
  append(input: AppendInput, grant: CapabilityGrant): Promise<AppendReceipt>;
  recallById(vaultDid: VaultDid, objectId: string): Promise<{ obj: MemoryObject; ciphertext: Uint8Array }>;
  checkpoint(vaultDid: VaultDid): Promise<AnchorReceipt>;
}

/**
 * Wrap a `Spine` with capability enforcement. `authorityPublicKey` is the raw 32-byte Vault
 * authority key that issued grants are verified against. The wrapped spine is used unchanged.
 */
export function createAuthorizingSpine(deps: {
  spine: Spine;
  authorityPublicKey: Uint8Array;
}): AuthorizingSpine {
  const { spine, authorityPublicKey } = deps;

  return {
    async append(input: AppendInput, grant: CapabilityGrant): Promise<AppendReceipt> {
      // 1. Verify grant authenticity.
      if (!verifyGrant(grant, authorityPublicKey)) {
        throw new Error("[COLLECTIVE_BAD_GRANT] grant not authentic for the configured authority");
      }
      // 2. Scope check.
      if (
        !grantAuthorizes(grant, {
          vaultDid: input.vaultDid,
          space: input.space,
          action: "append",
          writerDid: input.writerDid,
        })
      ) {
        throw new Error("[COLLECTIVE_UNAUTHORIZED] grant does not authorize this write");
      }
      // 3. Capability id match: the object committed must reference this grant.
      if (input.capabilityId !== grant.capability_id) {
        throw new Error(
          `[COLLECTIVE_CAPABILITY_MISMATCH] input.capabilityId ${input.capabilityId} does not match grant ${grant.capability_id}`,
        );
      }
      // 4. Delegate to the UNMODIFIED L0 spine.
      return spine.append(input);
    },

    recallById(vaultDid: VaultDid, objectId: string) {
      return spine.recallById(vaultDid, objectId);
    },

    checkpoint(vaultDid: VaultDid) {
      return spine.checkpoint(vaultDid);
    },
  };
}
