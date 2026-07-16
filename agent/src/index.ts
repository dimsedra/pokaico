import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPythonEmbeddingModel } from "./embeddings/model";
import type { EmbeddingModel } from "./embeddings/model";
import { resolveDataRoot, getPaths, ensurePaths, type PokaicoPaths } from "./config";
import { createDb } from "./db/client";
import { createEmbeddingService } from "./embeddings/service";
import { ProviderRegistry } from "./models/provider";
import { createAgent } from "./mastra/index";
import { startIPCListener } from "./ipc";
import { processSession } from "./memory/pipeline";
import { createSearchTopicsTool } from "./mastra/tools/search-topics";
import { createReadTopicTool } from "./mastra/tools/read-topic";
import { createListTopicsTool } from "./mastra/tools/list-topics";
import { createReadSessionTool } from "./mastra/tools/read-session";
import { createReadResourceTool } from "./mastra/tools/read-resource";
import { createIngestResourceTool } from "./mastra/tools/ingest-resource";
import { createXbergExtractor } from "./extract/xberg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from project root (for development purposes)
function loadEnv() {
  const projectRoot = resolve(__dirname, "../..");
  const envPath = join(projectRoot, ".env");
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, ""); // strip quotes
          if (key && !process.env[key]) {
            process.env[key] = val;
          }
        }
      }
      console.log(`[pokaico-agent] Loaded environment variables from ${envPath}`);
    } catch (err) {
      console.error(`[pokaico-agent] Failed to read .env file:`, err);
    }
  }
}

loadEnv();

export let embeddingModel: EmbeddingModel | null = null;
export let dataPaths: PokaicoPaths;

const rawPort = process.env.POKAICO_AGENT_PORT;
const PORT = rawPort && /^\d+$/.test(rawPort) ? parseInt(rawPort, 10) : 3121;

// Resolve and ensure data directory exists on startup
dataPaths = getPaths(resolveDataRoot());
ensurePaths(dataPaths);
console.log(`[pokaico-agent] data directory: ${dataPaths.root}`);

// Initialize DB client
const db = createDb(dataPaths.dbPath);
console.log(`[pokaico-agent] DB initialized: ${dataPaths.dbPath}`);

// Initialize ProviderRegistry and Active Model
const registry = new ProviderRegistry();
let activeModelName = "";
let activeModelInstance: any = null;
let agentInstance: any = null;

try {
  // Load registry configuration
  await registry.load();
  activeModelName = registry.resolveActiveModel();
  activeModelInstance = registry.resolveActiveModelInstance();
  console.log(`[pokaico-agent] active model: ${activeModelName}`);
} catch (err) {
  console.warn(
    `[pokaico-agent] Warning: No active model resolved at startup. Chat commands will fail until configured. Details: ${(err as Error).message}`
  );
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    const modelReady =
      embeddingModel !== null && (embeddingModel.isReady ? embeddingModel.isReady() : true);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        version: "0.0.0",
        modelReady,
        activeModel: activeModelName || null,
      })
    );
    return;
  }

  res.writeHead(404);
  res.end();
});

server.on("error", (err: any) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `[pokaico-agent] Error: Port ${PORT} is already in use. Please close the other process or set POKAICO_AGENT_PORT.`
    );
  } else {
    console.error(`[pokaico-agent] Server error:`, err);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`[pokaico-agent] listening on :${PORT}`);
});

try {
  embeddingModel = createPythonEmbeddingModel();
  console.log("[pokaico-agent] embedding model loading in background...");
} catch (err) {
  console.error("[pokaico-agent] failed to start embedding model:", err);
}

// Resolver for agent
export function getAgent(): any {
  if (agentInstance) return agentInstance;

  // If no model was resolved at startup, try reloading config
  if (!activeModelInstance) {
    try {
      // Reload dynamically (non-blocking)
      registry.load().then(() => {
        try {
          activeModelName = registry.resolveActiveModel();
          activeModelInstance = registry.resolveActiveModelInstance();
          console.log(`[pokaico-agent] active model dynamically loaded: ${activeModelName}`);
        } catch {}
      }).catch(() => {});
    } catch {}
    return null;
  }

  if (!embeddingModel) {
    try {
      embeddingModel = createPythonEmbeddingModel();
    } catch (err) {
      console.error("[pokaico-agent] failed to start embedding model dynamically:", err);
      return null;
    }
  }

  const embeddingService = createEmbeddingService(embeddingModel, db);
  const xbergExtractor = createXbergExtractor();

  const tools = {
    search_topics: createSearchTopicsTool({ memoryDir: dataPaths.memoryDir, embedding: embeddingService }),
    read_topic: createReadTopicTool(dataPaths.memoryDir),
    list_topics: createListTopicsTool(dataPaths.memoryDir),
    read_session: createReadSessionTool(dataPaths.journalDir),
    read_resource: createReadResourceTool({ memoryDir: dataPaths.memoryDir, extractor: xbergExtractor }),
    ingest_resource: createIngestResourceTool({ memoryDir: dataPaths.memoryDir, db, extractor: xbergExtractor }),
  };

  agentInstance = createAgent({
    model: activeModelInstance,
    memoryDir: dataPaths.memoryDir,
    tools,
  });
  return agentInstance;
}

// Background pipeline runner
const runPipeline = async (sessionId: string) => {
  let modelInstance: any;
  try {
    // Read the current active model from registry
    modelInstance = registry.resolveActiveModelInstance();
  } catch (err) {
    console.error(`[pokaico-agent] Cannot run pipeline for session ${sessionId} - no active model configured.`);
    return;
  }

  if (!embeddingModel) {
    console.error(`[pokaico-agent] Cannot run pipeline for session ${sessionId} - embedding model not loaded.`);
    return;
  }

  const embeddingService = createEmbeddingService(embeddingModel, db);

  return processSession(sessionId, {
    llm: modelInstance,
    searchSimilar: async (query, limit) => {
      return embeddingService.searchSimilar(query, limit);
    },
    indexTopic: async (topicId, content) => {
      await embeddingService.indexTopic(topicId, content);
    },
    db,
    memoryDir: dataPaths.memoryDir,
    journalDir: dataPaths.journalDir,
  });
};

// Start standard streams IPC listener
startIPCListener({
  stdin: process.stdin,
  stdout: process.stdout,
  getAgent,
  journalDir: dataPaths.journalDir,
  runPipeline,
  getModelName: () => activeModelName,
});
