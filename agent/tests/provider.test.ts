import { describe, it, expect } from "vitest";
import { ProviderRegistry } from "../src/models/provider";
import { settingsFilePath } from "../src/config";
import { join, dirname } from "node:path";

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
