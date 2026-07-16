import { defineConfig } from "vitest/config";
import { config } from "dotenv";
config({ path: "../.env" });

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: {
      OPENCODE_API_KEY: process.env.OPENCODE_API_KEY || "",
      GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY || "",
      TEST_MODEL: process.env.TEST_MODEL || "",
    },
  },
});
