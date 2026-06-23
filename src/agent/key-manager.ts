/**
 * @mnemosyne/agent — Vault key custody (D10). The host concern Mnemosyne deliberately does NOT own:
 * the deterministic spine takes ciphertext + `EncMeta` and never holds a key. A `VaultKeyManager`
 * holds the Vault KEK, SEALS plaintext into ciphertext+EncMeta for the spine, and OPENS it back.
 *
 * INVARIANT: the KEK and the plaintext NEVER enter a hashed value — `content_commit` is taken over
 * the CIPHERTEXT only (D2, ciphertext-only commitments). A public/signed root over plaintext would
 * be a content-guessing oracle. Real impls back the KEK with an OS keychain / TEE; the in-memory
 * `LocalVaultKeyManager` is the reference (it reuses the L0 AES-256-GCM `encrypt`/`decrypt`).
 *
 * ARCHITECT-OWNED CONTRACT. `SealedContent`, `VaultKeyManager`, and `LocalVaultKeyManager`
 * SIGNATURES are FROZEN; DeepSeek implements the body (docs/TASK-deepseek-D10.md).
 */
import type { EncMeta } from "../spine/types.js";
import { encrypt, decrypt } from "../crypto/encryption.js";

/** Ciphertext + the `EncMeta` the committed `MemoryObject` will carry. Fed straight to `spine.append`. */
export interface SealedContent {
  readonly ciphertext: Uint8Array;
  readonly enc: EncMeta;
}

/**
 * Vault KEK custody. `seal` encrypts plaintext → `SealedContent`; `open` decrypts it back. The KEK
 * lives behind this boundary and is never returned, logged, or hashed.
 */
export interface VaultKeyManager {
  readonly keyId: string;
  seal(plaintext: Uint8Array): Promise<SealedContent>;
  open(ciphertext: Uint8Array, enc: EncMeta): Promise<Uint8Array>;
}

/**
 * In-memory reference key manager: holds a raw 32-byte Vault KEK + a `keyId`, AES-256-GCM via the
 * L0 `crypto/encryption` primitives. The GCM nonce is fresh per `seal` (the only non-determinism;
 * permitted because the spine commits the resulting ciphertext, not the nonce in isolation).
 */
export class LocalVaultKeyManager implements VaultKeyManager {
  readonly keyId: string;
  private readonly kek: Uint8Array;

  constructor(vaultKek: Uint8Array, keyId: string) {
    this.keyId = keyId;
    // Store a copy so caller mutation of the input array cannot change the held KEK.
    this.kek = vaultKek.slice();
  }

  async seal(plaintext: Uint8Array): Promise<SealedContent> {
    const r = encrypt(plaintext, this.kek, this.keyId);
    return { ciphertext: r.ciphertext, enc: r.enc };
  }

  async open(ciphertext: Uint8Array, enc: EncMeta): Promise<Uint8Array> {
    return decrypt(ciphertext, enc, this.kek);
  }
}
