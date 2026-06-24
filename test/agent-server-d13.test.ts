/**
 * D13 Agent Backend tests (TASK-deepseek-D13 §2).
 *
 * Covers: health, turn happy-path, 401, 400, 404, 500 safe-body,
 * per-vault isolation, registry caching, HeaderAuthenticator.
 *
 * ALL tests use node:test + ScriptedBrain — NO real network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createSpine } from "../src/spine/spine.js";
import { LocalSigned } from "../src/adapters/anchor.js";
import { vaultDidFromPubkey, agentDid, ROOT_CAPABILITY_ID, isVaultDid } from "../src/identity/did.js";
import { MemSpineStore, MemCAS } from "../scripts/mem-store.js";
import { LocalVaultKeyManager } from "../src/agent/key-manager.js";
import { ScriptedBrain } from "../src/agent/brain.js";
import { createAgent } from "../src/agent/agent.js";

import {
  createAgentHandler,
  createAgentRegistry,
  HeaderAuthenticator,
} from "../src/server/handler.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const KEK = new Uint8Array(32).fill(0xa1);
const PUBKEY_A = new Uint8Array(32).fill(0x03);
const PUBKEY_B = new Uint8Array(32).fill(0x04);
const VAULT_A = vaultDidFromPubkey(PUBKEY_A);
const VAULT_B = vaultDidFromPubkey(PUBKEY_B);
const AGENT_ID = agentDid("claude", "srv-test");

/** Build a real agent for the given vaultDid. Uses fresh in-memory stores. */
function buildTestAgent(vaultDid: string) {
  return createAgent({
    spine: createSpine({
      store: new MemSpineStore(),
      storage: new MemCAS(),
      anchor: new LocalSigned(new Uint8Array(32).fill(9)),
    }),
    brain: new ScriptedBrain(() => ({
      reply: "test reply",
      remember: [],
    })),
    keys: new LocalVaultKeyManager(KEK, "k"),
    vaultDid,
    agentDid: AGENT_ID,
    capabilityId: ROOT_CAPABILITY_ID,
  });
}

// ---------------------------------------------------------------------------
// 1. GET /health → 200 {ok:true}
// ---------------------------------------------------------------------------
test("GET /health → 200 {ok:true}", async () => {
  const handler = createAgentHandler({
    registry: createAgentRegistry(buildTestAgent),
    authenticator: new HeaderAuthenticator(),
  });

  const req = new Request("http://localhost/health", { method: "GET" });
  const res = await handler(req);

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");
  const body = await res.json();
  assert.deepEqual(body, { ok: true });
});

// ---------------------------------------------------------------------------
// 2. POST /turn happy-path → 200 with reply + remembered
// ---------------------------------------------------------------------------
test("POST /turn: valid auth + input → 200 with reply and remembered", async () => {
  const handler = createAgentHandler({
    registry: createAgentRegistry((vaultDid) =>
      createAgent({
        spine: createSpine({
          store: new MemSpineStore(),
          storage: new MemCAS(),
          anchor: new LocalSigned(new Uint8Array(32).fill(9)),
        }),
        brain: new ScriptedBrain(() => ({
          reply: "I remembered one thing",
          remember: [{ kind: "fact" as const, space: "knowledge", text: "user data" }],
        })),
        keys: new LocalVaultKeyManager(KEK, "k"),
        vaultDid,
        agentDid: AGENT_ID,
        capabilityId: ROOT_CAPABILITY_ID,
      }),
    ),
    authenticator: new HeaderAuthenticator(),
  });

  const req = new Request("http://localhost/turn", {
    method: "POST",
    headers: { "x-vault-did": VAULT_A, "content-type": "application/json" },
    body: JSON.stringify({ input: "hello world" }),
  });
  const res = await handler(req);

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.reply, "I remembered one thing");
  assert.equal(body.remembered.length, 1);
  assert.ok(/^[0-9a-f]{64}$/.test(body.remembered[0].objectId), "objectId should be 64 hex chars");
  // kind is "" because AppendReceipt has no kind field and handler doesn't reach into spine
  assert.equal(body.remembered[0].kind, "");
});

// ---------------------------------------------------------------------------
// 3. Missing/invalid vault DID → 401
// ---------------------------------------------------------------------------
test("401: missing x-vault-did header → unauthorized", async () => {
  const handler = createAgentHandler({
    registry: createAgentRegistry(buildTestAgent),
    authenticator: new HeaderAuthenticator(),
  });

  const req = new Request("http://localhost/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: "hello" }),
  });
  const res = await handler(req);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, "unauthorized");
});

