// Resource text extraction seam. `read_resource` (and later `ingest_resource`)
// need to turn arbitrary blobs — docs, PDFs, XLSX, PPTX, images — into
// clean text so they become "connectable" to the rest of the Pokaico graph
// (SPEC §7). Xberg (@xberg-io/xberg) is the declared extractor, but the
// published package is currently a placeholder (v0.0.1) with no API, so the
// real binding is wired in Task 9 (ingest_resource), which owns the Xberg
// integration. Until then this throws a clear error that read_resource catches
// and surfaces as `{ content: null, error }`.
export type ResourceExtractor = {
  extract: (filePath: string) => Promise<string>;
};

export function createXbergExtractor(_opts?: { ocr?: boolean }): ResourceExtractor {
  return {
    async extract(filePath: string): Promise<string> {
      // TODO(Task 9): replace with the real Xberg call, e.g.
      //   const xberg = await import("@xberg-io/xberg");
      //   return xberg.extractText(filePath, { ocr: _opts?.ocr });
      throw new Error(`Xberg extraction not available for: ${filePath}`);
    },
  };
}
