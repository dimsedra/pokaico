// Pokaico Agent — Node.js sidecar entry point
// Spawned by Tauri shell, communicates via IPC

import { createServer } from "node:http";

const PORT = parseInt(process.env.POKAICO_AGENT_PORT || "3121", 10);

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", version: "0.0.0" }));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`[pokaico-agent] listening on :${PORT}`);
});
