export const CONTEXT_CAP = 2500;
export const FOUNDATIONAL_CAP = 700;

export function countTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}
