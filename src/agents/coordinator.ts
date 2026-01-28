/**
 * Morpheus Coordinator
 *
 * Orchestrates deep research with parallel agents.
 * Main entry point for multi-step, context-aware research.
 */

import type { GeminiClient } from "../gemini/api";
import type { MissionDatabase } from "../db/missions";
import type { ResearchHistory } from "../db/history";
import type { SoulConnector } from "../soul/connector";
import type {
  ResearchMission,
  ResearchResult,
  MissionPlan,
  ResearchDepth,
} from "../interfaces/mission";
import type { MatrixContext } from "../interfaces/context";

import { MorpheusPool } from "./pool";
import { QueryPlanner } from "../reasoning/planner";
import { StepExecutor } from "../reasoning/executor";
import { ResultSynthesizer, type SynthesisResult, type HarvestedLearning } from "../reasoning/synthesizer";
import { ContextLoader } from "../context/loader";

export interface CoordinatorConfig {
  maxSteps: number;
  loadContext: boolean;
  harvestLearnings: boolean;
  exportToMatrix: boolean;
}

const DEFAULT_CONFIG: CoordinatorConfig = {
  maxSteps: 7,
  loadContext: true,
  harvestLearnings: true,
  exportToMatrix: true,
};

export interface DeepResearchResult {
  output: string;
  plan: MissionPlan;
  synthesis: SynthesisResult;
  learnings: HarvestedLearning[];
  metadata: {
    totalDurationMs: number;
    missionsCompleted: number;
    missionsFailed: number;
    agentsUsed: number;
    contextLoaded: boolean;
  };
}

export class MorpheusCoordinator {
  private pool: MorpheusPool;
  private planner: QueryPlanner;
  private executor: StepExecutor;
  private synthesizer: ResultSynthesizer;
  private contextLoader: ContextLoader;
  private gemini: GeminiClient;
  private missionDb: MissionDatabase;
  private history: ResearchHistory;
  private config: CoordinatorConfig;

  constructor(
    gemini: GeminiClient,
    missionDb: MissionDatabase,
    history: ResearchHistory,
    soul: SoulConnector,
    config?: Partial<CoordinatorConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.gemini = gemini;
    this.missionDb = missionDb;
    this.history = history;

    // Initialize components
    this.pool = new MorpheusPool();
    this.planner = new QueryPlanner(gemini, { maxSteps: this.config.maxSteps });
    this.contextLoader = new ContextLoader(soul, history);
    this.executor = new StepExecutor(gemini, missionDb, this.contextLoader);
    this.synthesizer = new ResultSynthesizer(gemini, missionDb);
  }

