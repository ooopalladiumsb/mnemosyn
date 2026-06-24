/**
 * D12 Live Brain tests (TASK-deepseek-D12 §2).
 *
 * Covers: well-formed parse, empty remember, kind/space coercion,
 * malformed JSON fallback, non-2xx fallback, fetch-throw fallback,
 * request-shape check, seam structural check, deepseekBrain factory.
 *
 * ALL tests use injected `fetchImpl` — NO real network calls.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  OpenAICompatBrain,
  buildSystemPrompt,
  buildMessages,
  parseBrainTurn,
  deepseekBrain,
} from "../src/agent/openai-compat-brain.js";
import type { RecalledContext, BrainTurn } from "../src/agent/brain.js";

// ---------------------------------------------------------------------------
// Mock fetch helpers
// ---------------------------------------------------------------------------

type MockFetch = (url: string | URL, init?: RequestInit) => Promise<Response>;
type CapturedRequest = { url: string; method: string; headers: Record<string, string>; body: string };

/** Create a mock fetch that returns a canned JSON response. Captures the request. */
function mockFetchJson(jsonBody: unknown, status = 200): { fetchImpl: MockFetch; captures: CapturedRequest[] } {
  const captures: CapturedRequest[] = [];
  const fetchImpl: MockFetch = async (url, init) => {
    captures.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(
        Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
      ),
      body: typeof init?.body === "string" ? init.body : "",
    });
    return new Response(JSON.stringify(jsonBody), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetchImpl, captures };
}

/** Create a mock fetch that throws (network error). Captures the request. */
function mockFetchThrow(): { fetchImpl: MockFetch; captures: CapturedRequest[] } {
  const captures: CapturedRequest[] = [];
  const fetchImpl: MockFetch = async (url, init) => {
    captures.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(
        Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
      ),
      body: typeof init?.body === "string" ? init.body : "",
    });
    throw new Error("fetch failed (mock)");
  };
  return { fetchImpl, captures };
}

/** Create a mock fetch that returns plain text (non-JSON). */
function mockFetchText(text: string, status = 200): { fetchImpl: MockFetch; captures: CapturedRequest[] } {
  const captures: CapturedRequest[] = [];
  const fetchImpl: MockFetch = async (url, init) => {
    captures.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(
        Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
      ),
      body: typeof init?.body === "string" ? init.body : "",
    });
    return new Response(text, { status, headers: { "Content-Type": "text/plain" } });
  };
  return { fetchImpl, captures };
}

const EMPTY_CONTEXT: RecalledContext = { query: "", hits: [] };

// ---------------------------------------------------------------------------
// 1. Well-formed parse
// ---------------------------------------------------------------------------
test("well-formed: valid JSON {reply, remember:[2 drafts]} → correct BrainTurn", async () => {
  const { fetchImpl } = mockFetchJson({
    choices: [{ message: { content: JSON.stringify({
      reply: "Hello! I've remembered two things.",
      remember: [
        { kind: "fact", space: "knowledge", text: "The user greeted me", tags: ["greeting"] },
        { kind: "code", space: "snippets", text: "console.log('hello')" },
      ],
    }) } }],
  });

  const brain = new OpenAICompatBrain({
    baseURL: "https://test.local",
    model: "test-model",
    apiKey: "sk-test-123",
    spaces: ["knowledge", "snippets", "chat"],
    fetchImpl,
  });

  const result = await brain.turn("Hello!", EMPTY_CONTEXT);
  assert.equal(result.reply, "Hello! I've remembered two things.");
  assert.equal(result.remember.length, 2);
  assert.equal(result.remember[0]!.kind, "fact");
  assert.equal(result.remember[0]!.space, "knowledge");
  assert.equal(result.remember[0]!.text, "The user greeted me");
  assert.deepEqual(result.remember[0]!.tags, ["greeting"]);
  assert.equal(result.remember[1]!.kind, "code");
  assert.equal(result.remember[1]!.text, "console.log('hello')");
});

// ---------------------------------------------------------------------------
// 2. Empty remember
// ---------------------------------------------------------------------------
test("empty remember: {reply, remember:[]} → reply + no drafts", async () => {
  const { fetchImpl } = mockFetchJson({
    choices: [{ message: { content: JSON.stringify({
      reply: "Nothing worth remembering.",
      remember: [],
    }) } }],
  });

  const brain = new OpenAICompatBrain({
    baseURL: "https://test.local",
    model: "test-model",
    apiKey: "sk-test-123",
    fetchImpl,
  });

  const result = await brain.turn("Hi", EMPTY_CONTEXT);
  assert.equal(result.reply, "Nothing worth remembering.");
  assert.equal(result.remember.length, 0);
});

