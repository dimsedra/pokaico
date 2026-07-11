import type { JournalTurn } from "./journal";

export type TopicSegment = {
  title: string;
  summary: string;
  keyPoints: string[];
  relatedTo?: { topicIndex: number; reason: string }[];
};

export type SummaryOutput = {
  summary: string;
  keyPoints: string[];
  topics: TopicSegment[];
};

export type FoundationalUpdate = {
  topicId: string;
  newContent: string | null;
};

export type TopicChange = {
  topicId: string;
  action: "update" | "create" | "external";
  content: string;
  similarityScore?: number;
  resourceFile?: string;
  overflow?: CompactOverflow[];
  edges?: CompactEdge[];
};

export type CompactOverflow = {
  filename: string;
  content: string;
  relationship: string;
};

export type CompactEdge = {
  toTopic: string;
  relationship: string;
  reason?: string;
};

export type CompactResult = {
  context: string;
  overflow: CompactOverflow[];
  edges: CompactEdge[];
};

export type PipelineResult = {
  sessionId: string;
  hasNewMessages: boolean;
  summary: SummaryOutput | null;
  updates: FoundationalUpdate[];
  changes: TopicChange[];
  reindexed: string[];
  error?: string;
};