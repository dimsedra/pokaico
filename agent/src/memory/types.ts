import type { JournalTurn } from "./journal";

export type SummaryOutput = {
  summary: string;
  keyPoints: string[];
};

export type FoundationalUpdate = {
  topicId: string;
  newContent: string | null;
};

export type TopicChange = {
  topicId: string;
  action: "update" | "create";
  content: string;
  similarityScore?: number;
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