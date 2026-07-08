import { describe, it, expect } from "vitest";
import { cosineSimilarity, isSimilar, normalize } from "../src/embeddings/similarity";

function vec(values: number[]): Float32Array {
  return new Float32Array(values);
}

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const a = vec([1, 2, 3]);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = vec([1, 0]);
    const b = vec([0, 1]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it("returns -1 for opposite vectors", () => {
    const a = vec([1, 2, 3]);
    const b = vec([-1, -2, -3]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  it("returns a value between 0 and 1 for partially similar vectors", () => {
    const a = vec([1, 2, 3, 4, 5]);
    const b = vec([1, 2, 3, 0, 0]);
    const score = cosineSimilarity(a, b);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("throws for vectors of different length", () => {
    expect(() => cosineSimilarity(vec([1, 2]), vec([1, 2, 3]))).toThrow();
  });

  it("returns 0 for a zero vector", () => {
    const a = vec([1, 2, 3]);
    const b = vec([0, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it("returns 0 when both vectors are zero", () => {
    expect(cosineSimilarity(vec([0, 0, 0]), vec([0, 0, 0]))).toBeCloseTo(0, 5);
  });

  it("returns correct value for single-element vectors", () => {
    expect(cosineSimilarity(vec([5]), vec([10]))).toBeCloseTo(1, 5);
    expect(cosineSimilarity(vec([5]), vec([-5]))).toBeCloseTo(-1, 5);
  });

  it("handles NaN values gracefully (returns NaN, does not throw)", () => {
    const result = cosineSimilarity(vec([NaN, 1]), vec([1, 1]));
    expect(Number.isNaN(result)).toBe(true);
  });

  it("handles Infinity values without crashing", () => {
    // Infinity/Infinity = NaN — function should not throw
    expect(() =>
      cosineSimilarity(vec([Infinity, 0]), vec([Infinity, 0])),
    ).not.toThrow();
  });

  it("throws descriptive error for severely mismatched dimensions", () => {
    const a = new Float32Array(384);
    const b = new Float32Array(1);
    expect(() => cosineSimilarity(a, b)).toThrow(/384 vs 1/);
  });
});

describe("isSimilar", () => {
  it("returns true when cosine similarity exceeds default threshold", () => {
    const a = vec([1, 2, 3, 4, 5]);
    const b = vec([1.01, 2.02, 2.99, 4.01, 5.02]);
    expect(isSimilar(a, b)).toBe(true);
  });

  it("returns false when cosine similarity is below default threshold", () => {
    const a = vec([1, 0, 0, 0]);
    const b = vec([0, 1, 0, 0]);
    expect(isSimilar(a, b)).toBe(false);
  });

  it("respects custom threshold", () => {
    const a = vec([1, 0]);
    const b = vec([0.5, 1]);
    expect(isSimilar(a, b, 0.9)).toBe(false);
    expect(isSimilar(a, b, 0.4)).toBe(true);
  });

  it("default threshold is 0.85", () => {
    const a = vec([1, 2, 3]);
    const b = vec([1.15, 2.3, 3.45]);
    const score = cosineSimilarity(a, b);
    expect(isSimilar(a, b)).toBe(score >= 0.85);
  });

  it("returns true when score equals threshold within Float32 precision", () => {
    // a=[1,0], b=[0.85, sqrt(1-0.85²)] → cosine ≈ 0.85 in Float64
    // Float32 storage introduces ~4.9e-9 error, which rounds to 0.85
    const a = vec([1, 0]);
    const b = vec([0.85, Math.sqrt(1 - 0.85 * 0.85)]);
    const score = cosineSimilarity(a, b);
    expect(score).toBeCloseTo(0.85, 5);
    expect(isSimilar(a, b)).toBe(true);
  });

  it("works with threshold = 0 (everything similar)", () => {
    const a = vec([1, 0]);
    const b = vec([0, 1]);
    expect(isSimilar(a, b, 0)).toBe(true);
  });

  it("works with threshold = 1 (only identical)", () => {
    const a = vec([1, 2, 3]);
    const b = vec([1.01, 2.02, 2.99]);
    expect(isSimilar(a, b, 1)).toBe(false);
    expect(isSimilar(a, a, 1)).toBe(true);
  });

  it("handles NaN similarity score (returns false)", () => {
    const a = vec([NaN, 1]);
    const b = vec([1, 1]);
    expect(isSimilar(a, b)).toBe(false);
  });
});

describe("normalize", () => {
  it("produces a unit vector (magnitude ≈ 1)", () => {
    const v = vec([3, 4]);
    const n = normalize(v);
    const magnitude = Math.sqrt(n[0] * n[0] + n[1] * n[1]);
    expect(magnitude).toBeCloseTo(1, 5);
  });

  it("returns a zero vector for zero input", () => {
    const v = vec([0, 0, 0]);
    const n = normalize(v);
    expect(Array.from(n)).toEqual([0, 0, 0]);
  });

  it("preserves direction after normalization", () => {
    const v = vec([10, 20, 30]);
    const n = normalize(v);
    const ratio1 = v[1] / v[0];
    const ratio2 = n[1] / n[0];
    expect(ratio2).toBeCloseTo(ratio1, 5);
  });

  it("does not mutate the original array", () => {
    const v = vec([3, 4]);
    normalize(v);
    expect(v[0]).toBe(3);
    expect(v[1]).toBe(4);
  });

  it("normalizes single-element vector correctly", () => {
    const v = vec([5]);
    const n = normalize(v);
    expect(n[0]).toBeCloseTo(1, 5);
  });

  it("returns zero vector for NaN input (does not crash)", () => {
    const v = vec([NaN, 1]);
    const n = normalize(v);
    expect(n.some((x) => Number.isNaN(x))).toBe(true);
  });
});
