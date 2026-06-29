/**
 * D14 Telegram Mini App tests (TASK-deepseek-D14 §3).
 *
 * Covers: verifyInitData, vaultDidForTelegramUser, TelegramInitDataAuthenticator, withCors.
 * ALL tests build initData in-test with a known bot token — NO real network/Telegram.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Buffer } from "node:buffer";

import { createAgentHandler, createAgentRegistry, HeaderAuthenticator } from "../src/server/handler.js";
import { withCors, type CorsOptions } from "../src/server/cors.js";
import {
  verifyInitData,
  vaultDidForTelegramUser,
  TelegramInitDataAuthenticator,
  type VerifiedInitData,
} from "../src/telegram/init-data-auth.js";
import { isVaultDid } from "../src/identity/did.js";

// ---------------------------------------------------------------------------
// initData builder (Telegram WebApp spec)
// ---------------------------------------------------------------------------

const TEST_BOT_TOKEN = "123456:ABC-DEF1234ghikl-mnopqr";
const VAULT_SECRET = new Uint8Array(32).fill(0x5a);

/**
 * Build a valid initData query string with a correct hash.
 * Fields are sorted by key, data_check_string = sorted(key=value)\n joined.
 * secret = HMAC_SHA256("WebAppData", botToken)
 * hash = hex(HMAC_SHA256(secret, data_check_string))
 */
function buildInitData(
  fields: Record<string, string>,
  botToken: string = TEST_BOT_TOKEN,
): string {
  // Remove hash if present, we'll compute it
  const { hash: _, ...rest } = fields as Record<string, string>;
  
  // Sort keys
  const sortedKeys = Object.keys(rest).sort();
  const parts = sortedKeys.map((k) => `${k}=${rest[k]}`);
  const dataCheckString = parts.join("\n");

  // secret = HMAC_SHA256("WebAppData", botToken)
  const secretHmac = createHmac("sha256", "WebAppData");
  secretHmac.update(botToken);
  const secret = secretHmac.digest();

  // hash = HMAC_SHA256(secret, data_check_string)
  const hashHmac = createHmac("sha256", secret);
  hashHmac.update(dataCheckString);
  const hash = Buffer.from(hashHmac.digest()).toString("hex");

  // Build final query string: all fields (sorted) + hash
  const allParts = [...parts, `hash=${hash}`];
  return allParts.join("&");
}

/** Standard valid initData with known user. */
function validInitData(): string {
  return buildInitData({
    query_id: "AAHdF6IQAAAAAd8XohAhr1Ok",
    user: JSON.stringify({
      id: 123456789,
      first_name: "Test",
      last_name: "User",
      username: "testuser",
      language_code: "en",
    }),
    auth_date: "2000000000",
    hash: "", // placeholder, will be computed
  });
}

/** Fake current time far enough from auth_date to pass freshness check. */
const FAKE_NOW = 2000000100;

// ---------------------------------------------------------------------------
// 1. verifyInitData
// ---------------------------------------------------------------------------

test("verifyInitData: valid initData → returns VerifiedInitData with userId", () => {
  const initData = validInitData();
  const result = verifyInitData(initData, TEST_BOT_TOKEN, { nowSeconds: FAKE_NOW });
  assert.ok(result !== null);
  assert.equal(result!.userId, "123456789");
  assert.ok(result!.params instanceof URLSearchParams);
});

test("verifyInitData: hash mismatch (tampered field) → null", () => {
  const initData = validInitData();
  // Tamper: change a query parameter value (not nested in user JSON)
  const tampered = initData.replace("auth_date=2000000000", "auth_date=2000000001");
  const result = verifyInitData(tampered, TEST_BOT_TOKEN, { nowSeconds: FAKE_NOW });
  assert.equal(result, null);
});

test("verifyInitData: wrong bot token → null", () => {
  const initData = validInitData();
  const result = verifyInitData(initData, "wrong-bot-token-here", { nowSeconds: FAKE_NOW });
  assert.equal(result, null);
});

