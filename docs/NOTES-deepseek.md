# Implementation notes — DeepSeek (L0 spine)

Executor notes for `docs/TASK-deepseek-L0.md`. Bodies only; no frozen contract was modified
(`src/spine/types.ts` and `src/canonical/domains.ts` are byte-unchanged). Every non-obvious choice
the task asked me to record is below, followed by one **objection** I was required to raise rather
than silently "fix".

## Design choices

1. **GCM tag placement (T3).** AES-256-GCM ciphertext is stored as `aes_gcm_ciphertext || tag`
   (16-byte tag appended). `decrypt` splits the trailing 16 bytes back off. The 12-byte nonce is the
   only non-determinism in the system and is permitted because it is never hashed — `content_commit`
   is taken over the resulting ciphertext, and the spine stores whatever ciphertext it is handed.

2. **DEK/KEK (T3).** v0 uses the 32-byte vault KEK directly as the data key (no per-object DEK), so
   `enc.wrap_b64 = ""`. The field is carried for the future per-object-DEK path. `key_id` is the
   caller-supplied vault key identifier.

3. **Content Identity (T3).** `contentIdentity = HMAC-SHA256(vault_content_key, plaintext)`. It is
   owner-local (dedup/migration only), is NOT a field of `MemoryObject`, and is NEVER anchored —
   anchoring a plaintext-derived value would be a guessing oracle.

4. **Base32 alphabet (T4).** Vault DID uses RFC 4648 base32 with the **lower-cased** alphabet
   `abcdefghijklmnopqrstuvwxyz234567`, **no `=` padding**. A 32-byte pubkey encodes to exactly 52
   chars. `isVaultDid` validates prefix + charset + decoded-length 32 + canonical round-trip (so a
   non-canonical encoding with stray trailing bits is rejected).

5. **Agent DID (T4).** `agent:<scheme>:<id>`; `scheme`/`id` must be non-empty and contain no `:`.

6. **Empty-space sentinel (T5b).** `binaryMerkle` is undefined over an empty leaf set, so for a space
   with zero objects `objects_root` is defined as **32 zero bytes**. `spaceStateHash` is therefore
   well-defined from `seqno 0` onward.

7. **Space-head reconstruction (T5d).** `SpineStore` exposes only head/count, so `append`/`checkpoint`
   recover the full ordered `objectIds` list by walking the immutable `prev` chain back from the head
   (then reversing to append order). O(n) per call — acceptable for the L0 reference backend.

8. **`spaceStreamLeaf.lastSeqno` (T5b).** Set to `count` per the explicit §T5b contract. Note this is
   the *next* seqno, not the most-recent one; it is not on the hashed vault-root path (the vault root
   uses `stateRoot` over spaces, not `streamTreeRoot`), so it does not affect any committed value.

9. **Anchor signing (T7).** `LocalSigned` Ed25519-signs `canonicalBytes({root, vaultDid, version})`;
   the 32-byte raw seed is wrapped into PKCS#8 DER for `node:crypto`. `proof` = lowercase-hex
   signature. `latest` is kept in an in-memory map — durable persistence is intentionally out of L0
   scope.

10. **In-memory backends (tests).** `scripts/mem-store.ts` provides `MemSpineStore`/`MemCAS` used by
    the suite and the vector generator. They are not part of `src/` (the only shipped stores are the
    on-disk `LocalCAS` and `LocalSigned`); the object log is backend-pluggable.

11. **Conformance scope (T8.1).** The conformance suite loads terra's `canonical/vectors/golden.json`
    and asserts byte-identical output for the shared CE primitives it actually uses: `uint64`, NFC/
    UTF-8, restricted-JCS (incl. >2^53 integers), binary Merkle (odd duplicate-last), stream-tree
    root, and the four `CE_V13` domain tags (verified via `domainHash(tag, ∅)`). Terra-only vectors
    are skipped with a logged note: `int256`/`uint256` (not ported), `ADDRESS`/`DSL`/`CAL`/`MCP`/
    `frame` tags, and `state_root_genesis_empty` (the STATE_ROOT *machinery* is covered by the merkle
    vectors; the genesis namespace *content* is terra CAL-domain knowledge, not a CE primitive).

## Objection (per TASK §0.1 — raised, not silently fixed)

**`created_at` and the hashing surface — AI-7 vs §T5a/§3.**

Three parts of the task are in tension:

- **Invariant AI-7** (spec §3, Decision Record): *"No timestamp participates in ordering, hashing
  semantics, or replay logic."* — migration-hard, authoritative.
- **§T8.4** (required test): the `vault_memory_root` must be **identical** across runs that differ
  only in `created_at`.
- **§T5a** hint ("omit `created_at` from the canonical object *iff* it is `undefined`") and **§3**
  (which lists `created_at` inside `public_meta`, and `meta_commit` commits `public_meta`).

If `created_at` is serialized into `memoryObjectCanonicalBytes` (when present) **or** into
`metaCommit` via `public_meta`, then `object_id` — and therefore `space_state` and
`vault_memory_root` — would vary with the timestamp, **violating AI-7 and failing §T8.4**.

**Resolution.** I treated AI-7 as the controlling authority and excluded `created_at` from **all**
commitments: it is serialized into neither `memoryObjectCanonicalBytes` nor `metaCommit`. It remains
a stored, returnable, opaque field of `MemoryObject` (the frozen `types.ts` shape is unchanged). The
stable rule is therefore: **`created_at` participates in no hash, ever** (stronger than, and
superseding, the §T5a "omit iff undefined" hint).

If the architect actually intends `created_at` to be committed, then AI-7's wording and the §T8.4
test must change — that is a Decision-Record-level change and is flagged here for ruling.
