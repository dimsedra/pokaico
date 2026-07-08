import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPythonEmbeddingModel, type EmbeddingModel } from "../src/embeddings/model";

const runIntegration = !!process.env.INTEGRATION;

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

(runIntegration ? describe : describe.skip)(
  "embedding model — real E5-small pipeline",
  () => {
    let model: EmbeddingModel;

    beforeAll(async () => {
      model = createPythonEmbeddingModel({ timeoutMs: 120_000 });
      // Warm up — ensure model is loaded before any test
      await model.embed("warmup");
    }, 180_000);

    afterAll(async () => {
      await model.close();
    });

    it("embeds a single text and returns normalized 384-dim vector", async () => {
      const result = await model.embed("hello world");
      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(384);
      const magnitude = Math.sqrt(dot(result, result));
      expect(magnitude).toBeCloseTo(1, 4);
    });

    it("embedBatch returns correct shapes", async () => {
      const results = await model.embedBatch(["a", "b", "c"]);
      expect(results).toHaveLength(3);
      for (const r of results) {
        expect(r).toBeInstanceOf(Float32Array);
        expect(r.length).toBe(384);
      }
    });

    it("embedBatch handles empty array", async () => {
      const results = await model.embedBatch([]);
      expect(results).toEqual([]);
    });

    it("similar texts have higher cosine similarity than unrelated texts", async () => {
      const [cat, kitten, rocket] = await Promise.all([
        model.embed("cat"),
        model.embed("kitten"),
        model.embed("rocket ship"),
      ]);
      const catKitten = dot(cat, kitten);
      const catRocket = dot(cat, rocket);
      expect(catKitten).toBeGreaterThan(catRocket);
    });
  },
);
