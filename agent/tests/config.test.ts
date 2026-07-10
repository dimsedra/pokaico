import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import {
  resolveDataRoot,
  getPaths,
  ensurePaths,
  setDataDir,
  clearDataDir,
  settingsFilePath,
} from "../src/config";

describe("resolveDataRoot", () => {
  it("returns override when provided", () => {
    const root = resolveDataRoot("C:\\custom\\path");
    expect(root).toBe("C:\\custom\\path");
  });

  it("defaults to Documents\\Pokaico when nothing is set", () => {
    const root = resolveDataRoot();
    const expected = join(homedir(), "Documents", "Pokaico");
    expect(root).toBe(expected);
  });
});

describe("getPaths", () => {
  it("returns all derived paths from root", () => {
    const root = "/tmp/test";
    const paths = getPaths(root);
    expect(paths.root).toBe(root);
    expect(paths.journalDir).toBe(join(root, "journal"));
    expect(paths.memoryDir).toBe(join(root, "memory"));
    expect(paths.dbPath).toBe(join(root, "pokaico.db"));
  });
});

describe("ensurePaths", () => {
  it("creates journal and memory/topics directories", () => {
    const root = mkdtempSync(join(tmpdir(), "config-ensure-"));
    const paths = getPaths(root);

    ensurePaths(paths);

    expect(existsSync(paths.journalDir)).toBe(true);
    expect(existsSync(join(paths.memoryDir, "topics"))).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });

  it("is idempotent (no error on second call)", () => {
    const root = mkdtempSync(join(tmpdir(), "config-idempotent-"));
    const paths = getPaths(root);

    ensurePaths(paths);
    ensurePaths(paths);

    expect(existsSync(paths.journalDir)).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });
});

describe("setDataDir / resolveDataRoot (settings file)", () => {
  let originalSettingsDir: string | undefined;
  let tempSettingsRoot: string;

  beforeAll(() => {
    tempSettingsRoot = mkdtempSync(join(tmpdir(), "config-settings-"));
    process.env.APPDATA = join(tempSettingsRoot, "AppData", "Roaming");
    process.env.XDG_CONFIG_HOME = "";
  });

  afterAll(() => {
    rmSync(tempSettingsRoot, { recursive: true, force: true });
    clearDataDir();
  });

  it("resolves from settings file after setDataDir", () => {
    const customDir = join(tempSettingsRoot, "MyPokaicoData");
    setDataDir(customDir);

    const root = resolveDataRoot();
    expect(root).toBe(customDir);
  });

  it("override still beats settings file", () => {
    const override = "D:\\explicit\\pokaico";
    const root = resolveDataRoot(override);
    expect(root).toBe(override);
  });

  it("settings file is valid JSON", () => {
    const settingsPath = settingsFilePath();
    expect(existsSync(settingsPath)).toBe(true);

    const fs = require("node:fs");
    const content = fs.readFileSync(settingsPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(typeof parsed.dataDir).toBe("string");
  });
});
