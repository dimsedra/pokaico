import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ProviderRegistry } from "../src/models/provider";
import { settingsFilePath } from "../src/config";
import { join, dirname } from "node:path";
import { writeFileSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";

describe("ProviderRegistry - Slice 1 (DI & Constructor)", () => {
  it("should initialize with a custom config path", () => {
    const customPath = "/tmp/my-custom-provider-config.json";
    const registry = new ProviderRegistry(customPath);
    expect(registry["configPath"]).toBe(customPath);
  });

  it("should fall back to default config path if not provided", () => {
    const registry = new ProviderRegistry();
    const defaultPath = join(dirname(settingsFilePath()), "provider-config.json");
    expect(registry["configPath"]).toBe(defaultPath);
  });
});

describe("ProviderRegistry - Slice 2 (Config Loader & Saver)", () => {
  let tempConfigPath: string;

  beforeEach(() => {
    tempConfigPath = join(tmpdir(), `pokaico-test-provider-config-${Date.now()}-${Math.random().toString(36).substring(2)}.json`);
  });

  afterEach(() => {
    if (existsSync(tempConfigPath)) {
      try {
        unlinkSync(tempConfigPath);
      } catch {}
    }
  });

  it("should load empty config if file does not exist", async () => {
    const registry = new ProviderRegistry(tempConfigPath);
    const config = await registry.load();
    expect(config).toEqual({ apiKeys: {} });
    expect(registry.getConfig()).toEqual({ apiKeys: {} });
  });

  it("should load empty config and not crash if file is corrupted JSON", async () => {
    writeFileSync(tempConfigPath, "{ invalid json }", "utf-8");
    const registry = new ProviderRegistry(tempConfigPath);
    const config = await registry.load();
    expect(config).toEqual({ apiKeys: {} });
    expect(registry.getConfig()).toEqual({ apiKeys: {} });
  });

  it("should save and load valid config", async () => {
    const registry = new ProviderRegistry(tempConfigPath);
    const testConfig = {
      activeProvider: "google",
      activeModel: "gemini-1.5-flash",
      apiKeys: { google: "key-123", openai: "key-456" }
    };
    await registry.save(testConfig);
    
    // Verify file was written
    expect(existsSync(tempConfigPath)).toBe(true);

    // Verify it loads correctly
    const loaded = await registry.load();
    expect(loaded).toEqual(testConfig);
    expect(registry.getConfig()).toEqual(testConfig);
  });

  it("should save successfully and create parent directory dynamically if it does not exist", async () => {
    const nestedPath = join(tempConfigPath, "nested-dir", "config.json");
    const registry = new ProviderRegistry(nestedPath);
    const testConfig = {
      activeProvider: "openai",
      activeModel: "gpt-4o",
      apiKeys: { openai: "key-999" }
    };
    await registry.save(testConfig);
    expect(existsSync(nestedPath)).toBe(true);

    // Cleanup nested files
    try {
      unlinkSync(nestedPath);
      const fs = require("node:fs");
      fs.rmdirSync(dirname(nestedPath));
    } catch {}
  });
});