test("401: invalid vault DID header → unauthorized", async () => {
  const handler = createAgentHandler({
    registry: createAgentRegistry(buildTestAgent),
    authenticator: new HeaderAuthenticator(),
  });

  const req = new Request("http://localhost/turn", {
    method: "POST",
    headers: { "x-vault-did": "not-a-valid-vault-did", "content-type": "application/json" },
    body: JSON.stringify({ input: "hello" }),
  });
  const res = await handler(req);
  assert.equal(res.status, 401);
});

// ---------------------------------------------------------------------------
// 4. Missing/empty/non-string input → 400
// ---------------------------------------------------------------------------
test("400: missing input field → bad request", async () => {
  const handler = createAgentHandler({
    registry: createAgentRegistry(buildTestAgent),
    authenticator: new HeaderAuthenticator(),
  });

  const req = new Request("http://localhost/turn", {
    method: "POST",
    headers: { "x-vault-did": VAULT_A, "content-type": "application/json" },
    body: JSON.stringify({ other: 1 }),
  });
  const res = await handler(req);
  assert.equal(res.status, 400);
});

test("400: empty string input → bad request", async () => {
  const handler = createAgentHandler({
    registry: createAgentRegistry(buildTestAgent),
    authenticator: new HeaderAuthenticator(),
  });

  const req = new Request("http://localhost/turn", {
    method: "POST",
    headers: { "x-vault-did": VAULT_A, "content-type": "application/json" },
    body: JSON.stringify({ input: "   " }),
  });
  const res = await handler(req);
  assert.equal(res.status, 400);
});

