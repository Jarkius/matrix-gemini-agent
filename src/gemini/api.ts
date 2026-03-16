/**
 * Gemini API Client
 *
 * Wraps Google's Generative AI SDK for Matrix integration.
 */

import { GoogleGenAI } from "@google/genai";

// Default to Gemini 3 Flash (gemini-2.0-flash retired March 2026)
const DEFAULT_MODEL = "gemini-3-flash";

export class GeminiClient {
  private client: GoogleGenAI | null = null;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.model = model || process.env.GEMINI_MODEL || DEFAULT_MODEL;
    if (apiKey) {
      this.client = new GoogleGenAI({ apiKey });
    }
    console.error(`[Gemini] Using model: ${this.model}`);
  }

  /**
   * Check if client is initialized
   */
  isAvailable(): boolean {
    return this.client !== null;
  }

  /**
   * Perform deep research on a topic
   */
  async research(topic: string, depth: string, soulSeed?: string): Promise<string> {
    if (!this.client) {
      return this.mockResearch(topic, depth);
    }

    const depthInstructions = {
      quick: "Provide a brief, focused answer in 2-3 paragraphs.",
      standard: "Provide a comprehensive answer with key points and examples.",
      deep: "Provide an in-depth analysis covering multiple perspectives, evidence, and implications.",
    };

    const systemPrompt = soulSeed
      ? `${soulSeed}\n\nYou are Morpheus, the research agent of The Matrix. ${depthInstructions[depth as keyof typeof depthInstructions] || depthInstructions.standard}`
      : `You are a research assistant. ${depthInstructions[depth as keyof typeof depthInstructions] || depthInstructions.standard}`;

    const result = await this.client.models.generateContent({
      model: this.model,
      contents: `${systemPrompt}\n\nResearch topic: ${topic}`,
    });

    return result.text || "";
  }

  /**
   * Summarize content
   */
  async summarize(content: string, style: string, soulSeed?: string): Promise<string> {
    if (!this.client) {
      return this.mockSummarize(content, style);
    }

    const styleInstructions = {
      brief: "Summarize in 2-3 sentences.",
      detailed: "Provide a detailed summary with main points and supporting details.",
      "bullet-points": "Summarize as a bulleted list of key points.",
    };

    const systemPrompt = soulSeed
      ? `${soulSeed}\n\nYou are Morpheus. ${styleInstructions[style as keyof typeof styleInstructions] || styleInstructions.detailed}`
      : styleInstructions[style as keyof typeof styleInstructions] || styleInstructions.detailed;

    // Check if content is a URL
    const isUrl = content.startsWith("http://") || content.startsWith("https://");
    const contentPrompt = isUrl
      ? `Fetch and summarize this URL: ${content}`
      : `Summarize this content:\n\n${content}`;

    const result = await this.client.models.generateContent({
      model: this.model,
      contents: `${systemPrompt}\n\n${contentPrompt}`,
    });

    return result.text || "";
  }

  /**
   * Compare multiple sources
   */
  async compare(sources: string[], aspect?: string, soulSeed?: string): Promise<string> {
    if (!this.client) {
      return this.mockCompare(sources, aspect);
    }

    const aspectInstruction = aspect
      ? `Focus on comparing: ${aspect}`
      : "Compare across all relevant dimensions";

    const systemPrompt = soulSeed
      ? `${soulSeed}\n\nYou are Morpheus. Compare these sources objectively. ${aspectInstruction}`
      : `Compare these sources objectively. ${aspectInstruction}`;

    const sourcesText = sources
      .map((s, i) => `Source ${i + 1}: ${s}`)
      .join("\n\n");

    const result = await this.client.models.generateContent({
      model: this.model,
      contents: `${systemPrompt}\n\n${sourcesText}`,
    });

    return result.text || "";
  }

  /**
   * Raw query to Gemini
   */
  async query(prompt: string, soulSeed?: string): Promise<string> {
    if (!this.client) {
      return `[Mock Response] Gemini API not configured. Query: ${prompt.slice(0, 100)}...`;
    }

    const fullPrompt = soulSeed ? `${soulSeed}\n\n${prompt}` : prompt;

    const result = await this.client.models.generateContent({
      model: this.model,
      contents: fullPrompt,
    });

    return result.text || "";
  }

  // Mock responses for when API is not configured
  private mockResearch(topic: string, depth: string): string {
    return `[Mock Research - API Key Required]

Topic: ${topic}
Depth: ${depth}

To enable real Gemini research:
1. Set GEMINI_API_KEY environment variable
2. Restart the MCP server

This mock response demonstrates the research structure:
- Overview of topic
- Key findings
- Sources and references
- Recommendations`;
  }

  private mockSummarize(content: string, style: string): string {
    return `[Mock Summary - API Key Required]

Content: ${content.slice(0, 100)}...
Style: ${style}

To enable real summaries, set GEMINI_API_KEY.`;
  }

  private mockCompare(sources: string[], aspect?: string): string {
    return `[Mock Comparison - API Key Required]

Sources: ${sources.length}
Aspect: ${aspect || "general"}

To enable real comparison, set GEMINI_API_KEY.`;
  }
}
