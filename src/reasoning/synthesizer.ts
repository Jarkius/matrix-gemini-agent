/**
 * Result Synthesizer
 *
 * Combines results from multiple missions and harvests learnings.
 * Exports learnings to Matrix in human-readable format.
 */

import type { GeminiClient } from "../gemini/api";
import type { MissionDatabase, SynthesizedInsight } from "../db/missions";
import type { ResearchMission, ResearchResult, MissionPlan } from "../interfaces/mission";

export interface SynthesisResult {
  output: string;
  totalDurationMs: number;
  missionsCompleted: number;
  missionsFailed: number;
  confidence: number;
}

export interface HarvestedLearning {
  topic: string;
  what: string;
  why: string;
  how: string;
  useCases: string;
  confidence: "low" | "medium" | "high";
}

export class ResultSynthesizer {
  private gemini: GeminiClient;
  private missionDb: MissionDatabase;
  private matrixPath: string;

  constructor(gemini: GeminiClient, missionDb: MissionDatabase, matrixPath?: string) {
    this.gemini = gemini;
    this.missionDb = missionDb;
    this.matrixPath = (matrixPath || "~/workspace/The-matrix").replace(
      /^~/,
      process.env.HOME || ""
    );
  }

  /**
   * Synthesize results from a completed mission plan
   */
  async synthesize(
    plan: MissionPlan,
    results: Map<string, ResearchResult>
  ): Promise<SynthesisResult> {
    const completedMissions = plan.missions.filter(
      (m) => m.status === "completed" && results.has(m.id)
    );
    const failedMissions = plan.missions.filter((m) => m.status === "failed");

    // Get the synthesis result (last mission)
    const synthesisMission = plan.missions[plan.missions.length - 1];
    const synthesisResult = synthesisMission ? results.get(synthesisMission.id) : undefined;

    let output: string;
    let confidence: number;

    if (synthesisResult) {
      output = synthesisResult.output;
      confidence = synthesisResult.confidence;
    } else {
      // Fallback: combine all results manually
      output = this.manualSynthesize(plan.originalQuery, completedMissions, results);
      confidence = 0.5;
    }

    // Calculate totals
    const totalDurationMs = Array.from(results.values()).reduce(
      (sum, r) => sum + r.durationMs,
      0
    );

    return {
      output,
      totalDurationMs,
      missionsCompleted: completedMissions.length,
      missionsFailed: failedMissions.length,
      confidence,
    };
  }

  /**
   * Manual synthesis fallback when synthesis mission fails
   */
  private manualSynthesize(
    originalQuery: string,
    missions: ResearchMission[],
    results: Map<string, ResearchResult>
  ): string {
    const parts: string[] = [
      `# Research: ${originalQuery}`,
      "",
      "## Findings",
      "",
    ];

    for (const mission of missions) {
      const result = results.get(mission.id);
      if (result) {
        parts.push(`### ${mission.query}`);
        parts.push(result.output);
        parts.push("");
      }
    }

    parts.push("---");
    parts.push("*Note: Automatic synthesis was not available. Results combined manually.*");

    return parts.join("\n");
  }

