import { generateText, Output } from "ai";
import type { LanguageModelV1 } from "ai";
import { z } from "zod";
import type { CompactEdge, CompactResult } from "./types";

const compactSchema = z.object({
  context: z
    .string()
    .describe(
      "The refined CONTEXT.md content: a lean, high-level understanding of the topic within the token cap. Merge new info, remove stale or contradicting statements, keep inline references to any overflow resources.",
    ),
  overflow: z
    .array(
      z.object({
        filename: z.string().describe("kebab-case markdown filename, e.g. project-details.md"),
        content: z.string().describe("The detailed content that did not fit in CONTEXT.md"),
        relationship: z
          .string()
          .describe("Edge label for this resource, usually 'has-detailed-notes'"),
      }),
    )
    .describe("Detail that genuinely cannot be condensed, spilled to resources/. Empty if none.")
    .default([]),
  edges: z
    .array(
      z.object({
        toTopic: z.string().describe("The related topic id"),
        relationship: z.string().describe("Free-text relationship label, e.g. 'related-to'"),
        reason: z.string().optional().describe("Brief explanation of why these topics are related"),
      }),
    )
    .describe("Cross-topic connections to preserve or add. Include a brief reason for each connection. Empty if none.")
    .default([]),
});

export type CompactInput = {
  current: string;
  newInfo: string;
  cap: number;
  model: LanguageModelV1;
  existingEdges?: CompactEdge[];
};

export async function compact(input: CompactInput): Promise<CompactResult> {
  const { current, newInfo, cap, model, existingEdges = [] } = input;

  const edgesSection =
    existingEdges.length > 0
      ? `\n\nExisting connections to preserve unless clearly obsolete:\n${existingEdges
          .map((e) => `- ${e.relationship} -> ${e.toTopic}: ${e.reason ?? "(no reason given)"}`)
          .join("\n")}`
      : "";

  const { output } = await generateText({
    model,
    output: Output.object({ schema: compactSchema }),
    prompt: `You maintain a topic's CONTEXT.md — a high-level, lean understanding of the topic. It has a hard cap of ${cap} tokens (roughly ${cap * 4} characters).

Refine the CURRENT content by integrating the NEW information:
- Keep it high-level and dense; drop redundant, stale, or contradicting statements (prefer the newer fact on conflict).
- Stay within the ${cap}-token cap.
- Only if essential detail genuinely cannot be condensed without losing meaning, move that detail into an overflow resource file and leave an inline reference like "See [notes](resources/<filename>)" in the context.
- Preserve meaningful connections to other topics/resources. For each edge you output, include a brief reason explaining the relationship.

CURRENT CONTEXT.md:
${current || "(empty)"}

NEW information from the latest conversation:
${newInfo}${edgesSection}`,
  });

  return {
    context: output.context,
    overflow: output.overflow ?? [],
    edges: output.edges ?? [],
  };
}
