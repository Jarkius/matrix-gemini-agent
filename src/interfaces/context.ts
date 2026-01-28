/**
 * Context Types
 *
 * Defines Matrix context loading for research awareness.
 */

export interface MatrixContext {
  soulSeed: string | null; // From SOUL_SEED.md
  relevantDocs: RelevantDocument[]; // From Matrix knowledge
  recentHistory: HistoryContext[]; // From research history
}

export interface RelevantDocument {
  path: string;
  title: string;
  content: string;
  relevanceScore: number; // 0-1
  source: ContextSource;
}

export type ContextSource = "knowledge" | "learnings" | "specs" | "learn";

export interface HistoryContext {
  id: number;
  query: string;
  summary: string;
  createdAt: string;
}

export interface ContextSearchOptions {
  query: string;
  maxDocs?: number;
  minRelevance?: number;
  sources?: ContextSource[];
  maxCharsPerDoc?: number;
}

export interface ContextLoaderConfig {
  matrixPath: string;
  maxTotalChars: number;
  cacheMaxAge: number;
  defaultSources: ContextSource[];
}

// Default configuration
export const DEFAULT_CONTEXT_CONFIG: ContextLoaderConfig = {
  matrixPath: "~/workspace/The-matrix",
  maxTotalChars: 8000, // Keep context manageable for tokens
  cacheMaxAge: 60_000, // 1 minute (matches SoulConnector)
  defaultSources: ["knowledge", "learnings", "learn"],
};

// Directory mapping for context sources
export const SOURCE_DIRECTORIES: Record<ContextSource, string> = {
  knowledge: "psi/memory/knowledge",
  learnings: "psi/memory/learnings",
  specs: "psi/specs",
  learn: "psi/learn/active",
};
