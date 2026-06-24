/**
 * D13 agent backend public surface. A framework-agnostic web `fetch` handler over the D10 agent
 * (per-vault, authenticated), plus a thin `Bun.serve` binding for deployment. The Telegram Mini App
 * (D14) calls this. Secrets/keys live in the injected agent factory, never in a response.
 */
export * from "./handler.js";
export * from "./serve-bun.js";
