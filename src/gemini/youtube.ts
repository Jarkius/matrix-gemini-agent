/**
 * YouTube Analyzer
 *
 * Transcribes and analyzes YouTube videos using yt-dlp and Gemini.
 */

import { GeminiClient } from "./api";

export interface VideoMetadata {
  id: string;
  title: string;
  channel: string;
  duration: number;
  description: string;
  uploadDate: string;
}

export interface VideoAnalysis {
  metadata: VideoMetadata;
  transcript?: string;
  summary: string;
  keyPoints: string[];
  timestamps?: { time: string; topic: string }[];
}

export class YouTubeAnalyzer {
  constructor(private gemini: GeminiClient) {}

  /**
   * Extract video ID from YouTube URL
   */
  private extractVideoId(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /youtube\.com\/shorts\/([^&\n?#]+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) return match[1];
    }
    return null;
  }

  /**
   * Fetch video metadata using yt-dlp
   */
  private async fetchMetadata(url: string): Promise<VideoMetadata | null> {
    try {
      const proc = Bun.spawn(["yt-dlp", "--dump-json", "--no-download", url], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const output = await new Response(proc.stdout).text();
      const data = JSON.parse(output);

      return {
        id: data.id,
        title: data.title,
        channel: data.channel || data.uploader,
        duration: data.duration,
        description: data.description?.slice(0, 500) || "",
        uploadDate: data.upload_date,
      };
    } catch (error) {
      console.error("[YouTube] Failed to fetch metadata:", error);
      return null;
    }
  }

  /**
   * Fetch captions using yt-dlp
   */
  private async fetchCaptions(url: string): Promise<string | null> {
    try {
      // Try auto-generated captions first
      const proc = Bun.spawn(
        [
          "yt-dlp",
          "--write-auto-sub",
          "--sub-lang",
          "en",
          "--skip-download",
          "--sub-format",
          "vtt",
          "-o",
          "/tmp/%(id)s",
          url,
        ],
        {
          stdout: "pipe",
          stderr: "pipe",
        }
      );

      await proc.exited;

      // Read the VTT file
      const videoId = this.extractVideoId(url);
      if (!videoId) return null;

      const vttPath = `/tmp/${videoId}.en.vtt`;
      const file = Bun.file(vttPath);

      if (await file.exists()) {
        const vtt = await file.text();
        // Parse VTT to plain text
        return this.parseVTT(vtt);
      }

      return null;
    } catch (error) {
      console.error("[YouTube] Failed to fetch captions:", error);
      return null;
    }
  }

  /**
   * Parse VTT subtitle format to plain text
   */
  private parseVTT(vtt: string): string {
    const lines = vtt.split("\n");
    const textLines: string[] = [];
    let lastText = "";

    for (const line of lines) {
      // Skip timestamps and metadata
      if (
        line.startsWith("WEBVTT") ||
        line.includes("-->") ||
        line.match(/^\d{2}:\d{2}/) ||
        line.trim() === ""
      ) {
        continue;
      }

      // Remove HTML tags and timestamps
      const cleanLine = line
        .replace(/<[^>]+>/g, "")
        .replace(/\[.*?\]/g, "")
        .trim();

      // Avoid duplicates (common in auto-captions)
      if (cleanLine && cleanLine !== lastText) {
        textLines.push(cleanLine);
        lastText = cleanLine;
      }
    }

    return textLines.join(" ");
  }

  /**
   * Analyze a YouTube video
   */
  async analyze(url: string, focus?: string, soulSeed?: string): Promise<string> {
    const videoId = this.extractVideoId(url);
    if (!videoId) {
      return `Error: Invalid YouTube URL: ${url}`;
    }

    // Fetch metadata
    const metadata = await this.fetchMetadata(url);
    if (!metadata) {
      return `Error: Could not fetch video metadata for: ${url}`;
    }

    // Try to get captions
    const transcript = await this.fetchCaptions(url);

    // Build analysis prompt
    let prompt = `Analyze this YouTube video:

**Title**: ${metadata.title}
**Channel**: ${metadata.channel}
**Duration**: ${Math.floor(metadata.duration / 60)}:${(metadata.duration % 60).toString().padStart(2, "0")}
**Description**: ${metadata.description}
`;

    if (transcript) {
      prompt += `\n**Transcript**:\n${transcript.slice(0, 50000)}\n`;
    } else {
      prompt += `\n(No transcript available - analyzing based on metadata only)\n`;
    }

    if (focus) {
      prompt += `\n**Focus Area**: ${focus}\n`;
    }

    prompt += `
Please provide:
1. **Summary** (2-3 paragraphs)
2. **Key Points** (5-10 bullet points)
3. **Notable Timestamps** (if transcript available)
4. **Relevance to Focus** (if specified)
`;

    // Analyze with Gemini
    const analysis = await this.gemini.query(prompt, soulSeed);

    // Format output
    return `# YouTube Analysis: ${metadata.title}

**URL**: ${url}
**Channel**: ${metadata.channel}
**Duration**: ${Math.floor(metadata.duration / 60)}:${(metadata.duration % 60).toString().padStart(2, "0")}
**Has Transcript**: ${transcript ? "Yes" : "No"}

---

${analysis}

---
*Analyzed by Matrix Gemini Agent (Morpheus)*
`;
  }
}
