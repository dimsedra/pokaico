import { cosineSimilarity as computeCosine } from "./math";

const DEFAULT_SIMILARITY_THRESHOLD = 0.85;

export { cosineSimilarity } from "./math";

export function isSimilar(
  a: Float32Array,
  b: Float32Array,
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD,
): boolean {
  return computeCosine(a, b) >= threshold;
}

export function normalize(v: Float32Array): Float32Array {
  let magnitude = 0;
  for (let i = 0; i < v.length; i++) {
    magnitude += v[i] * v[i];
  }
  magnitude = Math.sqrt(magnitude);

  if (magnitude === 0) return new Float32Array(v.length);

  const result = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) {
    result[i] = v[i] / magnitude;
  }
  return result;
}
