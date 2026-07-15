import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const xberg = require("@xberg-io/xberg") as typeof import("@xberg-io/xberg");

export type ResourceExtractor = {
  extract: (filePath: string, opts?: { ocr?: boolean }) => Promise<string>;
};

export type XbergExtractorOptions = {
  /** Enable OCR (Tesseract) for scanned docs/images. Off by default. */
  ocr?: boolean;
  /** OCR language hints (ISO 639-1). Ignored unless `ocr` is true. */
  language?: string[];
};

export function createXbergExtractor(opts?: XbergExtractorOptions): ResourceExtractor {
  const defaultOcrEnabled = opts?.ocr ?? false;
  const language = opts?.language ?? ["eng"];

  return {
    async extract(filePath: string, extractOpts?: { ocr?: boolean }): Promise<string> {
      const input = xberg.extractInputFromUri(filePath);
      const ocrEnabled = extractOpts?.ocr ?? defaultOcrEnabled;
      const config = ocrEnabled
        ? { ocr: { backend: "tesseract", language } }
        : {};

      const result = await xberg.extract(input, config as never);
      const text = result.results?.[0]?.content;
      return text ?? "";
    },
  };
}