// ---------------------------------------------------------------------------
// 3. Coercion: unknown kind → "fact", wrong space → first allowed, empty text → dropped
// ---------------------------------------------------------------------------
test("coercion: unknown kind→fact, wrong space→first allowed, empty text→dropped", async () => {
  const { fetchImpl } = mockFetchJson({
    choices: [{ message: { content: JSON.stringify({
      reply: "coerced",
      remember: [
        { kind: "unknown_kind", space: "chat", text: "should be fact" },
        { kind: "dialog", space: "disallowed_space", text: "should be in first allowed space" },
        { kind: "fact", space: "chat", text: "   " },  // empty → dropped
        { kind: "fact", space: "chat", text: "valid" },
      ],
    }) } }],
  });

  const brain = new OpenAICompatBrain({
    baseURL: "https://test.local",
    model: "test-model",
    apiKey: "sk-test-123",
    spaces: ["chat", "knowledge"],
    fetchImpl,
  });

  const result = await brain.turn("test", EMPTY_CONTEXT);
  assert.equal(result.reply, "coerced");
  assert.equal(result.remember.length, 3, "should have 3 drafts (1 dropped)");

  // unknown kind → "fact"
  assert.equal(result.remember[0]!.kind, "fact");
  assert.equal(result.remember[0]!.text, "should be fact");

  // wrong space → "chat" (first allowed)
  assert.equal(result.remember[1]!.kind, "dialog");
  assert.equal(result.remember[1]!.space, "chat");
  assert.equal(result.remember[1]!.text, "should be in first allowed space");

  // valid
  assert.equal(result.remember[2]!.text, "valid");
});

// ---------------------------------------------------------------------------
// 4. Malformed JSON content → safe fallback
// ---------------------------------------------------------------------------
test("malformed JSON: non-JSON content → safe fallback (reply present, remember:[])", async () => {
  const rawText = "I'm sorry, I cannot output JSON today.";
  const { fetchImpl } = mockFetchJson({
    choices: [{ message: { content: rawText } }],  // not valid JSON
  });

  const brain = new OpenAICompatBrain({
    baseURL: "https://test.local",
    model: "test-model",
    apiKey: "sk-test-123",
    fetchImpl,
  });

  const result = await brain.turn("test", EMPTY_CONTEXT);
  // Must not throw
  assert.ok(result.reply.length > 0, "reply should be non-empty fallback");
  assert.ok(result.reply.includes("I'm sorry"), "reply should contain raw text");
  assert.equal(result.remember.length, 0, "remember must be empty on fallback");
});

// ---------------------------------------------------------------------------
// 5. Non-2xx response → safe fallback (apiKey NOT in reply)
// ---------------------------------------------------------------------------
test("non-2xx: 401 unauthorized → safe fallback, no apiKey leak", async () => {
  const { fetchImpl } = mockFetchJson({ error: { message: "Unauthorized" } }, 401);

  const brain = new OpenAICompatBrain({
    baseURL: "https://test.local",
    model: "test-model",
    apiKey: "sk-secret-key-12345",
    fetchImpl,
  });

  const result = await brain.turn("test", EMPTY_CONTEXT);
  assert.equal(result.remember.length, 0);
  assert.ok(!result.reply.includes("sk-secret-key"), "apiKey must NOT appear in fallback reply");
  assert.ok(result.reply.includes("401") || result.reply.includes("Unauthorized"), "should mention error details");
});

test("non-2xx: 500 internal error → safe fallback", async () => {
  const { fetchImpl } = mockFetchText("Internal Server Error", 500);

  const brain = new OpenAICompatBrain({
    baseURL: "https://test.local",
    model: "test-model",
    apiKey: "sk-test-123",
    fetchImpl,
  });

  const result = await brain.turn("test", EMPTY_CONTEXT);
  assert.equal(result.remember.length, 0);
  assert.ok(result.reply.includes("500"), "should mention status code");
});

// ---------------------------------------------------------------------------
// 6. fetch throws (network error) → safe fallback
// ---------------------------------------------------------------------------
test("fetch throws: network error → safe fallback (no throw)", async () => {
  const { fetchImpl } = mockFetchThrow();

  const brain = new OpenAICompatBrain({
    baseURL: "https://test.local",
    model: "test-model",
    apiKey: "sk-test-123",
    fetchImpl,
  });

  const result = await brain.turn("test", EMPTY_CONTEXT);
  assert.equal(result.remember.length, 0);
  assert.ok(result.reply.includes("network error") || result.reply.includes("could not reach"), "should mention network error");
});

