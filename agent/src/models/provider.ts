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
}
