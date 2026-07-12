import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { settingsFilePath } from "../config";
import { providers } from "@opencode-ai/models/snapshot";
import { ModelRouterLanguageModel } from "@mastra/core/llm";

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

  private getEnvVarNamesForProvider(providerId: string): string[] {
    const known = providers[providerId];
    if (known && Array.isArray(known.env)) {
      return known.env;
    }
    return [`${providerId.toUpperCase()}_API_KEY`];
  }

  private syncEnvVariables(): void {
    if (!this.config.apiKeys) return;
    for (const [providerId, key] of Object.entries(this.config.apiKeys)) {
      if (key) {
        const envVars = this.getEnvVarNamesForProvider(providerId);
        for (const envVar of envVars) {
          process.env[envVar] = key;
        }
      }
    }
  }

  getApiKey(providerId: string): string | undefined {
    const configuredKey = this.config.apiKeys?.[providerId];
    if (configuredKey) {
      return configuredKey;
    }

    // Fallback to process.env
    const envVars = this.getEnvVarNamesForProvider(providerId);
    for (const envVar of envVars) {
      if (process.env[envVar]) {
        return process.env[envVar];
      }
    }

    return undefined;
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

    this.syncEnvVariables();
    return this.config;
  }

  async save(newConfig: Partial<ProviderConfig>): Promise<ProviderConfig> {
    const mergedApiKeys = {
      ...(this.config.apiKeys || {}),
      ...(newConfig.apiKeys || {}),
    };

    this.config = {
      ...this.config,
      ...newConfig,
      apiKeys: mergedApiKeys,
    };

    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), "utf-8");
    
    this.syncEnvVariables();
    return this.config;
  }

  getConfig(): ProviderConfig {
    return this.config;
  }

  resolveActiveModel(): string {
    if (!this.config.activeProvider || !this.config.activeModel) {
      throw new Error("No model configured");
    }

    // Dynamic key sync on resolution
    const key = this.getApiKey(this.config.activeProvider);
    if (key) {
      const envVars = this.getEnvVarNamesForProvider(this.config.activeProvider);
      for (const envVar of envVars) {
        process.env[envVar] = key;
      }
    }

    return `${this.config.activeProvider}/${this.config.activeModel}`;
  }

  resolveActiveModelInstance(): ModelRouterLanguageModel {
    const modelStr = this.resolveActiveModel();
    return new ModelRouterLanguageModel(modelStr);
  }
}