test("verifyInitData: stale auth_date → null", () => {
  const initData = validInitData();
  // now is FAKE_NOW (2000000100), auth_date is 2000000000 → diff = 100 < 86400 → valid
  // Make now far in the future: 2000100000 → diff = 100000 > 86400 → stale
  const result = verifyInitData(initData, TEST_BOT_TOKEN, { nowSeconds: 2000100000 });
  assert.equal(result, null);
});

test("verifyInitData: fresh auth_date (within maxAge) → valid", () => {
  // Rebuild with auth_date very close to now
  const initData = buildInitData({
    query_id: "AAHdF6IQAAAAAd8XohAhr1Ok",
    user: JSON.stringify({ id: 999, first_name: "F" }),
    auth_date: "2000000095",
    hash: "",
  });
  const result = verifyInitData(initData, TEST_BOT_TOKEN, {
    nowSeconds: FAKE_NOW,
    maxAgeSeconds: 86400,
  });
  assert.ok(result !== null);
  assert.equal(result!.userId, "999");
});

test("verifyInitData: custom maxAgeSeconds rejects stale", () => {
  const initData = validInitData();
  // Tight maxAge of 50 seconds
  const result = verifyInitData(initData, TEST_BOT_TOKEN, {
    nowSeconds: FAKE_NOW,
    maxAgeSeconds: 50,
  });
  // auth_date diff = 100 > 50 → stale
  assert.equal(result, null);
});

test("verifyInitData: missing user → null", () => {
  const initData = buildInitData({
    query_id: "AAHdF6IQAAAAAd8XohAhr1Ok",
    auth_date: "2000000000",
    hash: "",
  });
  const result = verifyInitData(initData, TEST_BOT_TOKEN, { nowSeconds: FAKE_NOW });
  assert.equal(result, null);
});

test("verifyInitData: missing user.id → null", () => {
  const initData = buildInitData({
    query_id: "AAHdF6IQAAAAAd8XohAhr1Ok",
    user: JSON.stringify({ first_name: "NoId" }),
    auth_date: "2000000000",
    hash: "",
  });
  const result = verifyInitData(initData, TEST_BOT_TOKEN, { nowSeconds: FAKE_NOW });
  assert.equal(result, null);
});

test("verifyInitData: missing hash → null", () => {
  const result = verifyInitData("user=%7B%7D&auth_date=1", TEST_BOT_TOKEN);
  assert.equal(result, null);
});

test("verifyInitData: missing auth_date (allowed, no freshness check)", () => {
  const initData = buildInitData({
    query_id: "AAHdF6IQAAAAAd8XohAhr1Ok",
    user: JSON.stringify({ id: 42, first_name: "X" }),
    hash: "",
  });
  // No auth_date field at all → freshness check skipped
  const result = verifyInitData(initData, TEST_BOT_TOKEN);
  assert.ok(result !== null);
  assert.equal(result!.userId, "42");
});

test("verifyInitData: malformed initData string → null", () => {
  const result = verifyInitData("not-valid-url-query\u0000broken", TEST_BOT_TOKEN);
  assert.equal(result, null);
});

test("verifyInitData: bot token NOT in any output", () => {
  const initData = validInitData();
  const result = verifyInitData(initData, TEST_BOT_TOKEN, { nowSeconds: FAKE_NOW });
  assert.ok(result !== null);
  // The VerifiedInitData only contains userId and params — no bot token
  const asStr = JSON.stringify(result);
  assert.ok(!asStr.includes(TEST_BOT_TOKEN), "bot token must NOT appear in VerifiedInitData");
  assert.ok(!asStr.includes("abc"), "no token substring should leak");
});

// ---------------------------------------------------------------------------
// 2. vaultDidForTelegramUser
// ---------------------------------------------------------------------------

