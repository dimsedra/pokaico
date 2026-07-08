import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { createPythonEmbeddingModel } from "../src/embeddings/model";

const fakeScript = resolve(__dirname, "../python/fake_embed.cjs");
const silentScript = resolve(__dirname, "../python/fake_embed_silent.cjs");
const crashScript = resolve(__dirname, "../python/fake_embed_crash.cjs");
const hangScript = resolve(__dirname, "../python/fake_embed_hang.cjs");

describe("createPythonEmbeddingModel — fixes verified", () => {
  it("FIX F1: Python crashes before sending ready — embed() rejects", async () => {
    const model = createPythonEmbeddingModel({
      pythonPath: "node",
      scriptPath: silentScript,
      timeoutMs: 200,
    });
    await expect(model.embed("hello")).rejects.toThrow(
      /did not become ready within|exited with code/,
    );
    await model.close();
  }, 5000);

  it("FIX F2: close() during pending embed — all pending promises reject", async () => {
    const model = createPythonEmbeddingModel({
      pythonPath: "node",
      scriptPath: hangScript,
    });

    await new Promise((r) => setTimeout(r, 200));
    const embedPromise = model.embed("hello");
    await new Promise((r) => setTimeout(r, 100));
    await model.close();

    await expect(embedPromise).rejects.toThrow();
  }, 3000);

  it("FIX F4: request timeout — embed() rejects on timeout", async () => {
    const model = createPythonEmbeddingModel({
      pythonPath: "node",
      scriptPath: hangScript,
      timeoutMs: 200,
    });

    await new Promise((r) => setTimeout(r, 200));
    const embedPromise = model.embed("hello");

    await expect(embedPromise).rejects.toThrow("timed out");
    await model.close();
  }, 3000);
});

describe("createPythonEmbeddingModel — baseline behavior", () => {
  it("embed returns Float32Array with correct dimension", async () => {
    const model = createPythonEmbeddingModel({
      pythonPath: "node",
      scriptPath: fakeScript,
    });
    const result = await model.embed("hello");
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(384);
    await model.close();
  });

  it("embedBatch returns array of Float32Arrays", async () => {
    const model = createPythonEmbeddingModel({
      pythonPath: "node",
      scriptPath: fakeScript,
    });
    const results = await model.embedBatch(["a", "b", "c"]);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r).toBeInstanceOf(Float32Array);
      expect(r.length).toBe(384);
    }
    await model.close();
  });

  it("embedBatch handles empty array", async () => {
    const model = createPythonEmbeddingModel({
      pythonPath: "node",
      scriptPath: fakeScript,
    });
    const results = await model.embedBatch([]);
    expect(results).toEqual([]);
    await model.close();
  });

  it("concurrent embeds all resolve correctly", async () => {
    const model = createPythonEmbeddingModel({
      pythonPath: "node",
      scriptPath: fakeScript,
    });
    const [r1, r2, r3] = await Promise.all([
      model.embed("a"),
      model.embed("b"),
      model.embed("c"),
    ]);
    expect(r1).toBeInstanceOf(Float32Array);
    expect(r2).toBeInstanceOf(Float32Array);
    expect(r3).toBeInstanceOf(Float32Array);
    expect(r1.length).toBe(384);
    await model.close();
  });
});
