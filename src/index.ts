/**
 * Matrix Gemini Agent - MCP Server
 *
 * "Morpheus - I can show you the door. You're the one that has to walk through it."
 *
 * This agent provides Gemini AI capabilities to Claude Code:
 * - YouTube transcription and analysis
 * - Web page research and summarization
 * - Deep research mode
 * - Learning sync to Matrix
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { GeminiClient } from "./gemini/api";
import { YouTubeAnalyzer } from "./gemini/youtube";
import { SoulConnector } from "./soul/connector";
import { ResearchHistory } from "./db/history";

// Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MATRIX_PATH = process.env.MATRIX_PATH || "~/workspace/The-matrix";

// Initialize components
const gemini = new GeminiClient(GEMINI_API_KEY);
const youtube = new YouTubeAnalyzer(gemini);
const soul = new SoulConnector(MATRIX_PATH);
const history = new ResearchHistory();

// Create MCP Server
const server = new Server(
  {
    name: "matrix-gemini-agent",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tools
const TOOLS = [
  {
    name: "gemini_research",
    description: "Perform deep research on a topic using Gemini AI. Returns comprehensive analysis with sources.",
    inputSchema: {
      type: "object" as const,
      properties: {
        topic: {
          type: "string",
          description: "The topic or question to research",
        },
        depth: {
          type: "string",
          enum: ["quick", "standard", "deep"],
          description: "Research depth: quick (1 query), standard (3 queries), deep (5+ queries)",
          default: "standard",
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "gemini_youtube",
    description: "Transcribe and analyze a YouTube video using Gemini AI. Extracts key insights, timestamps, and summary.",
    inputSchema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "YouTube video URL",
        },
        focus: {
          type: "string",
          description: "Optional focus area for analysis (e.g., 'technical details', 'key takeaways')",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "gemini_summarize",
    description: "Summarize a URL or document content using Gemini AI.",
    inputSchema: {
      type: "object" as const,
      properties: {
        content: {
          type: "string",
          description: "URL or text content to summarize",
        },
        style: {
          type: "string",
          enum: ["brief", "detailed", "bullet-points"],
          description: "Summary style",
          default: "detailed",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "gemini_compare",
    description: "Compare multiple sources or viewpoints on a topic.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sources: {
          type: "array",
          items: { type: "string" },
          description: "List of URLs or text content to compare",
        },
        aspect: {
          type: "string",
          description: "Aspect to compare (e.g., 'accuracy', 'completeness', 'bias')",
        },
      },
      required: ["sources"],
    },
  },
  {
    name: "gemini_history",
    description: "Query research history. Returns past research sessions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query for history (optional)",
        },
        limit: {
          type: "number",
          description: "Maximum results to return",
          default: 10,
        },
      },
    },
  },
];

// Register tool list handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Register tool call handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Load soul for each request
  const soulSeed = await soul.load();

  try {
    switch (name) {
      case "gemini_research": {
        const { topic, depth = "standard" } = args as { topic: string; depth?: string };
        const result = await gemini.research(topic, depth, soulSeed);
        await history.save("research", topic, result);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "gemini_youtube": {
        const { url, focus } = args as { url: string; focus?: string };
        const result = await youtube.analyze(url, focus, soulSeed);
        await history.save("youtube", url, result);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "gemini_summarize": {
        const { content, style = "detailed" } = args as { content: string; style?: string };
        const result = await gemini.summarize(content, style, soulSeed);
        await history.save("summarize", content.slice(0, 100), result);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "gemini_compare": {
        const { sources, aspect } = args as { sources: string[]; aspect?: string };
        const result = await gemini.compare(sources, aspect, soulSeed);
        await history.save("compare", sources.join(" vs "), result);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "gemini_history": {
        const { query, limit = 10 } = args as { query?: string; limit?: number };
        const results = await history.search(query, limit);
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  console.error("[Matrix Gemini Agent] Starting MCP server...");

  // Load soul on startup
  const soulSeed = await soul.load();
  if (soulSeed) {
    console.error("[Matrix Gemini Agent] Soul Seed loaded from Matrix");
  } else {
    console.error("[Matrix Gemini Agent] Running in soulless mode (Matrix not found)");
  }

  // Initialize history database
  await history.init();

  // Connect transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[Matrix Gemini Agent] MCP server running");
}

main().catch((error) => {
  console.error("[Matrix Gemini Agent] Fatal error:", error);
  process.exit(1);
});