// ---------------------------------------------------------------------------
// 7. Request shape: verify the mock fetch was called correctly
// ---------------------------------------------------------------------------
test("request shape: fetch called with correct URL, headers, model", async () => {
  const { fetchImpl, captures } = mockFetchJson({
    choices: [{ message: { content: JSON.stringify({ reply: "ok", remember: [] }) } }],
  });

  const brain = new OpenAICompatBrain({
    baseURL: "https://api.example.com",
    model: "gpt-4o-mini",
    apiKey: "sk-test-123",
    fetchImpl,
  });

  await brain.turn("Hello", EMPTY_CONTEXT);

  assert.equal(captures.length, 1, "fetch should be called exactly once");
  assert.equal(captures[0]!.url, "https://api.example.com/chat/completions");
  assert.equal(captures[0]!.method, "POST");
  assert.equal(captures[0]!.headers["authorization"], "Bearer sk-test-123");
  assert.equal(captures[0]!.headers["content-type"], "application/json");

  const body = JSON.parse(captures[0]!.body);
  assert.equal(body.model, "gpt-4o-mini");
  assert.equal(body.response_format.type, "json_object");
  assert.ok(Array.isArray(body.messages), "messages should be an array");
});

test("request shape: system prompt includes Kind and Space enumeration", async () => {
  const { fetchImpl, captures } = mockFetchJson({
    choices: [{ message: { content: JSON.stringify({ reply: "ok", remember: [] }) } }],
  });

  const brain = new OpenAICompatBrain({
    baseURL: "https://test.local",
    model: "test",
    apiKey: "sk-test-123",
    spaces: ["chat", "knowledge"],
    fetchImpl,
  });

  await brain.turn("test", EMPTY_CONTEXT);

  const body = JSON.parse(captures[0]!.body);
  const systemMsg = body.messages.find((m: any) => m.role === "system")?.content ?? "";
  assert.ok(systemMsg.includes('"dialog"'), "system prompt should list MemoryKind values");
  assert.ok(systemMsg.includes('"code"'), "system prompt should list MemoryKind values");
  assert.ok(systemMsg.includes('"chat"'), "system prompt should list allowed spaces");
  assert.ok(systemMsg.includes('"knowledge"'), "system prompt should list allowed spaces");
});

test("request shape: recalled context appears in messages", async () => {
  const { fetchImpl, captures } = mockFetchJson({
    choices: [{ message: { content: JSON.stringify({ reply: "ok", remember: [] }) } }],
  });

  const brain = new OpenAICompatBrain({
    baseURL: "https://test.local",
    model: "test",
    apiKey: "sk-test-123",
    fetchImpl,
  });

  const context: RecalledContext = {
    query: "what is the capital?",
    hits: [
      { objectId: "obj:1", text: "Paris is the capital of France", kind: "fact", score: 0.95 },
    ],
  };

  await brain.turn("what is the capital?", context);

  const body = JSON.parse(captures[0]!.body);
  const contextMsg = body.messages.find((m: any) =>
    m.role === "system" && m.content.includes("prior memories"),
  );
  assert.ok(contextMsg, "should have a system message with recalled context");
  assert.ok(contextMsg.content.includes("Paris is the capital"), "context should include recalled text");
  assert.ok(contextMsg.content.includes("fact"), "context should include kind");
  assert.ok(contextMsg.content.includes("0.95"), "context should include score");
});

