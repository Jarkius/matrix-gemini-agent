/**
 * Context Loader
 *
 * Loads relevant Matrix documents for research context awareness.
 * Scans psi/memory/, psi/learn/, and psi/specs/ directories.
 */

import type {
  MatrixContext,
  RelevantDocument,
  ContextSource,
  ContextSearchOptions,
  ContextLoaderConfig,
} from "../interfaces/context";
import {
  DEFAULT_CONTEXT_CONFIG,
  SOURCE_DIRECTORIES,
} from "../interfaces/context";
import type { SoulConnector } from "../soul/connector";
import type { ResearchHistory } from "../db/history";

interface CachedDoc {
  path: string;
  content: string;
  title: string;
  loadedAt: number;
}

export class ContextLoader {
  private matrixPath: string;
  private config: ContextLoaderConfig;
  private docCache: Map<string, CachedDoc> = new Map();
  private soul: SoulConnector;
  private history: ResearchHistory;

  constructor(
    soul: SoulConnector,
    history: ResearchHistory,
    config?: Partial<ContextLoaderConfig>
  ) {
    this.config = { ...DEFAULT_CONTEXT_CONFIG, ...config };
    this.matrixPath = this.config.matrixPath.replace(
      /^~/,
      process.env.HOME || ""
    );
    this.soul = soul;
    this.history = history;
  }

  /**
   * Build full context for a research query
   */
  async buildContext(query: string, options?: ContextSearchOptions): Promise<MatrixContext> {
    const soulSeed = await this.soul.load();

    const relevantDocs = await this.loadRelevantDocs(query, {
      maxDocs: options?.maxDocs ?? 5,
      minRelevance: options?.minRelevance ?? 0.3,
      sources: options?.sources ?? this.config.defaultSources,
      maxCharsPerDoc: options?.maxCharsPerDoc ?? 1500,
      query,
    });

    const recentHistory = await this.loadRecentHistory(query, 3);

    return {
      soulSeed,
      relevantDocs,
      recentHistory,
    };
  }

  /**
   * Load relevant documents from Matrix knowledge base
   */
  async loadRelevantDocs(
    query: string,
    options: ContextSearchOptions
  ): Promise<RelevantDocument[]> {
    const docs: RelevantDocument[] = [];
    const sources = options.sources ?? this.config.defaultSources;

    for (const source of sources) {
      const sourceDocs = await this.scanSource(source, query, options);
      docs.push(...sourceDocs);
    }

    // Sort by relevance and limit
    docs.sort((a, b) => b.relevanceScore - a.relevanceScore);

    const limited = docs.slice(0, options.maxDocs ?? 5);

    // Truncate content to stay within token budget
    let totalChars = 0;
    const result: RelevantDocument[] = [];

    for (const doc of limited) {
      if (totalChars + doc.content.length > this.config.maxTotalChars) {
        const remaining = this.config.maxTotalChars - totalChars;
        if (remaining > 200) {
          result.push({
            ...doc,
            content: doc.content.slice(0, remaining) + "\n...(truncated)",
          });
        }
        break;
      }
      result.push(doc);
      totalChars += doc.content.length;
    }

    return result;
  }

  /**
   * Scan a single source directory for relevant docs
   */
  private async scanSource(
    source: ContextSource,
    query: string,
    options: ContextSearchOptions
  ): Promise<RelevantDocument[]> {
    const dirPath = `${this.matrixPath}/${SOURCE_DIRECTORIES[source]}`;
    const docs: RelevantDocument[] = [];

    try {
      const files = await this.listMarkdownFiles(dirPath);

      for (const filePath of files) {
        const cached = this.getFromCache(filePath);
        let content: string;
        let title: string;

        if (cached) {
          content = cached.content;
          title = cached.title;
        } else {
          const file = Bun.file(filePath);
          if (!(await file.exists())) continue;

          content = await file.text();
          title = this.extractTitle(content, filePath);
          this.addToCache(filePath, content, title);
        }

        const relevanceScore = this.calculateRelevance(query, content, title);

        if (relevanceScore >= (options.minRelevance ?? 0.3)) {
          docs.push({
            path: filePath,
            title,
            content: content.slice(0, options.maxCharsPerDoc ?? 1500),
            relevanceScore,
            source,
          });
        }
      }
    } catch (error) {
      // Graceful degradation - directory may not exist
      console.error(`[Context] Failed to scan ${source}:`, error);
    }

    return docs;
  }

