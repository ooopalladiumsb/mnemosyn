/**
 * L5 Fabric public surface (D9). Storage backends behind the frozen `StorageAdapter` seam:
 * a conformance harness, the in-memory `MemoryCAS`, a multi-replica `FabricStorage`
 * (+ out-of-band `ContentLocator`), and typed IPFS/BTFS/TON network seams (live wiring deferred).
 * Storage location is content-addressed and OUT OF ROOT — it never enters a MemoryObject.
 */
export * from "./conformance.js";
export * from "./memory-cas.js";
export * from "./fabric-storage.js";
export * from "./network-seams.js";