// ---------------------------------------------------------------------------
// 8. Seam (structural): no spine / key-manager import
// ---------------------------------------------------------------------------
test("seam structural: openai-compat-brain.ts imports only brain.js + spine/types.js", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const body = readFileSync(
    join(__dirname, "..", "src", "agent", "openai-compat-brain.ts"),
    "utf8",
  );

  // Must not import spine/spine or key-manager
  assert.ok(
    !/(?:from\s+['"])(?:\.\.\/spine\/spine|\.\/key-manager)/.test(body),
    "openai-compat-brain.ts must not import spine/spine or key-manager",
  );

  // Must import brain.js and spine/types.js
  assert.ok(
    /from\s+['"]\.\/brain\.js['"]/.test(body),
    "openai-compat-brain.ts must import ./brain.js",
  );
  assert.ok(
    /from\s+['"]\.\.\/spine\/types\.js['"]/.test(body),
    "openai-compat-brain.ts must import ../spine/types.js",
  );
});

// ---------------------------------------------------------------------------
// 9. deepseekBrain factory
// ---------------------------------------------------------------------------
test("deepseekBrain: builds OpenAICompatBrain with DeepSeek baseURL and model", async () => {
  const { fetchImpl, captures } = mockFetchJson({
    choices: [{ message: { content: JSON.stringify({ reply: "deepseek ok", remember: [] }) } }],
  });

  const brain = deepseekBrain("sk-ds-123", "deepseek-v4-flash", { fetchImpl });
  assert.equal(brain.name, "openai-compat:deepseek-v4-flash");

  await brain.turn("hello", EMPTY_CONTEXT);
  assert.equal(captures.length, 1);
  assert.equal(captures[0]!.url, "https://api.deepseek.com/chat/completions");
  const body = JSON.parse(captures[0]!.body);
  assert.equal(body.model, "deepseek-v4-flash");
});

test("deepseekBrain: custom model works", () => {
  const brain = deepseekBrain("key", "deepseek-v4-pro");
  assert.equal(brain.name, "openai-compat:deepseek-v4-pro");
});

// ---------------------------------------------------------------------------
// Bonus: parseBrainTurn unit tests (exported for testing)
// ---------------------------------------------------------------------------
test("parseBrainTurn: valid JSON → correct BrainTurn", () => {
  const result = parseBrainTurn(
    JSON.stringify({ reply: "hi", remember: [{ kind: "fact", space: "chat", text: "data" }] }),
    ["chat"],
  );
  assert.equal(result.reply, "hi");
  assert.equal(result.remember.length, 1);
  assert.equal(result.remember[0]!.text, "data");
});

test("parseBrainTurn: remembers with missing text → dropped", () => {
  const result = parseBrainTurn(
    JSON.stringify({
      reply: "x",
      remember: [
        { kind: "fact", space: "chat", text: "" },
        { kind: "fact", space: "chat", text: "ok" },
      ],
    }),
    ["chat"],
  );
  assert.equal(result.remember.length, 1);
  assert.equal(result.remember[0]!.text, "ok");
});

test("parseBrainTurn: non-object → safe fallback", () => {
  const result = parseBrainTurn("just a string", ["chat"]);
  assert.equal(result.reply, "just a string");
  assert.equal(result.remember.length, 0);
});

test("parseBrainTurn: empty content → safe fallback", () => {
  const result = parseBrainTurn("", ["chat"]);
  assert.ok(result.reply.includes("no content"), "should provide fallback text");
  assert.equal(result.remember.length, 0);
});

test("parseBrainTurn: missing reply field → safe fallback", () => {
  const result = parseBrainTurn(
    JSON.stringify({ remember: [] }),
    ["chat"],
  );
  assert.ok(result.reply.includes("not provide a valid reply"), "should indicate missing reply");
  assert.equal(result.remember.length, 0);
});

test("parseBrainTurn: no remember field → empty array", () => {
  const result = parseBrainTurn(
    JSON.stringify({ reply: "ok" }),
    ["chat"],
  );
  assert.equal(result.reply, "ok");
  assert.equal(result.remember.length, 0);
});

// ---------------------------------------------------------------------------
// Bonus: buildSystemPrompt / buildMessages unit tests
// ---------------------------------------------------------------------------
test("buildSystemPrompt: includes all MemoryKind values and spaces", () => {
  const prompt = buildSystemPrompt(["chat", "knowledge"]);
  assert.ok(prompt.includes("dialog"));
  assert.ok(prompt.includes("tool_call"));
  assert.ok(prompt.includes("chat"));
  assert.ok(prompt.includes("knowledge"));
  assert.ok(prompt.includes("fact"));
});

test("buildMessages: correct roles and order", () => {
  const ctx: RecalledContext = {
    query: "q",
    hits: [{ objectId: "x", text: "some memory", kind: "fact", score: 0.8 }],
  };
  const msgs = buildMessages("hello", ctx, "You are helpful.");
  assert.equal(msgs.length, 3);
  assert.equal(msgs[0]!.role, "system");
  assert.equal(msgs[0]!.content, "You are helpful.");
  assert.equal(msgs[1]!.role, "system");
  assert.ok(msgs[1]!.content.includes("prior memories"));
  assert.ok(msgs[1]!.content.includes("some memory"));
  assert.equal(msgs[2]!.role, "user");
  assert.equal(msgs[2]!.content, "hello");
});

test("buildMessages: empty context → no context block", () => {
  const msgs = buildMessages("hello", { query: "", hits: [] }, "system");
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0]!.role, "system");
  assert.equal(msgs[1]!.role, "user");
});
