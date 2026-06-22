/**
 * Vault memory root = stateRoot over all spaces of a vault. CONTRACT frozen; bodies by DeepSeek
 * (TASK §T5c). The vault_memory_root (32 bytes) is the ONLY value handed to an AnchorAdapter.
 */
import { stateRoot } from "../canonical/merkle.js";
import { spaceStateHash, type SpaceHead } from "./space.js";

/**
 * vault_memory_root = stateRoot([ { name: space, canonicalBytes: stateHash(space) } … ]),
 * namespaces ordered by space name (UTF-8 byte order, handled inside stateRoot).
 */
export function vaultMemoryRoot(spaces: readonly SpaceHead[]): Uint8Array {
  return stateRoot(spaces.map((s) => ({ name: s.space, canonicalBytes: spaceStateHash(s) })));
}
