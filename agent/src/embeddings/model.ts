export type OnnxSession = {
  run(feeds: Record<string, unknown>): Promise<{ [outputName: string]: { data: Float32Array } }>;
  release(): Promise<void>;
};

export type EmbeddingModel = {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  close(): Promise<void>;
};

export function createModelFromSession(session: OnnxSession, dims: number = 768): EmbeddingModel {
  async function embed(text: string): Promise<Float32Array> {
    const feeds = {
      input_ids: text,
      attention_mask: text,
    };
    const result = await session.run(feeds);
    return result.last_hidden_state.data;
  }

  async function embedBatch(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map(embed));
  }

  async function close(): Promise<void> {
    await session.release();
  }

  return { embed, embedBatch, close };
}

export async function loadModel(modelPath: string): Promise<EmbeddingModel> {
  let ort: typeof import("onnxruntime-node");
  try {
    ort = await import("onnxruntime-node");
  } catch {
    throw new Error(
      "onnxruntime-node is not available. Install it to use local embedding models.",
    );
  }

  let session: OnnxSession;
  try {
    session = await ort.InferenceSession.create(modelPath);
  } catch {
    throw new Error(`Cannot load ONNX model at: ${modelPath}`);
  }

  return createModelFromSession(session);
}
