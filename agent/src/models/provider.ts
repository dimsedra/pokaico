import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { settingsFilePath } from "../config";
import { providers as snapshotProviders } from "@opencode-ai/models/snapshot";
import { ModelRouterLanguageModel } from "@mastra/core/llm";
import { Models, type ProviderMap } from "@opencode-ai/models";
import { z } from "zod";

/**
 * Schema for verifying provider configuration file structure at runtime.
 */
export const providerConfigSchema = z.object({
  activeProvider: z.string().optional(),
  activeModel: z.string().optional(),
  apiKeys: z.record(z.string(), z.string()).optional(),
});

export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export interface UIModel {
  providerId: string;
  providerName: string;
  modelId: string;
  name: string;
  description: string;
  contextWindow: number;
  inputCost: number;
  outputCost: number;
}

const CATALOG_FETCH_TIMEOUT_MS = 2000;

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
    const known = snapshotProviders[providerId];
    if (known && Array.isArray(known.env)) {
      return known.env;
    }
    return [`${providerId.toUpperCase()}_API_KEY`];
  }

  /**
   * Synchronizes API keys to global process.env.
   * 
   * WARNING: Modifies global process.env state. This side effect is required 
   * because Mastra and the Vercel AI SDK resolve provider keys from process.env internally.
   */
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

  /**
   * Loads the configuration from disk asynchronously.
   * Resolves to default empty state if the file does not exist (ENOENT).
   * Throws an error if the file exists but fails to read, parse, or validate against Zod schema.
   */
  async load(): Promise<ProviderConfig> {
    let raw: string;
    try {
      raw = await readFile(this.configPath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.config = { apiKeys: {} };
        return this.config;
      }
      throw new Error(`Failed to load provider configuration: ${(err as Error).message}`);
    }

    try {
      const parsed = JSON.parse(raw);
      const validated = providerConfigSchema.parse(parsed);
      this.config = {
        activeProvider: validated.activeProvider,
        activeModel: validated.activeModel,
        apiKeys: validated.apiKeys || {},
      };
    } catch (err) {
      throw new Error(`Failed to load provider configuration: ${(err as Error).message}`);
    }

    this.syncEnvVariables();
    return this.config;
  }

  /**
   * Saves the configuration to disk asynchronously.
   * Ensures parent directory exists asynchronously.
   * Throws an error on Zod validation failure or filesystem write errors.
   */
  async save(newConfig: Partial<ProviderConfig>): Promise<ProviderConfig> {
    try {
      providerConfigSchema.parse(newConfig);
    } catch (err) {
      throw new Error(`Failed to save provider configuration: Invalid data format - ${(err as Error).message}`);
    }

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
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(this.configPath, JSON.stringify(this.config, null, 2), "utf-8");
    } catch (err) {
      throw new Error(`Failed to save provider configuration: ${(err as Error).message}`);
    }
    
    this.syncEnvVariables();
    return this.config;
  }

  getConfig(): ProviderConfig {
    return this.config;
  }

  /**
   * Validates and returns the active model format string "provider/model".
   * 
   * WARNING: Modifies global process.env state to synchronize active provider key.
   */
  resolveActiveModel(): string {
    if (!this.config.activeProvider || !this.config.activeModel) {
      // Development fallback: prefer TEST_MODEL + matching key from env
      if (!process.env.VITEST) {
        const testModel = process.env.TEST_MODEL;
        if (testModel && testModel.includes("/")) {
          const [providerId] = testModel.split("/");
          const envVars = this.getEnvVarNamesForProvider(providerId);
          const hasKey = envVars.some((v) => process.env[v]);
          if (hasKey) return testModel;
        }
        // Legacy Gemini fallback
        if (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY) {
          return "google/gemini-2.0-flash-lite";
        }
      }
      throw new Error("No model configured");
    }

    const key = this.getApiKey(this.config.activeProvider);
    if (key) {
      const envVars = this.getEnvVarNamesForProvider(this.config.activeProvider);
      for (const envVar of envVars) {
        process.env[envVar] = key;
      }
    }

    return `${this.config.activeProvider}/${this.config.activeModel}`;
  }

  /**
   * Resolves and returns a dynamic Mastra ModelRouterLanguageModel instance.
   * 
   * WARNING: Modifies global process.env state to synchronize active provider key.
   */
  resolveActiveModelInstance(): ModelRouterLanguageModel {
    const modelStr = this.resolveActiveModel();
    return new ModelRouterLanguageModel(modelStr);
  }

  private formatCatalog(providerMap: ProviderMap): UIModel[] {
    const result: UIModel[] = [];
    for (const [providerId, provider] of Object.entries(providerMap)) {
      if (provider && provider.models) {
        for (const [modelId, model] of Object.entries(provider.models)) {
          if (
            model &&
            model.modalities &&
            Array.isArray(model.modalities.output) &&
            model.modalities.output.includes("text")
          ) {
            result.push({
              providerId,
              providerName: provider.name || providerId,
              modelId,
              name: model.name || modelId,
              description: model.description || "",
              contextWindow: model.limit?.context || 0,
              inputCost: model.cost?.input ?? 0,
              outputCost: model.cost?.output ?? 0,
            });
          }
        }
      }
    }
    return result;
  }

  /**
   * Fetches the available models catalog asynchronously from models.dev.
   * Falls back statically to local snapshot if the request takes longer than 2 seconds or fails.
   */
  async getAvailableModels(): Promise<UIModel[]> {
    try {
      const client = Models.make();
      const catalog = await client.catalog({ signal: AbortSignal.timeout(CATALOG_FETCH_TIMEOUT_MS) });
      return this.formatCatalog(catalog.providers);
    } catch {
      return this.formatCatalog(snapshotProviders);
    }
  }
}
