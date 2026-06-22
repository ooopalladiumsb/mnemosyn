# Implementation notes — DeepSeek (L1 Anchor)

Executor notes for `docs/TASK-deepseek-L1.md`. Bodies and tests; no frozen contract was modified.
Every non-obvious choice the task asked me to record is below. No objection was raised — all
contracts were implementable as specified.

## Design choices

### 1. Persistence format + file layout under `dir`

When `options.dir` is set, `LocalSigned` persists per-vault state in:

```
<dir>/<sanitized-vault-did>.json
```

**Sanitization.** `vaultDid` (`memory://vault/<base32>`) contains `:` and `/` which are not safe in
filenames. Both are replaced with `_` (underscore). The encoding is deterministic and invertible
within the `memory://vault/` prefix since `_` never appears in the base32 alphabet.

**File content (JSON-of-hex, NOT hashed):**

```json
{
  "latest": {
    "root": "<hex>",
    "version": "<decimal bigint as string>"
  },
  "chain": [
    { "vault_did": "...", "version": "0", "root": "...", "prev": "00...00" },
    ...
  ]
}
```

`version` is serialized as a decimal string (JSON has no native bigint) and parsed back via
`BigInt()` on recovery.

**Recovery.** The constructor synchronously reads all `.json` files in `dir` via `readdirSync`
+ `readFileSync`. Each file is parsed and validated; `vaultDid` is reconstructed from the filename
by reversing the sanitization. Within each vault, the chain is sorted by `version` (via `BigInt`
comparison), never by readdir or filesystem order. This matches the spec requirement that
"recovery MUST order each chain by version, not by readdir order."

**Idempotency across restarts.** The `latest` map and the last element of the sorted chain must
agree on `(root, version)`. If they don't, the chain's last element takes precedence (the chain
is the canonical truth; `latest` is a cache).

### 2. Ed25519 public-key derivation path (SPKI/PKCS#8 round-trip)

Both `ed25519KeyFromSeed` (private, already in anchor.ts) and `ed25519PublicKeyFromSeed` (new,
in checkpoint.ts) use the same RFC 8410 PKCS#8 DER wrapper:

```
PKCS8_PREFIX = 302e020100300506032b657004220420 (hex)
DER = PKCS8_PREFIX || raw_32_byte_seed
```

`ed25519PublicKeyFromSeed`:
1. Wraps the raw 32-byte seed in PKCS#8 DER → `createPrivateKey`
2. Derives the public key via `createPublicKey(privateKey)`
3. Exports SPKI DER → `publicKey.export({ format: "der", type: "spki" })`
4. Extracts the **last 32 bytes** of the SPKI DER as the raw Ed25519 public key

Ed25519 SPKI is `302a300506032b6570032100` (12-byte prefix) followed by the 32-byte raw public
key. Taking the trailing 32 bytes is equivalent to the standard `sk_to_pk()` derivation.

**Raw-key byte slice used:** `spkiDer.subarray(spkiDer.length - 32)` — the last 32 bytes.

### 3. L1 golden vectors placement

Placed in `vectors/anchor/golden.json` (sibling to `vectors/spine/golden.json`). Reasons:
- Keeps spine and anchor vectors separate, matching the layer separation in the build order.
- `_status: "PRE-NORMATIVE"` on both; the architect promotes independently.
- The anchor scenario script is in `scripts/anchor-scenario.ts` (mirroring `scripts/spine-scenario.ts`).
- The golden test is in `test/anchor-golden.test.ts`.

`npm run vectors:generate` now produces BOTH files.

### 4. Idempotency definition

Re-anchoring the head is considered idempotent when BOTH `version` and `root` match the current
head EXACTLY:
- `version === head.version` AND `root === head.root` → no-op, returns a receipt with the same
  proof from the original anchor; the chain does NOT grow.
- `version === head.version` but `root !== head.root` → `[ANCHOR_VERSION_CONFLICT]` error.
- `version < head.version` → `[ANCHOR_VERSION_REGRESSION]` error.
- `version > head.version + 1` → `[ANCHOR_VERSION_GAP]` error.
- `version === head.version + 1` → normal append.

