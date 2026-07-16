import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";

export type PokaicoPaths = {
  root: string;
  conversationDir: string;
  diaryDir: string;
  memoryDir: string;
  dbPath: string;
};

export function settingsFilePath(): string {
  const home = homedir();
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    return join(appData, "Pokaico", "config.json");
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(home, ".config");
  return join(xdgConfig, "pokaico", "config.json");
}

function defaultDataDir(): string {
  return join(homedir(), "Documents", "Pokaico");
}

function readSettings(): string | null {
  const path = settingsFilePath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw);
    return typeof data.dataDir === "string" ? data.dataDir : null;
  } catch {
    return null;
  }
}

export function resolveDataRoot(override?: string): string {
  if (override) return override;

  const envDir = process.env.POKAICO_DATA_DIR;
  if (envDir) return envDir;

  const settingsDir = readSettings();
  if (settingsDir) return settingsDir;

  return defaultDataDir();
}

export function getPaths(root: string): PokaicoPaths {
  return {
    root,
    conversationDir: join(root, "conversation"),
    diaryDir: join(root, "diary"),
    memoryDir: join(root, "memory"),
    dbPath: join(root, "pokaico.db"),
  };
}

export function ensurePaths(paths: PokaicoPaths): void {
  mkdirSync(paths.conversationDir, { recursive: true });
  mkdirSync(paths.diaryDir, { recursive: true });
  mkdirSync(join(paths.memoryDir, "topics"), { recursive: true });
}

export function setDataDir(dir: string): void {
  const path = settingsFilePath();
  const parent = dirname(path);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
  writeFileSync(path, JSON.stringify({ dataDir: dir }, null, 2), "utf-8");
}

export function clearDataDir(): void {
  const path = settingsFilePath();
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // Ignore errors during cleanup
    }
  }
}
