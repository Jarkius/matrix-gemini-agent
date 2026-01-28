/**
 * Query Planner
 *
 * Decomposes complex queries into sub-queries with dependencies.
 * Uses Gemini to analyze query structure and create execution plan.
 */

import { randomUUID } from "crypto";
import type { GeminiClient } from "../gemini/api";
import type {
  ResearchMission,
  MissionPlan,
  ResearchDepth,
  Priority,
} from "../interfaces/mission";
import { DEPTH_TIMEOUTS } from "../interfaces/mission";

export interface PlannerConfig {
  maxSteps: number;
  defaultPriority: Priority;
}

const DEFAULT_CONFIG: PlannerConfig = {
  maxSteps: 7,
  defaultPriority: "normal",
};

export class QueryPlanner {
  private gemini: GeminiClient;
  private config: PlannerConfig;

  constructor(gemini: GeminiClient, config?: Partial<PlannerConfig>) {
    this.gemini = gemini;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Decompose a complex query into a mission plan
   */
  async decompose(
    query: string,
    depth: ResearchDepth
  ): Promise<MissionPlan> {
    const stepCount = this.getStepCount(depth);

    // For quick depth, just return single mission
    if (stepCount === 1) {
      return this.createSingleMissionPlan(query, depth);
    }

    // Use Gemini to decompose the query
    const decomposition = await this.analyzeQuery(query, stepCount);

    // Create missions from decomposition
    const missions = this.createMissions(decomposition, depth);

    // Analyze and set dependencies
    this.analyzeDependencies(missions);

    return {
      originalQuery: query,
      missions,
      estimatedSteps: missions.length,
      estimatedDurationMs: this.estimateDuration(missions),
    };
  }

  /**
   * Get number of steps based on depth
   */
  private getStepCount(depth: ResearchDepth): number {
    switch (depth) {
      case "quick":
        return 1;
      case "standard":
        return 3;
      case "deep":
        return Math.min(this.config.maxSteps, 5);
    }
  }

  /**
   * Create a single-mission plan for quick queries
   */
  private createSingleMissionPlan(
    query: string,
    depth: ResearchDepth
  ): MissionPlan {
    const mission = this.createMission(query, depth, "high");
    return {
      originalQuery: query,
      missions: [mission],
      estimatedSteps: 1,
      estimatedDurationMs: DEPTH_TIMEOUTS[depth],
    };
  }

  /**
   * Use Gemini to analyze and decompose the query
   */
  private async analyzeQuery(
    query: string,
    targetSteps: number
  ): Promise<QueryDecomposition> {
    const prompt = `Analyze this research query and decompose it into ${targetSteps} focused sub-queries.

Query: "${query}"

Return a JSON object with this structure:
{
  "subQueries": [
    {
      "query": "specific sub-query text",
      "purpose": "what this sub-query investigates",
      "dependsOnIndex": null or number (index of another sub-query this depends on)
    }
  ],
  "synthesisQuery": "final query to synthesize all findings"
}

Rules:
1. Each sub-query should be specific and focused
2. First sub-queries should gather foundational information
3. Later sub-queries can build on earlier findings (use dependsOnIndex)
4. The synthesisQuery combines all findings into a comprehensive answer
5. Return ONLY valid JSON, no markdown or explanation

Example for "How does TypeScript improve code quality?":
{
  "subQueries": [
    {"query": "What is TypeScript's type system and how does static typing work?", "purpose": "Understand fundamentals", "dependsOnIndex": null},
    {"query": "What common JavaScript bugs does TypeScript prevent?", "purpose": "Concrete error prevention", "dependsOnIndex": 0},
    {"query": "How does TypeScript improve IDE support and developer experience?", "purpose": "Tooling benefits", "dependsOnIndex": null}
  ],
  "synthesisQuery": "Synthesize how TypeScript's type system, error prevention, and tooling combine to improve code quality"
}`;

    try {
      const response = await this.gemini.query(prompt);

      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error("[Planner] Failed to extract JSON from response");
        return this.createFallbackDecomposition(query, targetSteps);
      }

      const parsed = JSON.parse(jsonMatch[0]) as QueryDecomposition;

      // Validate structure
      if (!parsed.subQueries || !Array.isArray(parsed.subQueries)) {
        return this.createFallbackDecomposition(query, targetSteps);
      }

      return parsed;
    } catch (error) {
      console.error("[Planner] Decomposition failed:", error);
      return this.createFallbackDecomposition(query, targetSteps);
    }
  }

