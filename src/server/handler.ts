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
import { isVaultDid } from "../identity/did.js";

// ---------------------------------------------------------------------------
// Safe response helpers
// ---------------------------------------------------------------------------

/** Constant safe error body — NEVER a stack trace, API key, plaintext, or ciphertext. */
const SAFE_INTERNAL_ERROR_BODY = '{"error":"internal error"}';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Authenticator
// ---------------------------------------------------------------------------

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

  async authenticate(req: Request): Promise<{ vaultDid: VaultDid } | null> {
    const value = req.headers.get(this.headerName);
    if (typeof value !== "string") return null;
    if (!isVaultDid(value)) return null;
    return { vaultDid: value };
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Get-or-create + cache one `MnemosyneAgent` per vault. */
export interface AgentRegistry {
  forVault(vaultDid: VaultDid): Promise<MnemosyneAgent>;
}

/**
 * Build a registry that lazily creates (and caches) one agent per vault via `createAgentForVault`.
 * The factory wires the vault's spine/brain/embedder/recall/keys — all secrets stay inside it.
 */
export function createAgentRegistry(
  createAgentForVault: (vaultDid: VaultDid) => MnemosyneAgent | Promise<MnemosyneAgent>,
): AgentRegistry {
  const cache = new Map<VaultDid, Promise<MnemosyneAgent>>();

  return {
    async forVault(vaultDid: VaultDid): Promise<MnemosyneAgent> {
      const existing = cache.get(vaultDid);
      if (existing) return existing;
      const promise = Promise.resolve(createAgentForVault(vaultDid));
      cache.set(vaultDid, promise);
      return promise;
    },
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

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
export function createAgentHandler(deps: {
  registry: AgentRegistry;
  authenticator: Authenticator;
}): (req: Request) => Promise<Response> {
  const { registry, authenticator } = deps;

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // GET /health
    if (method === "GET" && path === "/health") {
      return jsonResponse({ ok: true as const }, 200);
    }

    // POST /turn
    if (method === "POST" && path === "/turn") {
      try {
        // Authenticate
        const auth = await authenticator.authenticate(req);
        if (!auth) {
          return jsonResponse({ error: "unauthorized" }, 401);
        }

        // Parse JSON body
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return jsonResponse({ error: "invalid JSON body" }, 400);
        }

        if (typeof body !== "object" || body === null) {
          return jsonResponse({ error: "body must be a JSON object" }, 400);
        }

        const obj = body as Record<string, unknown>;
        const input = obj.input;
        if (typeof input !== "string" || input.trim().length === 0) {
          return jsonResponse({ error: "input must be a non-empty string" }, 400);
        }

        // Get (or create) the agent for this vault
        const agent = await registry.forVault(auth.vaultDid);

        // Execute the turn
        const result = await agent.turn(input);

        // Build response: map AppendReceipt → {objectId, kind}
        // AppendReceipt has object_id but NOT kind; the handler does not reach into
        // the spine, so kind is set to "" (documented in NOTES).
        const response: TurnResponse = {
          reply: result.reply,
          remembered: result.remembered.map((r) => ({
            objectId: r.object_id,
            kind: "",
          })),
        };

        return jsonResponse(response, 200);
      } catch {
        // Any internal error → safe constant body
        return new Response(SAFE_INTERNAL_ERROR_BODY, {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Everything else → 404
    return jsonResponse({ error: "not found" }, 404);
  };
}
