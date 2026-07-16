import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findPythonScript(startDir: string): string {
  let dir = startDir;
  while (true) {
    const p1 = join(dir, "agent/python/embed.py");
    if (existsSync(p1)) return p1;
    const p2 = join(dir, "python/embed.py");
    if (existsSync(p2)) return p2;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(startDir, "../../python/embed.py"); // fallback
}

const DEFAULT_TIMEOUT_MS = 30_000;

export type EmbeddingModel = {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  close(): Promise<void>;
  isReady?: () => boolean;
};

export type EmbeddingModelOptions = {
  pythonPath?: string;
  scriptPath?: string;
  timeoutMs?: number;
};

type PendingEntry = {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

function resolvePythonPath(startDir: string): string {
  let dir = startDir;
  while (true) {
    const p1 = join(dir, "agent/python");
    if (existsSync(p1)) {
      const venvPython = process.platform === "win32"
        ? join(p1, ".venv/Scripts/python.exe")
        : join(p1, ".venv/bin/python");
      if (existsSync(venvPython)) return venvPython;
    }
    const p2 = join(dir, "python");
    if (existsSync(p2)) {
      const venvPython = process.platform === "win32"
        ? join(p2, ".venv/Scripts/python.exe")
        : join(p2, ".venv/bin/python");
      if (existsSync(venvPython)) return venvPython;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "python";
}

export function createPythonEmbeddingModel(
  options: EmbeddingModelOptions = {},
): EmbeddingModel {
  const python = options.pythonPath ?? process.env.POKAICO_PYTHON_PATH ?? resolvePythonPath(__dirname);
  const script = options.scriptPath ?? findPythonScript(__dirname);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let proc: ChildProcess;
  let reqId = 0;
  const pending = new Map<number, PendingEntry>();
  let readyResolve: (() => void) | null = null;
  let readyReject: ((err: Error) => void) | null = null;
  let closed = false;
  let exited = false;
  let exitResolve: (() => void) | null = null;
  const exitPromise = new Promise<void>((resolve) => { exitResolve = resolve; });

  const readyPromise = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  let isReadyState = false;
  readyPromise.then(() => {
    isReadyState = true;
  }).catch(() => {});

  function spawnProc(): void {
    proc = spawn(python, [script], {
      stdio: ["pipe", "pipe", "inherit"],
    });

    proc.stdin!.on("error", (err) => {
      console.warn("[pokaico-embedding] stdin error (process likely exited):", err.message);
    });

    const rl = createInterface({ input: proc.stdout! });

    rl.on("line", (line: string) => {
      line = line.trim();
      if (!line) return;
      try {
        const resp = JSON.parse(line);
        if (resp.ready === true) {
          readyResolve?.();
          readyResolve = null;
          readyReject = null;
          return;
        }
        const id = resp.id;
        const entry = pending.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        pending.delete(id);
        if (resp.type === "error") {
          entry.reject(new Error(resp.message ?? "embedding error"));
        } else {
          entry.resolve(resp.data);
        }
      } catch {
        // malformed JSON — skip
      }
    });

    proc.on("error", (err) => {
      console.error("[pokaico-embedding] process error:", err);
      exited = true;
      exitResolve?.();
      readyReject?.(err);
      readyReject = null;
      readyResolve = null;
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(err);
      }
      pending.clear();
    });

    proc.on("exit", (code) => {
      exited = true;
      exitResolve?.();
      const err = new Error(`Python process exited with code ${code}`);
      readyReject?.(err);
      readyReject = null;
      readyResolve = null;
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(err);
      }
      pending.clear();
    });
  }

  // Reject readyPromise if not ready within timeoutMs
  const readyTimer = setTimeout(() => {
    readyReject?.(new Error(`Python process did not become ready within ${timeoutMs}ms`));
    readyReject = null;
    readyResolve = null;
    if (proc) proc.kill();
  }, timeoutMs);

  // Clear the ready timer once ready; suppress readyPromise rejection if timer fires
  void readyPromise.finally(() => clearTimeout(readyTimer)).catch(() => undefined);

  try {
    spawnProc();
  } catch (err) {
    exited = true;
    console.error("[pokaico-embedding] spawn failed:", err);
  }

  function sendRequest(type: "embed" | "embed_batch", payload: Record<string, unknown>): Promise<unknown> {
    if (exited) {
      return Promise.reject(new Error(`Python process exited with code ${proc.exitCode} before ready`));
    }
    return readyPromise.then(() => {
      if (exited) throw new Error(`Python process exited with code ${proc.exitCode}`);
      if (closed) throw new Error("Embedding model is closed");
      const id = ++reqId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Embedding request timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        pending.set(id, { resolve, reject, timer });
        const msg = JSON.stringify({ id, type, ...payload }) + "\n";
        proc.stdin!.write(msg);
      });
    });
  }

  async function embed(text: string): Promise<Float32Array> {
    const data = await sendRequest("embed", { text });
    if (!Array.isArray(data)) {
      throw new Error("Invalid embedding response format: expected array");
    }
    return new Float32Array(data as number[]);
  }

  async function embedBatch(texts: string[]): Promise<Float32Array[]> {
    const data = await sendRequest("embed_batch", { texts });
    if (!Array.isArray(data)) {
      throw new Error("Invalid embedding response format: expected array of arrays");
    }
    return (data as number[][]).map((arr) => {
      if (!Array.isArray(arr)) {
        throw new Error("Invalid embedding batch entry format: expected array");
      }
      return new Float32Array(arr);
    });
  }

  async function close(): Promise<void> {
    closed = true;
    if (!exited) {
      proc.kill();
      // Wait for exit with a 5 second timeout to prevent hangs
      const timeout = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout waiting for process exit")), 5000)
      );
      await Promise.race([exitPromise, timeout]).catch((err) => {
        console.warn("[pokaico-embedding] close timeout, forcing kill:", err.message);
        proc.kill("SIGKILL");
      });
    }
  }

  return { embed, embedBatch, close, isReady: () => isReadyState && !exited && !closed };
}
