/**
 * Research History Database
 *
 * Tracks all research sessions for later retrieval and learning.
 * Uses bun:sqlite for lightweight, fast storage.
 */

import { Database } from "bun:sqlite";

export interface ResearchEntry {
  id: number;
  type: "research" | "youtube" | "summarize" | "compare";
  query: string;
  result: string;
  createdAt: string;
}

export class ResearchHistory {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || `${import.meta.dir}/../../data/history.db`;
  }

  /**
   * Initialize database
   */
  async init(): Promise<void> {
    // Ensure directory exists
    const dir = this.dbPath.replace(/\/[^/]+$/, "");
    await Bun.$`mkdir -p ${dir}`.quiet();

    this.db = new Database(this.dbPath);

    // Create tables
    this.db.run(`
      CREATE TABLE IF NOT EXISTS research_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        query TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create FTS5 index for search
    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS research_fts USING fts5(
        query,
        result,
        content='research_history',
        content_rowid='id'
      )
    `);

    // Triggers to keep FTS in sync
    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS research_ai AFTER INSERT ON research_history BEGIN
        INSERT INTO research_fts(rowid, query, result) VALUES (new.id, new.query, new.result);
      END
    `);

    console.error(`[History] Database initialized at: ${this.dbPath}`);
  }

  /**
   * Save a research entry
   */
  async save(type: ResearchEntry["type"], query: string, result: string): Promise<number> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    const stmt = this.db.prepare(`
      INSERT INTO research_history (type, query, result)
      VALUES (?, ?, ?)
    `);

    const info = stmt.run(type, query, result);
    return Number(info.lastInsertRowid);
  }

  /**
   * Search history
   */
  async search(query?: string, limit: number = 10): Promise<ResearchEntry[]> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    if (query) {
      // Full-text search
      const stmt = this.db.prepare(`
        SELECT h.id, h.type, h.query, h.result, h.created_at as createdAt
        FROM research_history h
        JOIN research_fts f ON h.id = f.rowid
        WHERE research_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `);

      return stmt.all(query, limit) as ResearchEntry[];
    } else {
      // Recent entries
      const stmt = this.db.prepare(`
        SELECT id, type, query, result, created_at as createdAt
        FROM research_history
        ORDER BY created_at DESC
        LIMIT ?
      `);

      return stmt.all(limit) as ResearchEntry[];
    }
  }

  /**
   * Get entry by ID
   */
  async get(id: number): Promise<ResearchEntry | null> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    const stmt = this.db.prepare(`
      SELECT id, type, query, result, created_at as createdAt
      FROM research_history
      WHERE id = ?
    `);

    return stmt.get(id) as ResearchEntry | null;
  }

  /**
   * Get statistics
   */
  async stats(): Promise<{ total: number; byType: Record<string, number> }> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    const totalStmt = this.db.prepare(`SELECT COUNT(*) as count FROM research_history`);
    const total = (totalStmt.get() as { count: number }).count;

    const byTypeStmt = this.db.prepare(`
      SELECT type, COUNT(*) as count
      FROM research_history
      GROUP BY type
    `);

    const byType: Record<string, number> = {};
    for (const row of byTypeStmt.all() as { type: string; count: number }[]) {
      byType[row.type] = row.count;
    }

    return { total, byType };
  }

  /**
   * Export to Matrix learnings (sync)
   */
  async exportToMatrix(matrixPath: string, since?: string): Promise<number> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    const learningsDir = `${matrixPath}/psi/memory/learnings`;
    await Bun.$`mkdir -p ${learningsDir}`.quiet();

    let query = `
      SELECT id, type, query, result, created_at as createdAt
      FROM research_history
    `;

    if (since) {
      query += ` WHERE created_at > ?`;
    }

    query += ` ORDER BY created_at`;

    const stmt = this.db.prepare(query);
    const entries = (since ? stmt.all(since) : stmt.all()) as ResearchEntry[];

    let exported = 0;
    for (const entry of entries) {
      const date = new Date(entry.createdAt);
      const filename = `${date.toISOString().slice(0, 10)}_gemini-${entry.type}-${entry.id}.md`;
      const path = `${learningsDir}/${filename}`;

      const content = `# Gemini Research: ${entry.query.slice(0, 100)}

**Type**: ${entry.type}
**Date**: ${entry.createdAt}
**Source**: Matrix Gemini Agent

---

${entry.result}

---
*Auto-exported from Gemini Research History*
`;

      await Bun.write(path, content);
      exported++;
    }

    return exported;
  }

  /**
   * Close database
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
