import { describe, it, expect } from "vitest";
import { createModelFromSession, type OnnxSession } from "../src/embeddings/model";

function makeMockSession(embeddingDim: number = 768): OnnxSession {
  return {
    run: async (_feeds: Record<string, unknown>) => {
      const data = new Float32Array(embeddingDim);
      for (let i = 0; i < embeddingDim; i++) {
        data[i] = Math.sin(i) * 0.1;
      }
      return { last_hidden_state: { data } };
    },
    release: async () => {},
  };
}

describe("createModelFromSession", () => {
  it("creates an embeddding model from a mock session", () => {
    const model = createModelFromSession(makeMockSession(768));
    expect(model).toBeDefined();
  });

  it("embed returns a Float32Array with the correct dimension", async () => {
    const model = createModelFromSession(makeMockSession(768));
    const result = await model.embed("test text");
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(768);
  });

  it("embed is deterministic for the same input", async () => {
    const mockSession: OnnxSession = {
      run: async (_feeds: Record<string, unknown>) => {
        const inputText = String(Object.values(_feeds)[0] ?? "");
        const data = new Float32Array(4);
        data[0] = inputText.length;
        return { last_hidden_state: { data } };
      },
      release: async () => {},
    };
    const model = createModelFromSession(mockSession);

    const a = await model.embed("hello");
    const b = await model.embed("hello");
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("embedBatch returns embeddings for multiple texts", async () => {
    let callCount = 0;
    const mockSession: OnnxSession = {
      run: async () => {
        const data = new Float32Array(4);
        data[0] = ++callCount;
        return { last_hidden_state: { data } };
      },
      release: async () => {},
    };
    const model = createModelFromSession(mockSession);

    const results = await model.embedBatch(["a", "b", "c"]);
    expect(results).toHaveLength(3);
    expect(results[0][0]).toBe(1);
    expect(results[1][0]).toBe(2);
    expect(results[2][0]).toBe(3);
  });

  it("close releases the session", async () => {
    let released = false;
    const mockSession: OnnxSession = {
      run: async () => ({ last_hidden_state: { data: new Float32Array(4) } }),
      release: async () => { released = true; },
    };
    const model = createModelFromSession(mockSession);
    await model.close();
    expect(released).toBe(true);
  });

  it("handles empty string input", async () => {
    const model = createModelFromSession(makeMockSession(4));
    const result = await model.embed("");
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(4);
  });

  it("handles very long string input", async () => {
    const model = createModelFromSession(makeMockSession(4));
    const longStr = "x".repeat(100000);
    const result = await model.embed(longStr);
    expect(result).toBeInstanceOf(Float32Array);
  });

  it("handles unicode and emoji input", async () => {
    const model = createModelFromSession(makeMockSession(4));
    const result = await model.embed("Héllò wörld 🌍 🎉 日本語");
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(4);
  });

  it("embedBatch with empty array returns empty array", async () => {
    const model = createModelFromSession(makeMockSession(4));
    const results = await model.embedBatch([]);
    expect(results).toEqual([]);
  });

  it("propagates session.run errors", async () => {
    const failingSession: OnnxSession = {
      run: async () => { throw new Error("ONNX runtime error"); },
      release: async () => {},
    };
    const model = createModelFromSession(failingSession);
    await expect(model.embed("test")).rejects.toThrow("ONNX runtime error");
  });

  it("handles session returning unexpected output shape", async () => {
    // Session returns an output with no 'last_hidden_state' key
    // embed accesses result.last_hidden_state.data — should get undefined
    const weirdSession: OnnxSession = {
      run: async () => ({ wrong_key: { data: new Float32Array(4) } } as any),
      release: async () => {},
    };
    const model = createModelFromSession(weirdSession);
    await expect(model.embed("test")).rejects.toThrow();
  });
});

describe("loadModel", () => {
  it("throws for non-existent path", async () => {
    const { loadModel } = await import("../src/embeddings/model");
    await expect(loadModel("/nonexistent/model.onnx")).rejects.toThrow();
  });
});
