/**
 * Step Executor
 *
 * Executes research missions with dependency tracking and retry logic.
 * Follows Agent Orchestra mission-queue patterns.
 */

import type { GeminiClient } from "../gemini/api";
import type { MissionDatabase } from "../db/missions";
import type {
  ResearchMission,
  ResearchResult,
  MissionError,
  MissionStatus,
} from "../interfaces/mission";
import type { MatrixContext } from "../interfaces/context";
import type { ContextLoader } from "../context/loader";

export interface ExecutorConfig {
  maxConcurrent: number;
  retryDelayMs: number;
  retryBackoffMultiplier: number;
}

const DEFAULT_CONFIG: ExecutorConfig = {
  maxConcurrent: 5,
  retryDelayMs: 1000,
  retryBackoffMultiplier: 2,
};

export class StepExecutor {
  private gemini: GeminiClient;
  private missionDb: MissionDatabase;
  private contextLoader: ContextLoader;
  private config: ExecutorConfig;
  private runningMissions: Map<string, AbortController> = new Map();

  constructor(
    gemini: GeminiClient,
    missionDb: MissionDatabase,
    contextLoader: ContextLoader,
    config?: Partial<ExecutorConfig>
  ) {
    this.gemini = gemini;
    this.missionDb = missionDb;
    this.contextLoader = contextLoader;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute all ready missions in parallel (up to maxConcurrent)
   */
  async executeReady(
    missions: ResearchMission[],
    baseContext?: MatrixContext
  ): Promise<Map<string, ResearchResult>> {
    const results = new Map<string, ResearchResult>();
    const completedIds = new Set<string>();

    // Track which missions are complete
    for (const m of missions) {
      if (m.status === "completed" && m.result) {
        completedIds.add(m.id);
        results.set(m.id, m.result);
      }
    }

    // Keep executing until all done
    while (completedIds.size < missions.length) {
      // Find ready missions (dependencies met, not completed)
      const ready = missions.filter((m) => {
        if (completedIds.has(m.id)) return false;
        if (m.status === "failed") return false;
        if (!m.dependsOn?.length) return true;
        return m.dependsOn.every((depId) => completedIds.has(depId));
      });

      if (ready.length === 0) {
        // Check for failures blocking progress
        const blocked = missions.filter(
          (m) => !completedIds.has(m.id) && m.status !== "failed"
        );
        if (blocked.length > 0) {
          console.error("[Executor] Deadlock detected - blocked missions:", blocked.map(m => m.id));
          break;
        }
        break;
      }

      // Execute ready missions in parallel (limited by maxConcurrent)
      const batch = ready.slice(0, this.config.maxConcurrent);
      console.error(`[Executor] Executing batch of ${batch.length} missions`);

      const batchResults = await Promise.allSettled(
        batch.map((m) => this.executeMission(m, baseContext, results))
      );

      // Process results
      for (let i = 0; i < batchResults.length; i++) {
        const mission = batch[i]!;
        const result = batchResults[i]!;

        if (result.status === "fulfilled") {
          results.set(mission.id, result.value);
          completedIds.add(mission.id);
          mission.status = "completed";
          mission.result = result.value;
          mission.completedAt = new Date();
        } else {
          const error = result.reason ?? new Error("Unknown error");
          await this.handleFailure(mission, error);

          // Check if we should retry
          if (mission.retryCount < mission.maxRetries) {
            mission.status = "queued";
          } else {
            mission.status = "failed";
          }
        }

        // Persist state
        await this.missionDb.saveMission(mission);
      }
    }

    return results;
  }

  /**
   * Execute a single mission
   */
  async executeMission(
    mission: ResearchMission,
    baseContext?: MatrixContext,
    priorResults?: Map<string, ResearchResult>
  ): Promise<ResearchResult> {
    const startTime = Date.now();
    const abortController = new AbortController();
    this.runningMissions.set(mission.id, abortController);

    try {
      // Update status
      mission.status = "running";
      mission.startedAt = new Date();
      await this.missionDb.updateMissionStatus(mission.id, "running", {
        startedAt: mission.startedAt,
      });

      // Build context for this mission
      const context = await this.buildMissionContext(
        mission,
        baseContext,
        priorResults
      );

      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Mission timed out after ${mission.timeoutMs}ms`));
        }, mission.timeoutMs);
      });

      // Execute research
      const researchPromise = this.performResearch(mission, context);

      // Race between research and timeout
      const output = await Promise.race([researchPromise, timeoutPromise]);

      const durationMs = Date.now() - startTime;

      const result: ResearchResult = {
        output,
        confidence: this.estimateConfidence(output),
        durationMs,
      };

      // Save raw finding
      await this.missionDb.saveRawFinding(mission.id, output);

      console.error(`[Executor] Mission ${mission.id.slice(0, 8)} completed in ${durationMs}ms`);

      return result;
    } finally {
      this.runningMissions.delete(mission.id);
    }
  }

  /**
   * Build context for a specific mission
   */
  private async buildMissionContext(
    mission: ResearchMission,
    baseContext?: MatrixContext,
    priorResults?: Map<string, ResearchResult>
  ): Promise<string> {
    const parts: string[] = [];

    // Add base context (soul seed, relevant docs)
    if (baseContext) {
      parts.push(this.contextLoader.formatForPrompt(baseContext));
    }

    // Add results from dependent missions
    if (mission.dependsOn && priorResults) {
      const priorFindings: string[] = [];
      for (const depId of mission.dependsOn) {
        const prior = priorResults.get(depId);
        if (prior) {
          priorFindings.push(prior.output);
        }
      }

      if (priorFindings.length > 0) {
        parts.push("\n---\n## Prior Research Findings\n");
        parts.push(priorFindings.join("\n\n---\n\n"));
      }
    }

    // Add mission-specific context
    if (mission.context) {
      parts.push(`\n---\n## Mission Context: ${mission.context}`);
    }

    return parts.join("\n");
  }

  /**
   * Perform the actual research via Gemini
   */
  private async performResearch(
    mission: ResearchMission,
    context: string
  ): Promise<string> {
    const isSynthesis = mission.context?.toLowerCase().includes("synthesis");

    const prompt = isSynthesis
      ? this.buildSynthesisPrompt(mission, context)
      : this.buildGatherPrompt(mission, context);

    return this.gemini.query(prompt);
  }

  /**
   * Build prompt for gathering missions
   */
  private buildGatherPrompt(mission: ResearchMission, context: string): string {
    return `${context}

---

You are Morpheus, a research agent. Gather key information about the following query.
Be specific, cite sources when possible, and focus on factual information.

Query: ${mission.query}

Provide a focused, informative response.`;
  }

  /**
   * Build prompt for synthesis missions
   */
  private buildSynthesisPrompt(mission: ResearchMission, context: string): string {
    return `${context}

---

You are Morpheus, the wise research agent. Your task is to synthesize all the gathered information into a comprehensive, insightful response.

Synthesis Query: ${mission.query}

Instructions:
1. Connect patterns across all prior findings
2. Resolve any contradictions or tensions
3. Provide actionable insights and wisdom
4. Structure your response with clear sections
5. Highlight key takeaways

Provide a thorough, well-organized synthesis.`;
  }

  /**
   * Estimate confidence based on response quality
   */
  private estimateConfidence(output: string): number {
    let confidence = 0.5;

    // Length indicates depth
    if (output.length > 2000) confidence += 0.1;
    if (output.length > 4000) confidence += 0.1;

    // Structure indicates quality
    if (output.includes("##") || output.includes("**")) confidence += 0.1;

    // Sources indicate reliability
    if (output.toLowerCase().includes("source") || output.includes("http")) {
      confidence += 0.1;
    }

    // Hedging language reduces confidence
    const hedges = ["might", "possibly", "unclear", "uncertain"];
    for (const hedge of hedges) {
      if (output.toLowerCase().includes(hedge)) {
        confidence -= 0.05;
      }
    }

    return Math.max(0.1, Math.min(1, confidence));
  }

  /**
   * Handle mission failure with retry logic
   */
  private async handleFailure(
    mission: ResearchMission,
    error: unknown
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Executor] Mission ${mission.id.slice(0, 8)} failed: ${errorMessage}`);

    const missionError: MissionError = {
      code: this.classifyError(errorMessage),
      message: errorMessage,
      recoverable: this.isRecoverable(errorMessage),
    };

    mission.error = missionError;
    mission.retryCount++;

    await this.missionDb.updateMissionStatus(mission.id, "failed", {
      error: missionError,
      retryCount: mission.retryCount,
    });

    // Apply backoff delay before next retry
    if (mission.retryCount < mission.maxRetries && missionError.recoverable) {
      const delay = this.calculateBackoff(mission.retryCount);
      console.error(`[Executor] Will retry in ${delay}ms (attempt ${mission.retryCount + 1}/${mission.maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  /**
   * Classify error type
   */
  private classifyError(message: string): MissionError["code"] {
    const lower = message.toLowerCase();
    if (lower.includes("timeout")) return "timeout";
    if (lower.includes("rate") || lower.includes("429")) return "rate_limit";
    if (lower.includes("api") || lower.includes("500")) return "api_error";
    return "unknown";
  }

  /**
   * Check if error is recoverable
   */
  private isRecoverable(message: string): boolean {
    const lower = message.toLowerCase();
    // Rate limits and timeouts are recoverable
    if (lower.includes("rate") || lower.includes("timeout")) return true;
    // 5xx errors are often transient
    if (lower.includes("500") || lower.includes("503")) return true;
    return false;
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoff(retryCount: number): number {
    const baseDelay = this.config.retryDelayMs;
    const multiplier = this.config.retryBackoffMultiplier;
    const delay = baseDelay * Math.pow(multiplier, retryCount);
    // Add jitter (±20%)
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    return Math.round(delay + jitter);
  }

  /**
   * Cancel a running mission
   */
  cancel(missionId: string): boolean {
    const controller = this.runningMissions.get(missionId);
    if (controller) {
      controller.abort();
      this.runningMissions.delete(missionId);
      return true;
    }
    return false;
  }

  /**
   * Cancel all running missions
   */
  cancelAll(): void {
    for (const [id, controller] of this.runningMissions) {
      controller.abort();
    }
    this.runningMissions.clear();
  }
}
