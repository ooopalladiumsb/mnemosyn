/**
 * @mnemosyne/agent public surface (D10). The Stage-0 agent host over @mnemosyne/spine: a Brain seam
 * (the real LLM decider) + Vault key custody (the KEK the spine deliberately never holds) + a loop
 * facade that drives recall → brain → seal → append. Conceptually the `@mnemosyne/agent` package;
 * lives here under `src/agent/` and depends only on the public spine surface (clean to extract).
 */
export * from "./brain.js";
export * from "./key-manager.js";
export * from "./agent.js";
