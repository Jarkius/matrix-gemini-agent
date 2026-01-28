# Matrix Gemini Agent

> *"Morpheus - I can show you the door. You're the one that has to walk through it."*

**Morpheus in code** - A Gemini AI research agent for The Matrix ecosystem, providing YouTube transcription, deep research, and web content analysis through Claude Code MCP integration.

## Features

- **YouTube Analysis**: Transcribe and analyze videos using yt-dlp + Gemini
- **Deep Research**: Multi-query research with configurable depth
- **Content Summarization**: Summarize URLs and documents
- **Source Comparison**: Compare multiple sources objectively
- **Research History**: SQLite-backed history with full-text search
- **Soul Integration**: Inherits Matrix philosophy via Soul Seed

## Installation

```bash
# Clone with GHQ (recommended)
ghq get https://github.com/Jarkius/matrix-gemini-agent.git

# Or clone directly
git clone https://github.com/Jarkius/matrix-gemini-agent.git

# Install dependencies
cd matrix-gemini-agent
bun install
```

## Configuration

### Environment Variables

```bash
# Required for Gemini API
export GEMINI_API_KEY="your-api-key"

# Optional: Matrix path for Soul integration
export MATRIX_PATH="~/workspace/The-matrix"
```

### Claude Code Integration

Add to `~/.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "gemini-agent": {
      "command": "bun",
      "args": ["run", "~/workspace/matrix-gemini-agent/src/index.ts"],
      "env": {
        "GEMINI_API_KEY": "${GEMINI_API_KEY}"
      }
    }
  }
}
```

## Usage

### MCP Tools

| Tool | Description | Example |
|------|-------------|---------|
| `gemini_research` | Deep research on a topic | `gemini_research("quantum computing trends", depth: "deep")` |
| `gemini_youtube` | Analyze YouTube video | `gemini_youtube("https://youtube.com/watch?v=...")` |
| `gemini_summarize` | Summarize content | `gemini_summarize("https://example.com/article")` |
| `gemini_compare` | Compare sources | `gemini_compare(["url1", "url2"], aspect: "accuracy")` |
| `gemini_history` | Search history | `gemini_history(query: "quantum")` |

### Running Standalone

```bash
# Start MCP server
bun run start

# Development with watch
bun run dev

# Run tests
bun test
```

## Architecture

```
matrix-gemini-agent/
├── src/
│   ├── index.ts           # MCP Server entry
│   ├── gemini/
│   │   ├── api.ts         # Gemini API client
│   │   └── youtube.ts     # YouTube analyzer (yt-dlp + Gemini)
│   ├── soul/
│   │   └── connector.ts   # Matrix Soul Seed loader
│   └── db/
│       └── history.ts     # Research history (bun:sqlite)
├── tests/
├── package.json
└── README.md
```

## Soul Integration

This agent inherits philosophy from The Matrix:

1. **Soul Seed**: Loads compressed philosophy from `psi/The_Source/SOUL_SEED.md`
2. **Prompt Injection**: All Gemini queries include Matrix philosophy
3. **Graceful Degradation**: Agent works even without Matrix connection

## Dependencies

- **Bun**: Runtime and package manager
- **@google/generative-ai**: Official Gemini SDK
- **@modelcontextprotocol/sdk**: MCP server framework
- **yt-dlp**: YouTube metadata and caption extraction (optional)

## Part of The Matrix Ecosystem

- [**The Matrix**](https://github.com/Jarkius/The-Oracle-Construct) - AI development environment
- [**Agent Orchestra**](https://github.com/Jarkius/matrix-memory-agents) - Multi-agent orchestration
- **Matrix Gemini Agent** (this repo) - Gemini research capabilities

## License

MIT

---

*"Free your mind."*
