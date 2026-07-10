import { describe, it, expect } from "vitest";
import { countTokens, CONTEXT_CAP, FOUNDATIONAL_CAP } from "../src/memory/tokens";

describe("tokens", () => {
  it("counts empty string as zero", () => {
    expect(countTokens("")).toBe(0);
  });

  it("approximates tokens as ceil(chars / 4)", () => {
    expect(countTokens("abcd")).toBe(1);
    expect(countTokens("abcde")).toBe(2);
    expect(countTokens("a".repeat(400))).toBe(100);
  });

  it("exposes cap constants per SPEC", () => {
    expect(CONTEXT_CAP).toBe(2500);
    expect(FOUNDATIONAL_CAP).toBe(700);
  });
});