  /**
   * Fallback decomposition when Gemini fails
   */
  private createFallbackDecomposition(
    query: string,
    targetSteps: number
  ): QueryDecomposition {
    const subQueries: SubQuery[] = [
      {
        query: `What is the background and context for: ${query}`,
        purpose: "Gather foundational context",
        dependsOnIndex: null,
      },
      {
        query: `What are the key aspects and components of: ${query}`,
        purpose: "Identify main elements",
        dependsOnIndex: null,
      },
    ];

    if (targetSteps > 2) {
      subQueries.push({
        query: `What are practical examples and applications of: ${query}`,
        purpose: "Real-world applications",
        dependsOnIndex: 1,
      });
    }

    if (targetSteps > 3) {
      subQueries.push({
        query: `What are the benefits and challenges of: ${query}`,
        purpose: "Pros and cons analysis",
        dependsOnIndex: 1,
      });
    }

    return {
      subQueries: subQueries.slice(0, targetSteps - 1),
      synthesisQuery: `Synthesize all findings about: ${query}`,
    };
  }

  /**
   * Create ResearchMission objects from decomposition
   */
  private createMissions(
    decomposition: QueryDecomposition,
    depth: ResearchDepth
  ): ResearchMission[] {
    const missions: ResearchMission[] = [];

    // Create gathering missions
    for (let i = 0; i < decomposition.subQueries.length; i++) {
      const subQuery = decomposition.subQueries[i]!;
      const mission = this.createMission(
        subQuery.query,
        "quick", // Gatherers use quick depth
        i === 0 ? "high" : "normal"
      );
      mission.context = subQuery.purpose;
      missions.push(mission);
    }

    // Create synthesis mission
    const synthesisMission = this.createMission(
      decomposition.synthesisQuery,
      depth, // Synthesis uses full depth
      "high"
    );
    synthesisMission.context = "Final synthesis of all gathered information";
    missions.push(synthesisMission);

    return missions;
  }

  /**
   * Create a single mission
   */
  private createMission(
    query: string,
    depth: ResearchDepth,
    priority: Priority
  ): ResearchMission {
    return {
      id: randomUUID(),
      query,
      depth,
      priority,
      status: "pending",
      createdAt: new Date(),
      retryCount: 0,
      maxRetries: 3,
      timeoutMs: DEPTH_TIMEOUTS[depth],
    };
  }

  /**
   * Analyze and set dependencies between missions
   */
  private analyzeDependencies(missions: ResearchMission[]): void {
    if (missions.length === 0) return;

    // Last mission (synthesis) depends on all others
    const synthesisMission = missions[missions.length - 1]!;
    synthesisMission.dependsOn = missions
      .slice(0, -1)
      .map((m) => m.id);

    // Check for explicit dependencies from decomposition
    // (already handled in subQuery.dependsOnIndex during creation)
  }

  /**
   * Estimate total duration for plan
   */
  private estimateDuration(missions: ResearchMission[]): number {
    if (missions.length === 0) return 0;

    // Parallel gathering + sequential synthesis
    const gatherMissions = missions.slice(0, -1);
    const synthesisMission = missions[missions.length - 1]!;

    // Gathering can be parallel, so take max timeout
    const gatherTime = gatherMissions.length > 0
      ? Math.max(...gatherMissions.map((m) => m.timeoutMs))
      : 0;

    return gatherTime + synthesisMission.timeoutMs;
  }

  /**
   * Validate a mission plan
   */
  validatePlan(plan: MissionPlan): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (plan.missions.length === 0) {
      errors.push("Plan has no missions");
    }

    if (plan.missions.length > this.config.maxSteps) {
      errors.push(`Plan exceeds max steps (${this.config.maxSteps})`);
    }

    // Check for dependency cycles
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const hasCycle = (missionId: string): boolean => {
      if (inStack.has(missionId)) return true;
      if (visited.has(missionId)) return false;

      visited.add(missionId);
      inStack.add(missionId);

      const mission = plan.missions.find((m) => m.id === missionId);
      if (mission?.dependsOn) {
        for (const depId of mission.dependsOn) {
          if (hasCycle(depId)) return true;
        }
      }

      inStack.delete(missionId);
      return false;
    };

    for (const mission of plan.missions) {
      if (hasCycle(mission.id)) {
        errors.push(`Dependency cycle detected involving mission: ${mission.id}`);
        break;
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

// Internal types for decomposition
interface SubQuery {
  query: string;
  purpose: string;
  dependsOnIndex: number | null;
}

interface QueryDecomposition {
  subQueries: SubQuery[];
  synthesisQuery: string;
}
