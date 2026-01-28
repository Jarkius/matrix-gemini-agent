/**
 * Soul Connector
 *
 * Loads Matrix philosophy (Soul Seed) for injection into Gemini prompts.
 * Implements graceful degradation - agent works even without Matrix connection.
 */

export class SoulConnector {
  private matrixPath: string;
  private cachedSoul: string | null = null;
  private lastLoadTime: number = 0;
  private cacheMaxAge: number = 60_000; // 1 minute cache

  constructor(matrixPath?: string) {
    // Resolve ~ to home directory
    this.matrixPath = (matrixPath || "~/workspace/The-matrix").replace(
      /^~/,
      process.env.HOME || ""
    );
  }

  /**
   * Load Soul Seed from Matrix
   * Returns null if Matrix is not available (graceful degradation)
   */
  async load(): Promise<string | null> {
    // Check cache
    const now = Date.now();
    if (this.cachedSoul && now - this.lastLoadTime < this.cacheMaxAge) {
      return this.cachedSoul;
    }

    try {
      const soulPath = `${this.matrixPath}/psi/The_Source/SOUL_SEED.md`;
      const file = Bun.file(soulPath);

      if (await file.exists()) {
        this.cachedSoul = await file.text();
        this.lastLoadTime = now;
        return this.cachedSoul;
      }

      // Try BIBLE.md as fallback (but truncate for token efficiency)
      const biblePath = `${this.matrixPath}/psi/The_Source/BIBLE.md`;
      const bibleFile = Bun.file(biblePath);

      if (await bibleFile.exists()) {
        const bible = await bibleFile.text();
        // Extract essence (first 2000 chars) to avoid token bloat
        this.cachedSoul = this.extractEssence(bible);
        this.lastLoadTime = now;
        return this.cachedSoul;
      }

      console.error("[Soul] Matrix not found at:", this.matrixPath);
      return null;
    } catch (error) {
      console.error("[Soul] Failed to load:", error);
      return null;
    }
  }

  /**
   * Extract essence from BIBLE.md for token-efficient soul injection
   */
  private extractEssence(bible: string): string {
    // Look for key sections
    const sections: string[] = [];

    // Extract Prime Directives
    const directivesMatch = bible.match(/## Prime Directives[\s\S]*?(?=##|$)/);
    if (directivesMatch) {
      sections.push(directivesMatch[0].slice(0, 500));
    }

    // Extract Core Philosophy
    const philosophyMatch = bible.match(/## (Philosophy|Core|Essence)[\s\S]*?(?=##|$)/);
    if (philosophyMatch) {
      sections.push(philosophyMatch[0].slice(0, 500));
    }

    if (sections.length > 0) {
      return `# Matrix Soul (Essence)\n\n${sections.join("\n\n")}`;
    }

    // Fallback: just use first 1500 chars
    return bible.slice(0, 1500);
  }

  /**
   * Inject soul into a prompt
   * Returns original prompt if soul unavailable
   */
  async injectSoul(prompt: string): Promise<string> {
    const soul = await this.load();
    if (!soul) {
      return prompt;
    }
    return `${soul}\n\n---\n\n${prompt}`;
  }

  /**
   * Check if Matrix is connected
   */
  async isConnected(): Promise<boolean> {
    const soul = await this.load();
    return soul !== null;
  }

  /**
   * Get Matrix path
   */
  getMatrixPath(): string {
    return this.matrixPath;
  }

  /**
   * Clear cache (force reload on next load)
   */
  clearCache(): void {
    this.cachedSoul = null;
    this.lastLoadTime = 0;
  }
}
