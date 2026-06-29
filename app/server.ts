/**
 * D14 — Telegram Mini App backend entry (deployment glue).
 *
 * Run under `bun run app/server.ts` with the required environment variables.
 * This is deployment glue, NOT a node:test gate — it needs Bun + live API keys.
 *
 * Wires: createAgentHandler + TelegramInitDataAuthenticator + withCors + serveBun
 * Per-vault agent: deepseekBrain + Qwen embedder + FileSpineStore + LocalVaultKeyManager.
 */
import { createSpine } from "../src/spine/spine.js";
import { LocalSigned } from "../src/adapters/anchor.js";
import { LocalCAS } from "../src/adapters/storage.js";
import { MemCAS } from "../scripts/mem-store.js";
import { LocalVaultKeyManager } from "../src/agent/key-manager.js";
import { createAgent } from "../src/agent/agent.js";
import { deepseekBrain } from "../src/agent/openai-compat-brain.js";
import { jinaEmbedder } from "../src/recall/openai-compat-embedder.js";
import { LocalRecallIndex } from "../src/recall/recall-index.js";
import { createRecall } from "../src/recall/recall.js";
import { agentDid, ROOT_CAPABILITY_ID } from "../src/identity/did.js";
import { FileSpineStore } from "../src/spine/file-store.js";
import { createAgentHandler, createAgentRegistry } from "../src/server/handler.js";
import { withCors } from "../src/server/cors.js";
import { TelegramInitDataAuthenticator } from "../src/telegram/init-data-auth.js";
import { serveBun } from "../src/server/serve-bun.js";
import type { VaultDid } from "../src/spine/types.js";

// Bun runtime (this file only runs under `bun`, not `node:test`)
declare const Bun: {
  serve(opts: {
    port: number;
    fetch: (req: Request) => Response | Promise<Response>;
  }): { stop(): void; readonly port: number };
};

// ── Config (all from env) ─────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const VAULT_SECRET_HEX = process.env.VAULT_SECRET;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const EMBED_API_KEY = process.env.EMBED_API_KEY;
const EMBED_BASE_URL = process.env.EMBED_BASE_URL ?? "https://api.jina.ai/v1";
const EMBED_MODEL = process.env.EMBED_MODEL ?? "jina-embeddings-v3";
const EMBED_DIM = parseInt(process.env.EMBED_DIM ?? "1024", 10);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "https://ooopalladiumsb.github.io";
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const PORT = parseInt(process.env.PORT ?? "3000", 10);

// Validate required secrets
if (!BOT_TOKEN) {
  console.error("FATAL: BOT_TOKEN env var is required (set the Telegram bot token from @BotFather)");
  process.exit(1);
}
if (!VAULT_SECRET_HEX) {
  console.error("FATAL: VAULT_SECRET env var is required (64-hex, 32-byte random secret)");
  process.exit(1);
}
if (!DEEPSEEK_API_KEY) {
  console.error("FATAL: DEEPSEEK_API_KEY env var is required");
  process.exit(1);
}

const VAULT_SECRET = new Uint8Array(Buffer.from(VAULT_SECRET_HEX, "hex"));
if (VAULT_SECRET.length !== 32) {
  console.error("FATAL: VAULT_SECRET must be 64 hex chars (32 bytes)");
  process.exit(1);
}

// Authority seed for LocalSigned (deterministic per deployment — each server restart uses the same key)
const ANCHOR_SEED = new Uint8Array(32).fill(0x13);

// ── Per-vault agent factory ───────────────────────────
function createAgentForVault(vaultDid: VaultDid) {
  // Key the file-store dir by the vault DID hex prefix for filesystem safety
  const vaultDir = `${DATA_DIR}/${vaultDid.slice(-16)}`;
  const spine = createSpine({
    store: new FileSpineStore(vaultDir),
    storage: new MemCAS(),
    anchor: new LocalSigned(ANCHOR_SEED),
  });

  const brain = deepseekBrain(DEEPSEEK_API_KEY!, "deepseek-v4-flash");

  let recall;
  if (EMBED_API_KEY) {
    const embedder = jinaEmbedder(EMBED_API_KEY, EMBED_MODEL, EMBED_DIM);
    const index = new LocalRecallIndex(EMBED_DIM);
    recall = createRecall({ embedder, index });
  }

  const keys = new LocalVaultKeyManager(
    VAULT_SECRET,
    "vault-kek-0",
  );

  return createAgent({
    spine,
    brain,
    keys,
    vaultDid,
    agentDid: agentDid("telegram", "user"),
    capabilityId: ROOT_CAPABILITY_ID,
    ...(recall ? { recall } : {}),
  });
}

// ── Build the handler ─────────────────────────────────
const registry = createAgentRegistry(createAgentForVault);

const authenticator = new TelegramInitDataAuthenticator({
  botToken: BOT_TOKEN,
  vaultSecret: VAULT_SECRET,
});

const handler = withCors(
  createAgentHandler({ registry, authenticator }),
  { origins: [ALLOWED_ORIGIN] },
);

// ── Start ─────────────────────────────────────────────
serveBun(handler, { port: PORT });
console.log(`[Mnemosyne D14] Telegram Mini App backend listening on :${PORT}`);
console.log(`  ALLOWED_ORIGIN: ${ALLOWED_ORIGIN}`);
console.log(`  DATA_DIR: ${DATA_DIR}`);
console.log(`  Embed model: ${EMBED_MODEL} (dim=${EMBED_DIM})`);