  /**
   * Harvest learnings from synthesis result
   */
  async harvestLearnings(
    plan: MissionPlan,
    synthesisResult: SynthesisResult
  ): Promise<HarvestedLearning[]> {
    // Use Gemini to extract structured learnings
    const prompt = `Analyze this research output and extract key learnings.

Original Query: "${plan.originalQuery}"

Research Output:
${synthesisResult.output}

Extract 1-3 key learnings in this JSON format:
{
  "learnings": [
    {
      "topic": "Short topic name (3-5 words)",
      "what": "Brief definition or concept explanation (1-2 sentences)",
      "why": "Why this matters, benefits (1-2 sentences)",
      "how": "How to apply or implement (2-3 sentences)",
      "useCases": "Real examples or applications (1-2 sentences)",
      "confidence": "low" | "medium" | "high"
    }
  ]
}

Rules:
1. Focus on actionable, practical insights
2. Each learning should be self-contained
3. Use clear, concise language
4. Return ONLY valid JSON`;

    try {
      const response = await this.gemini.query(prompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        console.error("[Synthesizer] Failed to extract learnings JSON");
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]) as { learnings: HarvestedLearning[] };
      return parsed.learnings || [];
    } catch (error) {
      console.error("[Synthesizer] Learning extraction failed:", error);
      return [];
    }
  }

  /**
   * Save learnings to database and export to Matrix
   */
  async saveLearnings(
    learnings: HarvestedLearning[],
    sourceIds: string[]
  ): Promise<void> {
    for (const learning of learnings) {
      // Save to database
      await this.missionDb.saveInsight(
        sourceIds,
        `${learning.topic}: ${learning.what}`,
        this.detectCategory(learning.topic)
      );

      // Export to Matrix file
      await this.exportToMatrix(learning);
    }
  }

  /**
   * Export a single learning to Matrix as markdown file
   */
  async exportToMatrix(learning: HarvestedLearning): Promise<string> {
    const learningsDir = `${this.matrixPath}/psi/memory/learnings`;
    await Bun.$`mkdir -p ${learningsDir}`.quiet();

    const date = new Date().toISOString().slice(0, 10);
    const slug = learning.topic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const filename = `${date}_${slug}.md`;
    const filepath = `${learningsDir}/${filename}`;

    const content = `# Learning: ${learning.topic}

**Date**: ${date}
**Source**: Gemini Deep Research
**Confidence**: ${learning.confidence}

## What
${learning.what}

## Why
${learning.why}

## How
${learning.how}

## Use Cases
${learning.useCases}

---
*Auto-generated by Matrix Gemini Agent*
`;

    await Bun.write(filepath, content);
    console.error(`[Synthesizer] Exported learning to: ${filename}`);

    return filepath;
  }

  /**
   * Detect category from topic
   */
  private detectCategory(topic: string): string {
    const lower = topic.toLowerCase();

    const categories: Record<string, string[]> = {
      architecture: ["architecture", "design", "pattern", "structure", "system"],
      performance: ["performance", "speed", "optimization", "cache", "fast"],
      security: ["security", "auth", "encrypt", "protect", "safe"],
      testing: ["test", "spec", "coverage", "assertion", "mock"],
      tooling: ["tool", "cli", "build", "deploy", "ci/cd"],
      debugging: ["debug", "error", "fix", "issue", "bug"],
      philosophy: ["philosophy", "principle", "wisdom", "insight", "pattern"],
    };

    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some((kw) => lower.includes(kw))) {
        return category;
      }
    }

    return "general";
  }

  /**
   * Format final output for MCP tool response
   */
  formatOutput(result: SynthesisResult, learnings: HarvestedLearning[]): string {
    const parts: string[] = [
      result.output,
      "",
      "---",
      "",
      "## Research Metadata",
      `- **Missions completed**: ${result.missionsCompleted}`,
      `- **Missions failed**: ${result.missionsFailed}`,
      `- **Total duration**: ${Math.round(result.totalDurationMs / 1000)}s`,
      `- **Confidence**: ${Math.round(result.confidence * 100)}%`,
    ];

    if (learnings.length > 0) {
      parts.push("");
      parts.push("## Harvested Learnings");
      for (const learning of learnings) {
        parts.push(`- **${learning.topic}**: ${learning.what}`);
      }
    }

    return parts.join("\n");
  }

  /**
   * Export all insights since a date to Matrix
   */
  async exportAllToMatrix(since?: string): Promise<number> {
    const insights = await this.missionDb.getInsightsForExport(since);
    let exported = 0;

    for (const insight of insights) {
      // Create a learning from the insight
      const topicPart = insight.content.split(":")[0];
      const learning: HarvestedLearning = {
        topic: topicPart?.trim() || "Untitled",
        what: insight.content,
        why: "Extracted from research synthesis",
        how: "See full research in history",
        useCases: insight.category || "general",
        confidence: insight.confidence as HarvestedLearning["confidence"],
      };

      await this.exportToMatrix(learning);
      exported++;
    }

    return exported;
  }
}
