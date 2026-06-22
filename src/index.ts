/**
 * @mnemosyne/spine — Mnemosyne L0 deterministic memory spine.
 *
 * Public surface:
 *   - canonical: vendored CE v1.3 primitives (hash, integers, strings, jcs, merkle, domains)
 *   - spine:     MemoryObject / MemorySpace / vault root / Spine protocol
 *   - identity:  Vault DID / Agent DID / capability
 *   - crypto:    AES-256-GCM, content commitment (ciphertext) vs content identity (plaintext)
 *   - adapters:  StorageAdapter (LocalCAS) · AnchorAdapter (LocalSigned) · LLMProvider seam
 *   - recall:    L2 derived semantic recall (EmbeddingProvider · RecallIndex · Recall) — out-of-root
 *   - semantic:  L3 derived fact extraction + knowledge graph (FactExtractor · KnowledgeGraph) — out-of-root
 *   - collective: L4 multi-writer delegation (Capability · AuthorizingSpine) — authorization layer
 *   - fabric:    L5 storage backends behind StorageAdapter (MemoryCAS · FabricStorage · network seams)
 */
export * as canonical from "./canonical/index.js";
export * from "./spine/index.js";
export * from "./identity/did.js";
export * from "./crypto/encryption.js";
export * from "./adapters/index.js";
export * as recall from "./recall/index.js";
export * as semantic from "./semantic/index.js";
export * as collective from "./collective/index.js";
export * as fabric from "./fabric/index.js";