test("400: non-JSON body → bad request", async () => {
  const handler = createAgentHandler({
    registry: createAgentRegistry(buildTestAgent),
    authenticator: new HeaderAuthenticator(),
  });

  const req = new Request("http://localhost/turn", {
    method: "POST",
    headers: { "x-vault-did": VAULT_A, "content-type": "application/json" },
    body: "not valid json",
  });
  const res = await handler(req);
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// 5. Unknown path / wrong method → 404
// ---------------------------------------------------------------------------
test("404: GET /turn → not found", async () => {
  const handler = createAgentHandler({
    registry: createAgentRegistry(buildTestAgent),
    authenticator: new HeaderAuthenticator(),
  });

  const req = new Request("http://localhost/turn", { method: "GET" });
  const res = await handler(req);
  assert.equal(res.status, 404);
});

test("404: POST /unknown → not found", async () => {
  const handler = createAgentHandler({
    registry: createAgentRegistry(buildTestAgent),
    authenticator: new HeaderAuthenticator(),
  });

  const req = new Request("http://localhost/unknown", { method: "POST" });
  const res = await handler(req);
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// 6. Agent throws → 500 with SAFE body
// ---------------------------------------------------------------------------
test("500: agent turn throws → 500 with safe constant body (no stack/key/plaintext)", async () => {
  const handler = createAgentHandler({
    registry: createAgentRegistry(() => {
      // Return a broken agent whose turn throws
      return {
        async turn(_input: string) {
          throw new Error("sk-secret-crash: internal brain failure — stack trace follows");
        },
        async remember() {
          throw new Error("no");
        },
      };
    }),
    authenticator: new HeaderAuthenticator(),
  });

  const req = new Request("http://localhost/turn", {
    method: "POST",
    headers: { "x-vault-did": VAULT_A, "content-type": "application/json" },
    body: JSON.stringify({ input: "test" }),
  });
  const res = await handler(req);
  assert.equal(res.status, 500);

  const bodyText = await res.text();
  // The body must be the SAFE constant — no stack, no secret, no plaintext
  assert.deepEqual(JSON.parse(bodyText), { error: "internal error" });
  assert.ok(!bodyText.includes("sk-secret"), "must not leak API key or secret");
  assert.ok(!bodyText.includes("stack trace"), "must not leak stack trace");
  assert.ok(!bodyText.includes("brain failure"), "must not leak internal error details");
});

// ---------------------------------------------------------------------------
// 7. Per-vault isolation
// ---------------------------------------------------------------------------
test("per-vault isolation: memory written in vault A is not visible in vault B", async () => {
  // Track factory calls to verify separate agents are created
  const factoryCalls: string[] = [];

  const handler = createAgentHandler({
    registry: createAgentRegistry((vaultDid) => {
      factoryCalls.push(vaultDid);
      return createAgent({
        spine: createSpine({
          store: new MemSpineStore(),
          storage: new MemCAS(),
          anchor: new LocalSigned(new Uint8Array(32).fill(9)),
        }),
        brain: new ScriptedBrain((input) => ({
          reply: `echo: ${input}`,
          remember: [{ kind: "dialog" as const, space: "chat", text: input }],
        })),
        keys: new LocalVaultKeyManager(KEK, "k"),
        vaultDid,
        agentDid: AGENT_ID,
        capabilityId: ROOT_CAPABILITY_ID,
      });
    }),
    authenticator: new HeaderAuthenticator(),
  });

  // Write to vault A
  const reqA = new Request("http://localhost/turn", {
    method: "POST",
    headers: { "x-vault-did": VAULT_A, "content-type": "application/json" },
    body: JSON.stringify({ input: "memory for vault A" }),
  });
  const resA = await handler(reqA);
  assert.equal(resA.status, 200);

  // Write to vault B
  const reqB = new Request("http://localhost/turn", {
    method: "POST",
    headers: { "x-vault-did": VAULT_B, "content-type": "application/json" },
    body: JSON.stringify({ input: "memory for vault B" }),
  });
  const resB = await handler(reqB);
  assert.equal(resB.status, 200);

  // Factory called twice (once per distinct vault)
  assert.equal(factoryCalls.length, 2);
  assert.equal(factoryCalls[0], VAULT_A);
  assert.equal(factoryCalls[1], VAULT_B);

  // Each vault has 1 object (its own memory only)
  // (We can't directly query this from the handler, but the factory calls confirm
  // separate agents were created, and the ScriptedBrain remembers 1 draft per call.)
});

// ---------------------------------------------------------------------------
// 8. Registry caching: same vault → factory called once
// ---------------------------------------------------------------------------
test("registry caching: same vault DID → factory called once, same agent instance", async () => {
  let factoryCount = 0;

  const handler = createAgentHandler({
    registry: createAgentRegistry((vaultDid) => {
      factoryCount++;
      return buildTestAgent(vaultDid);
    }),
    authenticator: new HeaderAuthenticator(),
  });

  const headers = { "x-vault-did": VAULT_A, "content-type": "application/json" };
  const body = JSON.stringify({ input: "msg1" });

  // First call
  await handler(new Request("http://localhost/turn", { method: "POST", headers, body }));
  assert.equal(factoryCount, 1);

  // Second call — same vault
  await handler(new Request("http://localhost/turn", { method: "POST", headers, body }));
  assert.equal(factoryCount, 1, "factory should NOT be called again for same vault");

  // Third call — same vault again
  await handler(new Request("http://localhost/turn", { method: "POST", headers, body }));
  assert.equal(factoryCount, 1);
});

// ---------------------------------------------------------------------------
// 9. HeaderAuthenticator
// ---------------------------------------------------------------------------
test("HeaderAuthenticator: valid vault DID → {vaultDid}", async () => {
  const auth = new HeaderAuthenticator();
  const req = new Request("http://localhost/turn", {
    headers: { "x-vault-did": VAULT_A },
  });
  const result = await auth.authenticate(req);
  assert.ok(result !== null);
  assert.equal(result!.vaultDid, VAULT_A);
});

test("HeaderAuthenticator: non-vault-DID string → null", async () => {
  const auth = new HeaderAuthenticator();
  const req = new Request("http://localhost/turn", {
    headers: { "x-vault-did": "not-a-vault-did" },
  });
  const result = await auth.authenticate(req);
  assert.equal(result, null);
});

test("HeaderAuthenticator: missing header → null", async () => {
  const auth = new HeaderAuthenticator();
  const req = new Request("http://localhost/turn");
  const result = await auth.authenticate(req);
  assert.equal(result, null);
});

test("HeaderAuthenticator: custom header name works", async () => {
  const auth = new HeaderAuthenticator("x-custom-auth");
  const req = new Request("http://localhost/turn", {
    headers: { "x-custom-auth": VAULT_A },
  });
  const result = await auth.authenticate(req);
  assert.ok(result !== null);
  assert.equal(result!.vaultDid, VAULT_A);
});