The proof for the idempotent case is the EXISTING proof from the original anchor, not a re-sign.
While Ed25519 is deterministic and re-signing would produce an identical signature, the intent
of idempotency is that the chain doesn't change — so we simply return the original receipt.

### 5. In-memory chain alongside latestByVault

`LocalSigned` maintains TWO parallel per-vault structures:
- `latestByVault: Map<string, {root, version}>` — fast O(1) lookup (existing L0 surface).
- `chainByVault: Map<string, AnchorCheckpoint[]>` — ordered chain (new L1 surface).

Both are always kept consistent. The chain is the canonical truth; `latestByVault` is a
derived cache. On recovery from disk, the chain is loaded first, then `latestByVault` is
reconstructed from the chain tail.

### 6. TonAnchor seam

`TonAnchor implements AnchorAdapter` is a typed stub in `anchor.ts` whose methods throw
`[ANCHOR_NOT_AVAILABLE]`. Placed in `anchor.ts` (not `checkpoint.ts`) as instructed — it sits
next to `LocalSigned`. Exported as a new symbol; no network, no TON dependency.

### 7. verifyReceipt error handling

`verifyReceipt` catches `fromHex` parse errors (odd-length hex, invalid chars) and returns
`false` rather than letting canonical-encoding errors propagate. Only malformed pubkey length
throws (spec §1 explicit requirement). A valid-length-but-wrong pubkey returns `false`.

### 8. Empty chain validation

`verifyCheckpointChain([])` returns `{ok: true}` — empty chain is vacuously valid. This is
consistent with `chain()` returning `[]` for a never-anchored vault and the spec's "vacuously
valid" requirement.

## Objection

**None.** All frozen contracts were implementable as specified. The `DurableAnchorAdapter` extends
`AnchorAdapter` cleanly; the persistence format is implementation-private and round-trips exactly;
the signing surface is unchanged (`{root, vaultDid, version}` only). No wall-clock enters any
hashed value.

## Gate results

| Gate | Result |
|------|--------|
| `npm run typecheck` | PASS — clean, 0 errors |
| `npm test` | PASS — 72 tests (36 L0 + 9 conformance + 25 L1 + 2 anchor golden), 0 fail |
| `npm run test:conformance` | PASS — 9 conformance tests, unchanged, 0 fail |
| `npm run vectors:generate` | PASS — regenerates spine + anchor golden; golden tests reproduce committed vectors |
| AI-7 | PASS — no wall-clock in any checkpoint; `anchorCheckpointId` is pure; golden vector independent of time |
| No new runtime deps | PASS — `package.json` unchanged; `node:crypto`, `node:fs`, `node:path`, `node:buffer` only |
| Signing surface unchanged | PASS — `LocalSigned.anchor()` still signs `{root, vaultDid, version}` |

## Files touched

**Modified:**
- `src/adapters/checkpoint.ts` — implemented `anchorCheckpointId`, `verifyReceipt`,
  `verifyCheckpointChain`, `ed25519PublicKeyFromSeed`
- `src/adapters/anchor.ts` — extended `LocalSigned` with chain management, durability, monotonic/
  idempotent/gapless enforcement, `TonAnchor` seam
- `scripts/generate-vectors.ts` — extended to also generate anchor golden vectors

**Created:**
- `test/anchor-l1.test.ts` — 7 test groups covering all required scenarios
- `test/anchor-golden.test.ts` — golden vector reproduction test
- `scripts/anchor-scenario.ts` — deterministic anchor scenario for vectors
- `vectors/anchor/golden.json` — L1 golden vectors (PRE-NORMATIVE)
- `docs/NOTES-deepseek-L1.md` — this file

**NOT modified (frozen):**
- `src/spine/types.ts`
- `src/canonical/domains.ts`
- `package.json`
- All existing L0 source, tests, and the L0 golden vector
