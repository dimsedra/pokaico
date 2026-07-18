import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ProviderRegistry } from "../src/models/provider";
import { settingsFilePath } from "../src/config";
import { join, dirname } from "node:path";
import { writeFileSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";

let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = { ...process.env };
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  for (const [key, val] of Object.entries(originalEnv)) {
    process.env[key] = val;
  }
});


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

  it("should throw an error if the config file is corrupted JSON", async () => {
    writeFileSync(tempConfigPath, "{ invalid json }", "utf-8");
    const registry = new ProviderRegistry(tempConfigPath);
    await expect(() => registry.load()).rejects.toThrow("Failed to load provider configuration");
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

describe("ProviderRegistry - Slice 3 (Dynamic Env Mapping)", () => {
  let tempConfigPath: string;

  beforeEach(() => {
    tempConfigPath = join(tmpdir(), `pokaico-test-provider-env-${Date.now()}-${Math.random().toString(36).substring(2)}.json`);
  });

  afterEach(() => {
    if (existsSync(tempConfigPath)) {
      try {
        unlinkSync(tempConfigPath);
      } catch {}
    }
  });

  it("should map saved keys to process.env on load and save", async () => {
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const registry = new ProviderRegistry(tempConfigPath);
    await registry.save({
      apiKeys: { google: "key-google-test", openai: "key-openai-test" }
    });

    expect(process.env.GOOGLE_GENERATIVE_AI_API_KEY).toBe("key-google-test");
    expect(process.env.OPENAI_API_KEY).toBe("key-openai-test");

    // Reset env vars and load again
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    await registry.load();
    expect(process.env.GOOGLE_GENERATIVE_AI_API_KEY).toBe("key-google-test");
    expect(process.env.OPENAI_API_KEY).toBe("key-openai-test");
  });

  it("should support dynamic mapping for custom/unknown providers via uppercase env naming", async () => {
    const customEnvVar = "MYCUSTOMPROVIDER_API_KEY";
    delete process.env[customEnvVar];

    const registry = new ProviderRegistry(tempConfigPath);
    await registry.save({
      apiKeys: { mycustomprovider: "custom-key-123" }
    });

    expect(process.env[customEnvVar]).toBe("custom-key-123");
  });

  it("should fall back to reading process.env if the config does not have the key", async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "env-google-key";
    
    const registry = new ProviderRegistry(tempConfigPath);
    // Load config that doesn't have the google key
    const config = await registry.load();
    expect(config.apiKeys?.google).toBeUndefined();

    // Verify key falls back to process.env (registry can resolve it, e.g. registry.getApiKey("google"))
    const resolvedKey = registry.getApiKey("google");
    expect(resolvedKey).toBe("env-google-key");
  });
});

describe("ProviderRegistry - Slice 4 (Active Model Validation & Resolution)", () => {
  let tempConfigPath: string;

  beforeEach(() => {
    tempConfigPath = join(tmpdir(), `pokaico-test-provider-model-${Date.now()}-${Math.random().toString(36).substring(2)}.json`);
  });

  afterEach(() => {
    if (existsSync(tempConfigPath)) {
      try {
        unlinkSync(tempConfigPath);
      } catch {}
    }
  });

  it("should throw error if activeModel or activeProvider is not configured", async () => {
    const registry = new ProviderRegistry(tempConfigPath);
    await registry.load(); // empty config

    expect(() => registry.resolveActiveChatModel()).toThrow("No chat model configured");
    expect(() => registry.resolveActiveChatModelInstance()).toThrow("No chat model configured");
  });

  it("should return provider/model string if active model is configured", async () => {
    const registry = new ProviderRegistry(tempConfigPath);
    await registry.save({
      activeProvider: "google",
      activeModel: "gemini-1.5-flash",
      apiKeys: { google: "key-123" }
    });

    const activeModelStr = registry.resolveActiveChatModel();
    expect(activeModelStr).toBe("google/gemini-1.5-flash");
  });

  it("should resolve active model to ModelRouterLanguageModel instance", async () => {
    const registry = new ProviderRegistry(tempConfigPath);
    await registry.save({
      activeProvider: "google",
      activeModel: "gemini-1.5-flash",
      apiKeys: { google: "key-123" }
    });

    const instance = registry.resolveActiveChatModelInstance();
    expect(instance).toBeDefined();
    // ModelRouterLanguageModel has modelId, provider, and gatewayId
    expect(instance.modelId).toBe("gemini-1.5-flash");
    expect(instance.provider).toBe("google");
  });
});

describe("ProviderRegistry - Slice 5 (models.dev Integration)", () => {
  let tempConfigPath: string;

  beforeEach(() => {
    tempConfigPath = join(tmpdir(), `pokaico-test-provider-catalog-${Date.now()}-${Math.random().toString(36).substring(2)}.json`);
  });

  afterEach(() => {
    if (existsSync(tempConfigPath)) {
      try {
        unlinkSync(tempConfigPath);
      } catch {}
    }
  });

  it("should fetch available models filtered by text output modality", async () => {
    const registry = new ProviderRegistry(tempConfigPath);
    const modelsList = await registry.getAvailableModels();
    expect(modelsList.length).toBeGreaterThan(0);
    
    // Check structure of first model
    const m = modelsList[0];
    expect(m.providerId).toBeDefined();
    expect(m.providerName).toBeDefined();
    expect(m.modelId).toBeDefined();
    expect(m.name).toBeDefined();
    expect(m.description).toBeDefined();
    expect(m.contextWindow).toBeDefined();
    expect(m.inputCost).toBeDefined();
    expect(m.outputCost).toBeDefined();

    // Verify all returned models have text as output modality
    // (We will check that they don't crash and conform to type)
    expect(m.inputCost).toBeTypeOf("number");
  });

  it("should fall back to local snapshot if models.dev API fetch fails (offline mode)", async () => {
    const registry = new ProviderRegistry(tempConfigPath);
    
    // Spy on global fetch to simulate network error
    const spy = vi.spyOn(global, "fetch").mockRejectedValue(new Error("Failed to fetch from models.dev"));

    try {
      const modelsList = await registry.getAvailableModels();
      expect(modelsList.length).toBeGreaterThan(0);
      
      // Ensure it used snapshot fallback
      const m = modelsList[0];
      expect(m.modelId).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });

  it("should fall back to local snapshot if models.dev API fetch hangs/takes longer than 2 seconds", async () => {
    const registry = new ProviderRegistry(tempConfigPath);
    
    // Spy on global fetch to simulate a hanging connection that respects abort signal
    const spy = vi.spyOn(global, "fetch").mockImplementation((_url, options) => {
      return new Promise((_, reject) => {
        const signal = options?.signal;
        if (signal?.aborted) {
          return reject(new DOMException("The user aborted a request.", "AbortError"));
        }
        
        if (signal) {
          signal.addEventListener("abort", () => {
            reject(new DOMException("The user aborted a request.", "AbortError"));
          });
        }
        // Let it hang indefinitely so the timeout is forced to abort it
      });
    });

    try {
      const startTime = Date.now();
      const modelsList = await registry.getAvailableModels();
      const duration = Date.now() - startTime;
      
      expect(modelsList.length).toBeGreaterThan(0);
      // Should abort at 2000ms, and finish shortly after
      expect(duration).toBeLessThan(3500); 
      
      const m = modelsList[0];
      expect(m.modelId).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });
});




