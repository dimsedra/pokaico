import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_TIMEOUT_MS = 30_000;

export type EmbeddingModel = {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  close(): Promise<void>;
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

function resolvePythonPath(): string {
  const pythonDir = resolve(__dirname, "../../python");
  const venvPython = process.platform === "win32"
    ? resolve(pythonDir, ".venv/Scripts/python.exe")
    : resolve(pythonDir, ".venv/bin/python");
  if (existsSync(venvPython)) return venvPython;
  return "python";
}

export function createPythonEmbeddingModel(
  options: EmbeddingModelOptions = {},
): EmbeddingModel {
  const python = options.pythonPath ?? process.env.POKAICO_PYTHON_PATH ?? resolvePythonPath();
  const script = options.scriptPath ?? resolve(__dirname, "../../python/embed.py");
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

  function spawnProc(): void {
    proc = spawn(python, [script], {
      stdio: ["pipe", "pipe", "inherit"],
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
      exited = true;
      exitResolve?.();
      readyReject?.(new Error(`Python process error: ${err.message}`));
      readyReject = null;
      readyResolve = null;
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error(`Python process error: ${err.message}`));
      }
      pending.clear();
    });

    proc.on("exit", (code) => {
      exited = true;
      exitResolve?.();
      // Resolve ready so sendRequest can check exited flag
      readyResolve?.();
      readyResolve = null;
      readyReject = null;
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error(`Python process exited with code ${code}`));
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

  spawnProc();

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
    return new Float32Array(data as number[]);
  }

  async function embedBatch(texts: string[]): Promise<Float32Array[]> {
    const data = await sendRequest("embed_batch", { texts });
    return (data as number[][]).map((arr) => new Float32Array(arr));
  }

  async function close(): Promise<void> {
    closed = true;
    if (!exited) {
      proc.kill();
      await exitPromise;
    }
  }

  return { embed, embedBatch, close };
}