test("vaultDidForTelegramUser: deterministic (same id → same DID)", () => {
  const did1 = vaultDidForTelegramUser("12345", VAULT_SECRET);
  const did2 = vaultDidForTelegramUser("12345", VAULT_SECRET);
  assert.equal(did1, did2, "same user id must produce same vault DID");
});

test("vaultDidForTelegramUser: different ids → different DIDs", () => {
  const didA = vaultDidForTelegramUser("alice", VAULT_SECRET);
  const didB = vaultDidForTelegramUser("bob", VAULT_SECRET);
  assert.notEqual(didA, didB);
});

test("vaultDidForTelegramUser: result is a valid Vault DID", () => {
  const did = vaultDidForTelegramUser("42", VAULT_SECRET);
  assert.ok(isVaultDid(did), `must be a valid Vault DID, got: ${did}`);
  assert.ok(did.startsWith("memory://vault/"));
});

test("vaultDidForTelegramUser: different secret → different DID", () => {
  const s1 = vaultDidForTelegramUser("user", VAULT_SECRET);
  const s2 = vaultDidForTelegramUser("user", new Uint8Array(32).fill(0x77));
  assert.notEqual(s1, s2);
});

// ---------------------------------------------------------------------------
// 3. TelegramInitDataAuthenticator
// ---------------------------------------------------------------------------

test("TelegramInitDataAuthenticator: valid initData header → {vaultDid}", async () => {
  const auth = new TelegramInitDataAuthenticator({
    botToken: TEST_BOT_TOKEN,
    vaultSecret: VAULT_SECRET,
    nowSeconds: () => FAKE_NOW,
  });

  const initData = validInitData();
  const req = new Request("http://localhost/turn", {
    method: "POST",
    headers: { "x-telegram-init-data": initData },
  });

  const result = await auth.authenticate(req);
  assert.ok(result !== null);
  assert.equal(result!.vaultDid, vaultDidForTelegramUser("123456789", VAULT_SECRET));
  assert.ok(isVaultDid(result!.vaultDid));
});

test("TelegramInitDataAuthenticator: missing header → null", async () => {
  const auth = new TelegramInitDataAuthenticator({
    botToken: TEST_BOT_TOKEN,
    vaultSecret: VAULT_SECRET,
  });

  const req = new Request("http://localhost/turn", { method: "POST" });
  const result = await auth.authenticate(req);
  assert.equal(result, null);
});

test("TelegramInitDataAuthenticator: invalid initData → null", async () => {
  const auth = new TelegramInitDataAuthenticator({
    botToken: TEST_BOT_TOKEN,
    vaultSecret: VAULT_SECRET,
    nowSeconds: () => FAKE_NOW,
  });

  const req = new Request("http://localhost/turn", {
    method: "POST",
    headers: { "x-telegram-init-data": "garbage-data" },
  });

  const result = await auth.authenticate(req);
  assert.equal(result, null);
});

test("TelegramInitDataAuthenticator: custom header name works", async () => {
  const auth = new TelegramInitDataAuthenticator({
    botToken: TEST_BOT_TOKEN,
    vaultSecret: VAULT_SECRET,
    headerName: "x-custom-tg-auth",
    nowSeconds: () => FAKE_NOW,
  });

  const initData = validInitData();
  const req = new Request("http://localhost/turn", {
    method: "POST",
    headers: { "x-custom-tg-auth": initData },
  });

  const result = await auth.authenticate(req);
  assert.ok(result !== null);
  assert.equal(result!.userId, undefined); // Authenticator returns {vaultDid} not userId
});

test("TelegramInitDataAuthenticator: bot token never leaks via return value", async () => {
  const auth = new TelegramInitDataAuthenticator({
    botToken: TEST_BOT_TOKEN,
    vaultSecret: VAULT_SECRET,
    nowSeconds: () => FAKE_NOW,
  });

  const req = new Request("http://localhost/turn", {
    method: "POST",
    headers: { "x-telegram-init-data": validInitData() },
  });

  const result = await auth.authenticate(req);
  assert.ok(result !== null);
  assert.ok(!result!.vaultDid.includes(TEST_BOT_TOKEN), "bot token must not appear in vaultDid");
  assert.ok(!result!.vaultDid.includes("123456"), "bot token must not appear");
});

