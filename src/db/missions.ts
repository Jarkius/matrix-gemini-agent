/**
 * Mission Persistence Database
 *
 * Stores research missions, raw findings, and synthesized insights.
 * Follows SQLite-first pattern for reliability.
 */

import { Database } from "bun:sqlite";
import type {
  ResearchMission,
  MissionStatus,
  ResearchResult,
  MissionError,
  Priority,
  ResearchDepth,
  PRIORITY_WEIGHTS,
} from "../interfaces/mission";

export interface RawFinding {
  id: number;
  missionId: string;
  content: string;
  createdAt: string;
}

export interface SynthesizedInsight {
  id: number;
  sourceIds: string[]; // Mission IDs
  content: string;
  category?: string;
  confidence: "low" | "medium" | "high" | "proven";
  timesValidated: number;
  createdAt: string;
  updatedAt: string;
}

export interface LearningExport {
  topic: string;
  what: string;
  why: string;
  how: string;
  useCases: string;
  sources: string[];
  confidence: string;
  date: string;
}

export class MissionDatabase {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || `${import.meta.dir}/../../data/missions.db`;
  }

  async init(): Promise<void> {
    const dir = this.dbPath.replace(/\/[^/]+$/, "");
    await Bun.$`mkdir -p ${dir}`.quiet();

    this.db = new Database(this.dbPath);

    // Research missions table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS research_missions (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        depth TEXT NOT NULL DEFAULT 'standard',
        priority TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'pending',
        depends_on TEXT,
        context TEXT,
        result TEXT,
        error TEXT,
        agent_id INTEGER,
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        timeout_ms INTEGER DEFAULT 60000,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        started_at TEXT,
        completed_at TEXT
      )
    `);

    // Raw findings table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS raw_findings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mission_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (mission_id) REFERENCES research_missions(id)
      )
    `);

    // Synthesized insights table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS synthesized_insights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_ids TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT,
        confidence TEXT DEFAULT 'low',
        times_validated INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // FTS5 for insight search
    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS insights_fts USING fts5(
        content,
        content='synthesized_insights',
        content_rowid='id'
      )
    `);

    // Trigger to keep FTS in sync
    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS insights_ai AFTER INSERT ON synthesized_insights BEGIN
        INSERT INTO insights_fts(rowid, content) VALUES (new.id, new.content);
      END
    `);

    // Indexes for common queries
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_missions_status ON research_missions(status)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_missions_priority ON research_missions(priority)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_findings_mission ON raw_findings(mission_id)`);

    console.error(`[Missions] Database initialized at: ${this.dbPath}`);
  }

  // Mission CRUD operations

  async saveMission(mission: ResearchMission): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO research_missions (
        id, query, depth, priority, status, depends_on, context,
        result, error, agent_id, retry_count, max_retries, timeout_ms,
        created_at, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      mission.id,
      mission.query,
      mission.depth,
      mission.priority,
      mission.status,
      mission.dependsOn ? JSON.stringify(mission.dependsOn) : null,
      mission.context || null,
      mission.result ? JSON.stringify(mission.result) : null,
      mission.error ? JSON.stringify(mission.error) : null,
      mission.agentId || null,
      mission.retryCount,
      mission.maxRetries,
      mission.timeoutMs,
      mission.createdAt.toISOString(),
      mission.startedAt?.toISOString() || null,
      mission.completedAt?.toISOString() || null
    );
  }

  async getMission(id: string): Promise<ResearchMission | null> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(`SELECT * FROM research_missions WHERE id = ?`);
    const row = stmt.get(id) as Record<string, unknown> | null;

    return row ? this.rowToMission(row) : null;
  }

  async updateMissionStatus(
    id: string,
    status: MissionStatus,
    updates?: Partial<{
      result: ResearchResult;
      error: MissionError;
      agentId: number;
      startedAt: Date;
      completedAt: Date;
      retryCount: number;
    }>
  ): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const fields = ["status = ?"];
    const values: (string | number | null)[] = [status];

    if (updates?.result) {
      fields.push("result = ?");
      values.push(JSON.stringify(updates.result));
    }
    if (updates?.error) {
      fields.push("error = ?");
      values.push(JSON.stringify(updates.error));
    }
    if (updates?.agentId !== undefined) {
      fields.push("agent_id = ?");
      values.push(updates.agentId);
    }
    if (updates?.startedAt) {
      fields.push("started_at = ?");
      values.push(updates.startedAt.toISOString());
    }
    if (updates?.completedAt) {
      fields.push("completed_at = ?");
      values.push(updates.completedAt.toISOString());
    }
    if (updates?.retryCount !== undefined) {
      fields.push("retry_count = ?");
      values.push(updates.retryCount);
    }

    values.push(id);
    const stmt = this.db.prepare(
      `UPDATE research_missions SET ${fields.join(", ")} WHERE id = ?`
    );
    stmt.run(...values);
  }

  async getPendingMissions(): Promise<ResearchMission[]> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(`
      SELECT * FROM research_missions
      WHERE status IN ('pending', 'queued', 'blocked')
      ORDER BY
        CASE priority
          WHEN 'critical' THEN 4
          WHEN 'high' THEN 3
          WHEN 'normal' THEN 2
          WHEN 'low' THEN 1
        END DESC,
        created_at ASC
    `);

    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((row) => this.rowToMission(row));
  }

  async getReadyMissions(): Promise<ResearchMission[]> {
    const pending = await this.getPendingMissions();
    const completedIds = new Set(
      (await this.getCompletedMissionIds())
    );

    return pending.filter((m) => {
      if (m.status === "blocked") return false;
      if (!m.dependsOn?.length) return true;
      return m.dependsOn.every((depId) => completedIds.has(depId));
    });
  }

  private async getCompletedMissionIds(): Promise<string[]> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(`SELECT id FROM research_missions WHERE status = 'completed'`);
    const rows = stmt.all() as { id: string }[];
    return rows.map((r) => r.id);
  }

  // Raw findings operations

  async saveRawFinding(missionId: string, content: string): Promise<number> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(`
      INSERT INTO raw_findings (mission_id, content) VALUES (?, ?)
    `);
    const info = stmt.run(missionId, content);
    return Number(info.lastInsertRowid);
  }

  async getRawFindings(missionId: string): Promise<RawFinding[]> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(`
      SELECT id, mission_id as missionId, content, created_at as createdAt
      FROM raw_findings WHERE mission_id = ?
    `);
    return stmt.all(missionId) as RawFinding[];
  }

  // Synthesized insights operations

  async saveInsight(
    sourceIds: string[],
    content: string,
    category?: string
  ): Promise<number> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(`
      INSERT INTO synthesized_insights (source_ids, content, category)
      VALUES (?, ?, ?)
    `);
    const info = stmt.run(JSON.stringify(sourceIds), content, category || null);
    return Number(info.lastInsertRowid);
  }

  async searchInsights(query: string, limit = 10): Promise<SynthesizedInsight[]> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(`
      SELECT s.id, s.source_ids, s.content, s.category, s.confidence,
             s.times_validated, s.created_at, s.updated_at
      FROM synthesized_insights s
      JOIN insights_fts f ON s.id = f.rowid
      WHERE insights_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);

    const rows = stmt.all(query, limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as number,
      sourceIds: JSON.parse(row.source_ids as string),
      content: row.content as string,
      category: row.category as string | undefined,
      confidence: row.confidence as SynthesizedInsight["confidence"],
      timesValidated: row.times_validated as number,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  async validateInsight(id: number): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    this.db.run(`
      UPDATE synthesized_insights
      SET times_validated = times_validated + 1,
          confidence = CASE
            WHEN times_validated >= 20 THEN 'proven'
            WHEN times_validated >= 5 THEN 'high'
            WHEN times_validated >= 2 THEN 'medium'
            ELSE confidence
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [id]);
  }

  // Learning export

  async getInsightsForExport(since?: string): Promise<SynthesizedInsight[]> {
    if (!this.db) throw new Error("Database not initialized");

    let query = `
      SELECT id, source_ids, content, category, confidence,
             times_validated, created_at, updated_at
      FROM synthesized_insights
    `;

    if (since) {
      query += ` WHERE created_at > ?`;
    }
    query += ` ORDER BY created_at`;

    const stmt = this.db.prepare(query);
    const rows = (since ? stmt.all(since) : stmt.all()) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as number,
      sourceIds: JSON.parse(row.source_ids as string),
      content: row.content as string,
      category: row.category as string | undefined,
      confidence: row.confidence as SynthesizedInsight["confidence"],
      timesValidated: row.times_validated as number,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  // Stats

  async getStats(): Promise<{
    totalMissions: number;
    byStatus: Record<MissionStatus, number>;
    totalInsights: number;
    byConfidence: Record<string, number>;
  }> {
    if (!this.db) throw new Error("Database not initialized");

    const missionStats = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM research_missions GROUP BY status
    `).all() as { status: MissionStatus; count: number }[];

    const insightStats = this.db.prepare(`
      SELECT confidence, COUNT(*) as count FROM synthesized_insights GROUP BY confidence
    `).all() as { confidence: string; count: number }[];

    const totalMissions = this.db.prepare(`SELECT COUNT(*) as count FROM research_missions`).get() as { count: number };
    const totalInsights = this.db.prepare(`SELECT COUNT(*) as count FROM synthesized_insights`).get() as { count: number };

    const byStatus: Record<string, number> = {};
    for (const { status, count } of missionStats) {
      byStatus[status] = count;
    }

    const byConfidence: Record<string, number> = {};
    for (const { confidence, count } of insightStats) {
      byConfidence[confidence] = count;
    }

    return {
      totalMissions: totalMissions.count,
      byStatus: byStatus as Record<MissionStatus, number>,
      totalInsights: totalInsights.count,
      byConfidence,
    };
  }

  // Helper to convert DB row to mission object
  private rowToMission(row: Record<string, unknown>): ResearchMission {
    return {
      id: row.id as string,
      query: row.query as string,
      depth: row.depth as ResearchDepth,
      priority: row.priority as Priority,
      status: row.status as MissionStatus,
      dependsOn: row.depends_on ? JSON.parse(row.depends_on as string) : undefined,
      context: row.context as string | undefined,
      result: row.result ? JSON.parse(row.result as string) : undefined,
      error: row.error ? JSON.parse(row.error as string) : undefined,
      agentId: row.agent_id as number | undefined,
      retryCount: row.retry_count as number,
      maxRetries: row.max_retries as number,
      timeoutMs: row.timeout_ms as number,
      createdAt: new Date(row.created_at as string),
      startedAt: row.started_at ? new Date(row.started_at as string) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at as string) : undefined,
    };
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
