/**
 * L4 Collective public surface (D8). Multi-writer delegation: a Vault authority grants scoped
 * write capabilities to Agent DIDs; an AuthorizingSpine enforces them before append. Capability
 * is hashable (CAPABILITY_V1) and signed; the L0 spine is wrapped, not modified.
 */
export * from "./capability.js";
export * from "./authorizing-spine.js";
