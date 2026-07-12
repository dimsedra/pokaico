import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { settingsFilePath } from "../config";

export interface ProviderConfig {
  activeProvider?: string;
  activeModel?: string;
  apiKeys?: Record<string, string>;
}

export class ProviderRegistry {
  private configPath: string;
  private config: ProviderConfig = {
    apiKeys: {},
  };

  constructor(configPath?: string) {
    if (configPath) {
      this.configPath = configPath;
    } else {
      this.configPath = join(dirname(settingsFilePath()), "provider-config.json");
    }
  }

  getConfigPath(): string {
    return this.configPath;
  }

  async load(): Promise<ProviderConfig> {
    if (!existsSync(this.configPath)) {
      this.config = { apiKeys: {} };
      return this.config;
    }

    try {
      const raw = readFileSync(this.configPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        this.config = {
          activeProvider: parsed.activeProvider,
          activeModel: parsed.activeModel,
          apiKeys: parsed.apiKeys && typeof parsed.apiKeys === "object" ? parsed.apiKeys : {},
        };
      } else {
        this.config = { apiKeys: {} };
      }
    } catch {
      this.config = { apiKeys: {} };
    }

    return this.config;
  }

  async save(newConfig: Partial<ProviderConfig>): Promise<ProviderConfig> {
    // Merge properties
    const mergedApiKeys = {
      ...(this.config.apiKeys || {}),
      ...(newConfig.apiKeys || {}),
    };

    this.config = {
      ...this.config,
      ...newConfig,
      apiKeys: mergedApiKeys,
    };

    // Ensure parent directory exists
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Write to disk
    writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), "utf-8");

    return this.config;
  }

  getConfig(): ProviderConfig {
    return this.config;
  }
}
