// Pokaico Agent — Node.js sidecar entry point
// Spawned by Tauri shell, communicates via IPC

import { createServer } from "node:http";
import { createPythonEmbeddingModel } from "./embeddings/model";
import type { EmbeddingModel } from "./embeddings/model";
import { resolveDataRoot, getPaths, ensurePaths, type PokaicoPaths } from "./config";

export let embeddingModel: EmbeddingModel | null = null;
export let dataPaths: PokaicoPaths;

const PORT = parseInt(process.env.POKAICO_AGENT_PORT || "3121", 10);

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    const modelReady = embeddingModel !== null;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", version: "0.0.0", modelReady }));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`[pokaico-agent] listening on :${PORT}`);
});

// Resolve and ensure data directory exists on startup
dataPaths = getPaths(resolveDataRoot());
ensurePaths(dataPaths);
console.log(`[pokaico-agent] data directory: ${dataPaths.root}`);

try {
  embeddingModel = createPythonEmbeddingModel();
  console.log("[pokaico-agent] embedding model loading in background...");
} catch (err) {
  console.error("[pokaico-agent] failed to start embedding model:", err);
}