// ---------------------------------------------------------------------------
// 4. withCors
// ---------------------------------------------------------------------------

/** A simple echo handler for CORS tests. */
function echoHandler(req: Request): Promise<Response> {
  return Promise.resolve(new Response(`echo: ${req.method} ${req.url}`, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  }));
}

test("withCors: OPTIONS from allowed origin → 204 + CORS headers", async () => {
  const cors = withCors(echoHandler, {
    origins: ["https://allowed.example.com"],
  });

  const req = new Request("http://localhost/turn", {
    method: "OPTIONS",
    headers: { origin: "https://allowed.example.com" },
  });
  const res = await cors(req);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://allowed.example.com");
  assert.ok(res.headers.get("access-control-allow-methods")!.includes("POST"));
  assert.ok(res.headers.get("access-control-allow-headers")!.includes("x-telegram-init-data"));
});

test("withCors: OPTIONS from disallowed origin → 204 with no allow-origin", async () => {
  const cors = withCors(echoHandler, {
    origins: ["https://allowed.example.com"],
  });

  const req = new Request("http://localhost/turn", {
    method: "OPTIONS",
    headers: { origin: "https://evil.example.com" },
  });
  const res = await cors(req);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
  // Methods + headers still returned (browser needs them for the preflight response)
  assert.ok(res.headers.get("access-control-allow-methods"), "methods still returned");
});

test("withCors: normal GET from allowed origin → response has allow-origin header", async () => {
  const cors = withCors(echoHandler, {
    origins: ["https://allowed.example.com"],
  });

  const req = new Request("http://localhost/health", {
    method: "GET",
    headers: { origin: "https://allowed.example.com" },
  });
  const res = await cors(req);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://allowed.example.com");
});

test("withCors: normal GET from disallowed origin → no allow-origin header", async () => {
  const cors = withCors(echoHandler, {
    origins: ["https://allowed.example.com"],
  });

  const req = new Request("http://localhost/health", {
    method: "GET",
    headers: { origin: "https://evil.example.com" },
  });
  const res = await cors(req);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("withCors: '*' origin allows any", async () => {
  const cors = withCors(echoHandler, {
    origins: "*",
  });

  const req = new Request("http://localhost/turn", {
    method: "OPTIONS",
    headers: { origin: "https://any-origin.example.com" },
  });
  const res = await cors(req);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});

test("withCors: normal GET through '*' → response has * origin", async () => {
  const cors = withCors(echoHandler, { origins: "*" });

  const req = new Request("http://localhost/health", {
    method: "GET",
    headers: { origin: "https://any.example.com" },
  });
  const res = await cors(req);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});

test("withCors: wrapped handler still works (integration with D13 handler)", async () => {
  // Build a minimal D13 handler
  const handler = createAgentHandler({
    registry: createAgentRegistry(() => {
      throw new Error("agent not needed for CORS test");
    }),
    authenticator: new HeaderAuthenticator(),
  });

  const cors = withCors(handler, {
    origins: ["https://allowed.example.com"],
  });

  // GET /health should still work
  const req = new Request("http://localhost/health", {
    method: "GET",
    headers: { origin: "https://allowed.example.com" },
  });
  const res = await cors(req);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://allowed.example.com");

  const body = await res.json();
  assert.deepEqual(body, { ok: true });
});

test("withCors: preflight uses Max-Age header", async () => {
  const cors = withCors(echoHandler, {
    origins: ["https://allowed.example.com"],
  });

  const req = new Request("http://localhost/turn", {
    method: "OPTIONS",
    headers: { origin: "https://allowed.example.com" },
  });
  const res = await cors(req);
  // Should have a Max-Age header
  assert.ok(
    res.headers.get("access-control-max-age"),
    "should have access-control-max-age header",
  );
});
