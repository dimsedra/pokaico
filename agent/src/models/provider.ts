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
  activeChatProvider: z.string().optional(),
  activeChatModel: z.string().optional(),
  activePipelineProvider: z.string().optional(),
  activePipelineModel: z.string().optional(),
  // Backwards compatibility legacy keys
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

    const envVars = this.getEnvVarNamesForProvider(providerId);
    for (const envVar of envVars) {
      if (process.env[envVar]) {
        return process.env[envVar];
      }
    }

    return undefined;
  }

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
        activeChatProvider: validated.activeChatProvider,
        activeChatModel: validated.activeChatModel,
        activePipelineProvider: validated.activePipelineProvider,
        activePipelineModel: validated.activePipelineModel,
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

  resolveActiveChatModel(): string {
    if (!this.config.activeChatProvider || !this.config.activeChatModel) {
      if (!process.env.VITEST) {
        const testModel = process.env.TEST_MODEL;
        if (testModel && testModel.includes("/")) {
          const [providerId] = testModel.split("/");
          const envVars = this.getEnvVarNamesForProvider(providerId);
          const hasKey = envVars.some((v) => process.env[v]);
          if (hasKey) return testModel;
        }
        if (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY) {
          return "google/gemini-2.0-flash-lite";
        }
      }
      if (this.config.activeProvider && this.config.activeModel) {
        return `${this.config.activeProvider}/${this.config.activeModel}`;
      }
      throw new Error("No chat model configured");
    }

    const key = this.getApiKey(this.config.activeChatProvider);
    if (key) {
      const envVars = this.getEnvVarNamesForProvider(this.config.activeChatProvider);
      for (const envVar of envVars) {
        process.env[envVar] = key;
      }
    }

    return `${this.config.activeChatProvider}/${this.config.activeChatModel}`;
  }

  resolveActiveChatModelInstance(): ModelRouterLanguageModel {
    const modelStr = this.resolveActiveChatModel();
    return new ModelRouterLanguageModel(modelStr);
  }

  resolveActivePipelineModel(): string {
    if (!this.config.activePipelineProvider || !this.config.activePipelineModel) {
      try {
        return this.resolveActiveChatModel();
      } catch {
        if (!process.env.VITEST) {
          const testModel = process.env.TEST_MODEL;
          if (testModel && testModel.includes("/")) {
            return testModel;
          }
          if (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY) {
            return "google/gemini-2.0-flash-lite";
          }
        }
        throw new Error("No pipeline model configured");
      }
    }

    const key = this.getApiKey(this.config.activePipelineProvider);
    if (key) {
      const envVars = this.getEnvVarNamesForProvider(this.config.activePipelineProvider);
      for (const envVar of envVars) {
        process.env[envVar] = key;
      }
    }

    return `${this.config.activePipelineProvider}/${this.config.activePipelineModel}`;
  }

  resolveActivePipelineModelInstance(): ModelRouterLanguageModel {
    const modelStr = this.resolveActivePipelineModel();
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
