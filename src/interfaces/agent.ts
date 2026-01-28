/**
 * Agent Types
 *
 * Defines Morpheus agent roles and behavior.
 * Follows Soul Seed Prime Directive #3: "Right Mind for Task"
 */

import type { ResearchDepth } from "./mission";

export type MorpheusRole = "gatherer" | "analyst" | "synthesizer";

export type AgentStatus = "idle" | "busy" | "error" | "terminated";

export interface MorpheusAgent {
  id: number;
  name: string;
  role: MorpheusRole;
  status: AgentStatus;
  currentMissionId?: string;
  missionsCompleted: number;
  missionsFailed: number;
  createdAt: Date;
  lastActiveAt?: Date;
}

export interface RoleBehavior {
  promptPrefix: string;
  depth: ResearchDepth;
  maxConcurrent: number;
  description: string;
}

/**
 * Role-based behavior configuration
 *
 * Gatherer: Fast parallel scans (Haiku-like)
 * Analyst: Balanced analysis (Sonnet-like)
 * Synthesizer: Deep sequential synthesis (Opus-like)
 */
export const ROLE_BEHAVIOR: Record<MorpheusRole, RoleBehavior> = {
  gatherer: {
    promptPrefix: "Quickly gather key facts and information about:",
    depth: "quick",
    maxConcurrent: 5,
    description: "Fast parallel information gathering",
  },
  analyst: {
    promptPrefix: "Analyze in depth, examining patterns and implications:",
    depth: "standard",
    maxConcurrent: 2,
    description: "Balanced analytical processing",
  },
  synthesizer: {
    promptPrefix:
      "Synthesize all gathered information into comprehensive insight. Connect patterns, resolve contradictions, and provide actionable wisdom:",
    depth: "deep",
    maxConcurrent: 1,
    description: "Deep sequential synthesis",
  },
};

export interface AgentPoolStats {
  total: number;
  idle: number;
  busy: number;
  byRole: Record<MorpheusRole, number>;
}

export interface AgentAssignment {
  agentId: number;
  missionId: string;
  assignedAt: Date;
}
