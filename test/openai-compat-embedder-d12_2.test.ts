/**
 * D12.2 Live Embedder tests (TASK-deepseek-D12.2 §2).
 *
 * Covers: well-formed parse, dim mismatch, non-2xx fallback, fetch-throw,
 * malformed body, request-shape, seam structural, factory config.
 *
 * ALL tests use injected `fetchImpl` — NO real network calls.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  OpenAICompatEmbedder,
  geminiEmbedder,
  jinaEmbedder,
} from "../src/recall/openai-compat-embedder.js";

// ---------------------------------------------------------------------------
// Mock fetch helpers
// ---------------------------------------------------------------------------

type MockFetch = (url: string | URL, init?: RequestInit) => Promise<Response>;
type CapturedRequest = { url: string; method: string; headers: Record<string, string>; body: string };

/** Mock that returns a valid embedding JSON with `dim` floats. */
function mockFetchEmbed(dim: number, values?: number[]): {
  fetchImpl: MockFetch;
  captures: CapturedRequest[];
} {
  const vec = values ?? Array.from({ length: dim }, (_, i) => (i + 1) * 0.1);
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
    return new Response(
      JSON.stringify({ data: [{ embedding: vec }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  return { fetchImpl, captures };
}

/** Mock that returns a non-2xx status. */
function mockFetchStatus(status: number, bodyText = ""): {
  fetchImpl: MockFetch;
  captures: CapturedRequest[];
} {
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
    return new Response(bodyText, { status, headers: { "Content-Type": "text/plain" } });
  };
  return { fetchImpl, captures };
}

/** Mock that throws on fetch. */
function mockFetchThrow(): {
  fetchImpl: MockFetch;
  captures: CapturedRequest[];
} {
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

/** Mock that returns a 200 but with malformed body. */
function mockFetchJson(body: unknown, status = 200): {
  fetchImpl: MockFetch;
  captures: CapturedRequest[];
} {
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
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
    const ct = typeof body === "string" ? "text/plain" : "application/json";
    return new Response(bodyStr, { status, headers: { "Content-Type": ct } });
  };
  return { fetchImpl, captures };
}

// ---------------------------------------------------------------------------
// 1. Well-formed parse
// ---------------------------------------------------------------------------
test("well-formed: valid embedding with matching dimension → Float32Array", async () => {
  const dim = 8;
  const expectedValues = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  const { fetchImpl } = mockFetchEmbed(dim, expectedValues);

  const emb = new OpenAICompatEmbedder({
    baseURL: "https://api.example.com",
    model: "test-model",
    apiKey: "sk-test-123",
    dimension: dim,
    fetchImpl,
  });

  const vec = await emb.embed("hello world");
  assert.equal(vec.length, dim);
  for (let i = 0; i < dim; i++) {
    assert.ok(Math.abs(vec[i]! - expectedValues[i]!) < 1e-6, `vec[${i}] should be ${expectedValues[i]}`);
  }
});

test("well-formed: name reflects model", () => {
  const emb = new OpenAICompatEmbedder({
    baseURL: "https://api.example.com",
    model: "test-embedder-v1",
    apiKey: "sk-test-123",
    dimension: 512,
  });
  assert.equal(emb.name, "openai-compat:test-embedder-v1");
  assert.equal(emb.dimension, 512);
});

// ---------------------------------------------------------------------------
// 2. Dimension mismatch
// ---------------------------------------------------------------------------
test("dimension mismatch: returned vector length ≠ config.dimension → [EMBED_DIM_MISMATCH]", async () => {
  const configDim = 8;
  const returnedDim = 16; // different length
  const values = Array.from({ length: returnedDim }, (_, i) => (i + 1) * 0.1);
  const { fetchImpl } = mockFetchEmbed(returnedDim, values);

  const emb = new OpenAICompatEmbedder({
    baseURL: "https://api.example.com",
    model: "test",
    apiKey: "sk-123",
    dimension: configDim,
    fetchImpl,
  });

  await assert.rejects(
    () => emb.embed("test"),
    /EMBED_DIM_MISMATCH/,
  );
});

// ---------------------------------------------------------------------------
// 3. Non-2xx → [EMBED_FAILED] (no apiKey)
// ---------------------------------------------------------------------------
test("non-2xx: 401 unauthorized → [EMBED_FAILED], apiKey NOT in message", async () => {
  const { fetchImpl } = mockFetchStatus(401, "Unauthorized");

  const emb = new OpenAICompatEmbedder({
    baseURL: "https://api.example.com",
    model: "test",
    apiKey: "sk-secret-do-not-leak",
    dimension: 8,
    fetchImpl,
  });

  await assert.rejects(
    () => emb.embed("test"),
    (err: Error) => {
      return /EMBED_FAILED/.test(err.message) &&
             !err.message.includes("sk-secret") &&
             err.message.includes("401");
    },
  );
});

test("non-2xx: 500 internal error → [EMBED_FAILED]", async () => {
  const { fetchImpl } = mockFetchStatus(500, "Internal Server Error");

  const emb = new OpenAICompatEmbedder({
    baseURL: "https://api.example.com",
    model: "test",
    apiKey: "sk-123",
    dimension: 8,
    fetchImpl,
  });

  await assert.rejects(
    () => emb.embed("test"),
    /EMBED_FAILED.*500/,
  );
});

// ---------------------------------------------------------------------------
// 4. fetch throws → [EMBED_FAILED]
// ---------------------------------------------------------------------------
test("fetch throws: network error → [EMBED_FAILED]", async () => {
  const { fetchImpl } = mockFetchThrow();

  const emb = new OpenAICompatEmbedder({
    baseURL: "https://api.example.com",
    model: "test",
    apiKey: "sk-123",
    dimension: 8,
    fetchImpl,
  });

  await assert.rejects(
    () => emb.embed("test"),
    /EMBED_FAILED/,
  );
});

// ---------------------------------------------------------------------------
// 5. Malformed body → [EMBED_FAILED]
// ---------------------------------------------------------------------------
test("malformed body: empty data array → [EMBED_FAILED]", async () => {
  const { fetchImpl } = mockFetchJson({ data: [] });

  const emb = new OpenAICompatEmbedder({
    baseURL: "https://api.example.com",
    model: "test",
    apiKey: "sk-123",
    dimension: 8,
    fetchImpl,
  });

  await assert.rejects(() => emb.embed("test"), /EMBED_FAILED/);
});

test("malformed body: no data field → [EMBED_FAILED]", async () => {
  const { fetchImpl } = mockFetchJson({ result: "ok" });

  const emb = new OpenAICompatEmbedder({
    baseURL: "https://api.example.com",
    model: "test",
    apiKey: "sk-123",
    dimension: 8,
    fetchImpl,
  });

  await assert.rejects(() => emb.embed("test"), /EMBED_FAILED/);
});

test("malformed body: embedding not an array → [EMBED_FAILED]", async () => {
  const { fetchImpl } = mockFetchJson({ data: [{ embedding: "not-an-array" }] });

  const emb = new OpenAICompatEmbedder({
    baseURL: "https://api.example.com",
    model: "test",
    apiKey: "sk-123",
    dimension: 8,
    fetchImpl,
  });

  await assert.rejects(() => emb.embed("test"), /EMBED_FAILED/);
});

test("malformed body: non-JSON response → [EMBED_FAILED]", async () => {
  const { fetchImpl } = mockFetchJson("plain text, not JSON");

  const emb = new OpenAICompatEmbedder({
    baseURL: "https://api.example.com",
    model: "test",
    apiKey: "sk-123",
    dimension: 8,
    fetchImpl,
  });

  await assert.rejects(() => emb.embed("test"), /EMBED_FAILED/);
});

// ---------------------------------------------------------------------------
// 6. Request shape
// ---------------------------------------------------------------------------
test("request shape: fetch called with correct URL, headers, model, input", async () => {
  const { fetchImpl, captures } = mockFetchEmbed(4);

  const emb = new OpenAICompatEmbedder({
    baseURL: "https://api.jina.ai/v1",
    model: "jina-embeddings-v3",
    apiKey: "sk-jina-123",
    dimension: 4,
    fetchImpl,
  });

  await emb.embed("semantic search query");

  assert.equal(captures.length, 1);
  assert.equal(captures[0]!.url, "https://api.jina.ai/v1/embeddings");
  assert.equal(captures[0]!.method, "POST");
  assert.equal(captures[0]!.headers["authorization"], "Bearer sk-jina-123");
  assert.equal(captures[0]!.headers["content-type"], "application/json");

  const body = JSON.parse(captures[0]!.body);
  assert.equal(body.model, "jina-embeddings-v3");
  assert.equal(body.input, "semantic search query");
});

// ---------------------------------------------------------------------------
// 7. Seam (structural): imports only ./embedding.js
// ---------------------------------------------------------------------------
test("seam structural: openai-compat-embedder.ts imports only ./embedding.js", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const body = readFileSync(
    join(__dirname, "..", "src", "recall", "openai-compat-embedder.ts"),
    "utf8",
  );

  // Must import ./embedding.js
  assert.ok(
    /from\s+['"]\.\/embedding\.js['"]/.test(body),
    "must import ./embedding.js",
  );

  // Must NOT import spine, agent, recall-index, key-manager, or canonical
  const forbiddenPatterns = [
    /from\s+['"](?:\.\.\/)?spine\//,
    /from\s+['"](?:\.\.\/)?agent\//,
    /from\s+['"]\.\/recall-index/,
    /from\s+['"]\.\.\/agent\/key-manager/,
    /from\s+['"].*key-manager/,
    /from\s+['"](?:\.\.\/)?canonical\//,
  ];
  for (const pat of forbiddenPatterns) {
    assert.ok(!pat.test(body), `must not import forbidden module: ${pat}`);
  }
});

// ---------------------------------------------------------------------------
// 8. Factories: gemini/jina
// ---------------------------------------------------------------------------
test("geminiEmbedder: correct baseURL, model, dimension, name", () => {
  const emb = geminiEmbedder("sk-gem-123");
  assert.equal(emb.dimension, 768);
  assert.equal(emb.name, "openai-compat:text-embedding-004");
});

test("geminiEmbedder: custom model and dimension", () => {
  const emb = geminiEmbedder("sk-gem-123", "text-embedding-005", 1024);
  assert.equal(emb.dimension, 1024);
  assert.equal(emb.name, "openai-compat:text-embedding-005");
});

test("jinaEmbedder: correct baseURL, model, dimension, name", () => {
  const emb = jinaEmbedder("sk-jina-123");
  assert.equal(emb.dimension, 1024);
  assert.equal(emb.name, "openai-compat:jina-embeddings-v3");
});

test("jinaEmbedder: custom model and dimension", () => {
  const emb = jinaEmbedder("sk-jina-123", "jina-embeddings-v4", 512);
  assert.equal(emb.dimension, 512);
  assert.equal(emb.name, "openai-compat:jina-embeddings-v4");
});

// ---------------------------------------------------------------------------
// Factory request shape tests
// ---------------------------------------------------------------------------
test("geminiEmbedder: sends request to Gemini URL", async () => {
  const { fetchImpl, captures } = mockFetchEmbed(768);

  const emb = geminiEmbedder("sk-gem-123", "text-embedding-004", 768, { fetchImpl });
  await emb.embed("test");

  assert.equal(captures.length, 1);
  assert.ok(
    captures[0]!.url.startsWith("https://generativelanguage.googleapis.com/v1beta/openai"),
  );
  const body = JSON.parse(captures[0]!.body);
  assert.equal(body.model, "text-embedding-004");
});

test("jinaEmbedder: sends request to Jina URL", async () => {
  const { fetchImpl, captures } = mockFetchEmbed(1024);

  const emb = jinaEmbedder("sk-jina-123", "jina-embeddings-v3", 1024, { fetchImpl });
  await emb.embed("test");

  assert.equal(captures.length, 1);
  assert.equal(captures[0]!.url, "https://api.jina.ai/v1/embeddings");
  const body = JSON.parse(captures[0]!.body);
  assert.equal(body.model, "jina-embeddings-v3");
});
