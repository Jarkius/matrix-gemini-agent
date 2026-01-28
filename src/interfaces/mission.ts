/**
 * Mission Types
 *
 * Defines research missions for multi-step reasoning.
 */

export type MissionStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "blocked";

export type Priority = "critical" | "high" | "normal" | "low";

export type ResearchDepth = "quick" | "standard" | "deep";

export interface ResearchMission {
  id: string;
  query: string;
  depth: ResearchDepth;
  priority: Priority;
  status: MissionStatus;
  dependsOn?: string[]; // Mission IDs this depends on
  context?: string; // Injected Matrix context
  result?: ResearchResult;
  error?: MissionError;
  agentId?: number; // Assigned Morpheus agent
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  retryCount: number;
  maxRetries: number;
  timeoutMs: number;
}

export interface ResearchResult {
  output: string;
  sources?: string[];
  confidence: number; // 0-1
  durationMs: number;
  tokenUsage?: {
    input: number;
    output: number;
  };
}

export interface MissionError {
  code: "timeout" | "api_error" | "rate_limit" | "dependency_failed" | "unknown";
  message: string;
  recoverable: boolean;
}

export interface MissionPlan {
  originalQuery: string;
  missions: ResearchMission[];
  estimatedSteps: number;
  estimatedDurationMs: number;
}

// Priority weights for queue ordering
export const PRIORITY_WEIGHTS: Record<Priority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

// Default timeouts by depth
export const DEPTH_TIMEOUTS: Record<ResearchDepth, number> = {
  quick: 30_000, // 30 seconds
  standard: 60_000, // 1 minute
  deep: 120_000, // 2 minutes
};