  /**
   * Main entry point for deep research
   */
  async research(
    query: string,
    depth: ResearchDepth,
    options?: Partial<CoordinatorConfig>
  ): Promise<DeepResearchResult> {
    const startTime = Date.now();
    const config = { ...this.config, ...options };

    console.error(`[Coordinator] Starting deep research: "${query.slice(0, 50)}..."`);
    console.error(`[Coordinator] Depth: ${depth}, Context: ${config.loadContext}`);

    // Step 1: Load context if enabled
    let baseContext: MatrixContext | undefined;
    if (config.loadContext) {
      console.error("[Coordinator] Loading Matrix context...");
      baseContext = await this.contextLoader.buildContext(query);
      console.error(`[Coordinator] Context loaded: ${baseContext.relevantDocs.length} docs, ${baseContext.recentHistory.length} history entries`);
    }

    // Step 2: Decompose query into plan
    console.error("[Coordinator] Planning research steps...");
    const plan = await this.planner.decompose(query, depth);
    const validation = this.planner.validatePlan(plan);

    if (!validation.valid) {
      throw new Error(`Invalid plan: ${validation.errors.join(", ")}`);
    }

    console.error(`[Coordinator] Plan created: ${plan.missions.length} missions`);

    // Step 3: Save missions to database
    for (const mission of plan.missions) {
      await this.missionDb.saveMission(mission);
    }

    // Step 4: Execute missions with parallel gathering
    console.error("[Coordinator] Executing research missions...");
    const results = await this.executeWithParallelGathering(plan, baseContext);

    // Step 5: Synthesize results
    console.error("[Coordinator] Synthesizing findings...");
    const synthesis = await this.synthesizer.synthesize(plan, results);

    // Step 6: Harvest learnings if enabled
    let learnings: HarvestedLearning[] = [];
    if (config.harvestLearnings) {
      console.error("[Coordinator] Harvesting learnings...");
      learnings = await this.synthesizer.harvestLearnings(plan, synthesis);

      if (learnings.length > 0 && config.exportToMatrix) {
        const sourceIds = plan.missions.map((m) => m.id);
        await this.synthesizer.saveLearnings(learnings, sourceIds);
        console.error(`[Coordinator] Exported ${learnings.length} learnings to Matrix`);
      }
    }

    // Step 7: Save to history
    await this.history.save("research", query, synthesis.output);

    const totalDurationMs = Date.now() - startTime;
    console.error(`[Coordinator] Research complete in ${Math.round(totalDurationMs / 1000)}s`);

    // Format final output
    const output = this.synthesizer.formatOutput(synthesis, learnings);

    return {
      output,
      plan,
      synthesis,
      learnings,
      metadata: {
        totalDurationMs,
        missionsCompleted: synthesis.missionsCompleted,
        missionsFailed: synthesis.missionsFailed,
        agentsUsed: this.pool.getStats().total,
        contextLoaded: config.loadContext,
      },
    };
  }

  /**
   * Execute missions with parallel gathering pattern
   * "Haiku gathers, Opus synthesizes"
   */
  private async executeWithParallelGathering(
    plan: MissionPlan,
    baseContext?: MatrixContext
  ): Promise<Map<string, ResearchResult>> {
    const results = await this.executor.executeReady(plan.missions, baseContext);

    // Update mission statuses in plan
    for (const mission of plan.missions) {
      const result = results.get(mission.id);
      if (result) {
        mission.status = "completed";
        mission.result = result;
        mission.completedAt = new Date();
      }
    }

    return results;
  }

  /**
   * Get status of an ongoing mission plan
   */
  async getStatus(planId: string): Promise<{
    status: "running" | "completed" | "failed";
    progress: number;
    completedMissions: number;
    totalMissions: number;
    currentMission?: string;
  }> {
    const missions = await this.missionDb.getPendingMissions();
    const planMissions = missions.filter((m) => m.id.startsWith(planId));

    if (planMissions.length === 0) {
      return {
        status: "completed",
        progress: 100,
        completedMissions: 0,
        totalMissions: 0,
      };
    }

    const completed = planMissions.filter((m) => m.status === "completed").length;
    const failed = planMissions.filter((m) => m.status === "failed").length;
    const running = planMissions.find((m) => m.status === "running");

    const total = planMissions.length;
    const progress = Math.round((completed / total) * 100);

    let status: "running" | "completed" | "failed" = "running";
    if (completed === total) status = "completed";
    if (failed > 0 && completed + failed === total) status = "failed";

    return {
      status,
      progress,
      completedMissions: completed,
      totalMissions: total,
      currentMission: running?.query,
    };
  }

  /**
   * Export all learnings to Matrix since a date
   */
  async exportLearnings(since?: string): Promise<number> {
    return this.synthesizer.exportAllToMatrix(since);
  }

  /**
   * Get pool stats
   */
  getPoolStats() {
    return this.pool.getStats();
  }

  /**
   * Get database stats
   */
  async getStats() {
    return this.missionDb.getStats();
  }

  /**
   * Shutdown coordinator
   */
  shutdown(): void {
    this.pool.drain();
    this.executor.cancelAll();
    console.error("[Coordinator] Shutdown complete");
  }
}
