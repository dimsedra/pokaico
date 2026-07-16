/**
 * Shared helper for smoke/e2e tests: resolves the correct LanguageModel
 * based on env vars, without hardcoding a specific provider.
 *
 * Priority:
 *   1. TEST_MODEL=opencode-go/<model>  + OPENCODE_API_KEY  → OpenCode Go
 *   2. TEST_MODEL=google/<model>       + GOOGLE_* key      → Google Gemini
 *   3. TEST_MODEL=<provider>/<model>   + any matching key  → generic
 *   4. Fallback: google gemini-2.0-flash-lite if GOOGLE key set
 *
 * Usage in smoke tests:
 *   import { resolveTestModel, hasTestKey } from "./helpers/test-model";
 *   describe.runIf(hasTestKey)("...", () => { ... });
 *   const model = resolveTestModel();
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

/** True when at least one recognized API key is present in env. */
export const hasTestKey: boolean = !!(
  process.env.OPENCODE_API_KEY ||
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
  process.env.GEMINI_API_KEY
);

/**
 * Returns the provider+model string that will be used for this test run.
 * Exported so tests can log it for diagnostic purposes.
 */
export function resolveTestModelId(): string {
  const testModel = process.env.TEST_MODEL;

  if (testModel && testModel.includes("/")) {
    const [providerId] = testModel.split("/");

    // OpenCode Go / OpenCode Zen
    if ((providerId === "opencode-go" || providerId === "opencode-zen") && process.env.OPENCODE_API_KEY) {
      return testModel;
    }

    // Google
    if (providerId === "google" && (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY)) {
      return testModel;
    }
  }

  // Legacy fallback
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY) {
    return "google/gemini-2.0-flash-lite";
  }

  throw new Error(
    "resolveTestModel: no API key found. Set OPENCODE_API_KEY + TEST_MODEL=opencode-go/<model>, " +
    "or GOOGLE_GENERATIVE_AI_API_KEY.",
  );
}

/** Instantiates the LanguageModel for the current test env. */
export function resolveTestModel(): LanguageModel {
  const modelId = resolveTestModelId();
  const [providerId, ...rest] = modelId.split("/");
  const modelName = rest.join("/");

  console.log(`[test-model] Using: ${modelId}`);

  if (providerId === "opencode-go") {
    const provider = createOpenAICompatible({
      name: "opencode-go",
      baseURL: "https://api.opencode.ai/v1",
      apiKey: process.env.OPENCODE_API_KEY!,
    });
    return provider(modelName);
  }

  if (providerId === "opencode-zen") {
    const provider = createOpenAICompatible({
      name: "opencode-zen",
      baseURL: "https://api.opencode.ai/v1",
      apiKey: process.env.OPENCODE_API_KEY!,
    });
    return provider(modelName);
  }

  if (providerId === "google") {
    return google(modelName) as LanguageModel;
  }

  throw new Error(`resolveTestModel: unknown provider "${providerId}". Only "opencode-go", "opencode-zen", and "google" are supported.`);
}