  /**
   * List markdown files in a directory (recursive)
   */
  private async listMarkdownFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const result = await Bun.$`find ${dirPath} -name "*.md" -type f 2>/dev/null`.quiet();
      const output = result.stdout.toString().trim();
      if (output) {
        files.push(...output.split("\n").filter(Boolean));
      }
    } catch {
      // Directory doesn't exist or not accessible
    }

    return files;
  }

  /**
   * Extract title from markdown content or filename
   */
  private extractTitle(content: string, filePath: string): string {
    // Try to get first heading
    const headingMatch = content.match(/^#\s+(.+)$/m);
    if (headingMatch && headingMatch[1]) {
      return headingMatch[1].trim();
    }

    // Fall back to filename
    const filename = filePath.split("/").pop() || "";
    return filename.replace(/\.md$/, "").replace(/[-_]/g, " ");
  }

  /**
   * Calculate relevance score using keyword matching
   * Simple TF-IDF-like scoring
   */
  private calculateRelevance(query: string, content: string, title: string): number {
    const queryTerms = this.tokenize(query.toLowerCase());
    const contentLower = content.toLowerCase();
    const titleLower = title.toLowerCase();

    if (queryTerms.length === 0) return 0;

    let score = 0;
    let matchedTerms = 0;

    for (const term of queryTerms) {
      // Title match (higher weight)
      if (titleLower.includes(term)) {
        score += 0.4;
        matchedTerms++;
      }

      // Content match
      const contentMatches = (contentLower.match(new RegExp(term, "g")) || []).length;
      if (contentMatches > 0) {
        // Log scale for frequency
        score += Math.min(0.3, 0.1 * Math.log2(contentMatches + 1));
        matchedTerms++;
      }
    }

    // Normalize by number of query terms
    const termCoverage = matchedTerms / (queryTerms.length * 2); // *2 because we check title and content
    score = (score + termCoverage) / 2;

    return Math.min(1, score);
  }

  /**
   * Tokenize text into searchable terms
   */
  private tokenize(text: string): string[] {
    return text
      .split(/\W+/)
      .filter((word) => word.length > 2)
      .filter((word) => !STOP_WORDS.has(word));
  }

  /**
   * Load recent relevant research history
   */
  private async loadRecentHistory(
    query: string,
    limit: number
  ): Promise<MatrixContext["recentHistory"]> {
    try {
      const results = await this.history.search(query, limit);
      return results.map((r) => ({
        id: r.id,
        query: r.query,
        summary: r.result.slice(0, 300) + (r.result.length > 300 ? "..." : ""),
        createdAt: r.createdAt,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Format context for injection into prompts
   */
  formatForPrompt(context: MatrixContext): string {
    const parts: string[] = [];

    // Soul seed first
    if (context.soulSeed) {
      parts.push(context.soulSeed);
    }

    // Relevant documents
    if (context.relevantDocs.length > 0) {
      parts.push("\n---\n## Relevant Matrix Knowledge\n");
      for (const doc of context.relevantDocs) {
        parts.push(`### ${doc.title} (${doc.source})`);
        parts.push(doc.content);
        parts.push("");
      }
    }

    // Recent research history
    if (context.recentHistory.length > 0) {
      parts.push("\n---\n## Recent Related Research\n");
      for (const entry of context.recentHistory) {
        parts.push(`- **${entry.query}**: ${entry.summary}`);
      }
    }

    return parts.join("\n");
  }

  // Cache management

  private getFromCache(path: string): CachedDoc | null {
    const cached = this.docCache.get(path);
    if (!cached) return null;

    // Check if expired
    if (Date.now() - cached.loadedAt > this.config.cacheMaxAge) {
      this.docCache.delete(path);
      return null;
    }

    return cached;
  }

  private addToCache(path: string, content: string, title: string): void {
    this.docCache.set(path, {
      path,
      content,
      title,
      loadedAt: Date.now(),
    });

    // Prune cache if too large
    if (this.docCache.size > 100) {
      const oldest = Array.from(this.docCache.entries())
        .sort((a, b) => a[1].loadedAt - b[1].loadedAt)
        .slice(0, 20);
      for (const [key] of oldest) {
        this.docCache.delete(key);
      }
    }
  }

  clearCache(): void {
    this.docCache.clear();
  }
}

// Common stop words to filter from queries
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
  "be", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "must", "shall", "can", "need",
  "this", "that", "these", "those", "it", "its", "what", "which",
  "who", "whom", "how", "when", "where", "why", "all", "each", "every",
  "both", "few", "more", "most", "other", "some", "such", "no", "not",
  "only", "same", "so", "than", "too", "very", "just", "also",
]);
