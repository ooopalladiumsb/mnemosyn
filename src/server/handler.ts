/**
 * D13 — agent backend (the service the Telegram Mini App will call). A FRAMEWORK-AGNOSTIC Web
 * `fetch` handler `(Request) => Promise<Response>` — Request/Response are web standards present in
 * both Node 22 and Bun, so the handler is testable under `node:test` directly (construct a Request,
 * call, assert the Response) AND bindable to `Bun.serve` for deployment (see `serve-bun.ts`).
 *
 * The service is thin: authenticate a request to a vault, get-or-create that vault's `MnemosyneAgent`
 * (D10 — wiring of spine/brain/embedder/keys is the injected factory's concern), run `turn`, respond.
 * Per-vault isolation: each vault has its own agent + memory. Secrets/keys live in the factory, never
 * in a response. Auth and persistence backends are seams (real Telegram/TON-Connect auth = D14).
 *
 * ARCHITECT-OWNED CONTRACT. The interfaces + function signatures below are FROZEN; DeepSeek
 * implements the bodies (docs/TASK-deepseek-D13.md). New exports may be added.
 */
import type { MnemosyneAgent } from "../agent/agent.js";
import type { VaultDid } from "../spine/types.js";

/** Maps an incoming request to the vault it acts on, or null if unauthorized. */
export interface Authenticator {
  authenticate(req: Request): Promise<{ vaultDid: VaultDid } | null>;
}

/**
 * Dev/test authenticator: reads the vault DID from a request header (default `x-vault-did`) and
 * validates its shape. NOT for production (real auth = Telegram initData / TON Connect, D14).
 */
export class HeaderAuthenticator implements Authenticator {
  constructor(private readonly headerName: string = "x-vault-did") {}

  async authenticate(_req: Request): Promise<{ vaultDid: VaultDid } | null> {
    void this.headerName;
    throw new Error("[TODO_D13] HeaderAuthenticator.authenticate not implemented");
  }
}

/** Get-or-create + cache one `MnemosyneAgent` per vault. */
export interface AgentRegistry {
  forVault(vaultDid: VaultDid): Promise<MnemosyneAgent>;
}

/**
 * Build a registry that lazily creates (and caches) one agent per vault via `createAgentForVault`.
 * The factory wires the vault's spine/brain/embedder/recall/keys — all secrets stay inside it.
 */
export function createAgentRegistry(
  _createAgentForVault: (vaultDid: VaultDid) => MnemosyneAgent | Promise<MnemosyneAgent>,
): AgentRegistry {
  throw new Error("[TODO_D13] createAgentRegistry not implemented");
}

/** The `POST /turn` response body. */
export interface TurnResponse {
  readonly reply: string;
  readonly remembered: ReadonlyArray<{ readonly objectId: string; readonly kind: string }>;
}

/**
 * A Web fetch handler for the agent service. Routes:
 *  - `GET  /health` → 200 `{ "ok": true }`
 *  - `POST /turn`   → authenticate → `registry.forVault(vaultDid).turn(input)` → 200 `TurnResponse`.
 *    401 (unauthenticated), 400 (missing/invalid `input`), 404 (other paths), 500 (internal — a SAFE
 *    JSON error, never a stack trace, key, or plaintext). All responses are `application/json`.
 */
export function createAgentHandler(_deps: {
  registry: AgentRegistry;
  authenticator: Authenticator;
}): (req: Request) => Promise<Response> {
  throw new Error("[TODO_D13] createAgentHandler not implemented");
}
