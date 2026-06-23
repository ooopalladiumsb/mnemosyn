/**
 * D11 public surface — real TON anchoring for `vault_memory_root` via paradigm_terra's anchor-body
 * transport (replicated + conformance-pinned, not runtime-coupled). The ONLY module that depends on
 * `@ton/core`; the pure spine never imports it. Live broadcast is operator-gated behind `Broadcaster`.
 */
export * from "./anchor-body.js";
export * from "./broadcaster.js";
export * from "./ton-anchor.js";
