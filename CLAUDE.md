# Matrix Gemini Agent

> *"Morpheus - I can show you the door. You're the one that has to walk through it."*

This is **Morpheus** in code form - a Gemini AI research agent for The Matrix ecosystem.

## Quick Start

```bash
# Run MCP server
bun run src/index.ts

# Or with watch mode
bun run dev
```

## Configuration

Set the Gemini API key:
```bash
export GEMINI_API_KEY="your-api-key"
```

Optional Matrix path (defaults to ~/workspace/The-matrix):
```bash
export MATRIX_PATH="/path/to/matrix"
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `gemini_research` | Deep research on any topic |
| `gemini_youtube` | Transcribe & analyze YouTube videos |
| `gemini_summarize` | Summarize URLs or documents |
| `gemini_compare` | Compare multiple sources |
| `gemini_history` | Query research history |

## Claude Code Integration

Add to `~/.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "gemini-agent": {
      "command": "bun",
      "args": ["run", "/Users/jarkius/workspace/matrix-gemini-agent/src/index.ts"],
      "env": {
        "GEMINI_API_KEY": "${GEMINI_API_KEY}",
        "MATRIX_PATH": "/Users/jarkius/workspace/The-matrix"
      }
    }
  }
}
```

## Bun Preferences

- Use `bun run` instead of `npm run`
- Use `bun:sqlite` (built-in) instead of `better-sqlite3`
- Use `Bun.file()` for file operations
- Use `Bun.$` for shell commands

## Architecture

```
src/
├── index.ts           # MCP Server entry point
├── gemini/
│   ├── api.ts         # Gemini API client
│   └── youtube.ts     # YouTube analyzer
├── soul/
│   └── connector.ts   # Matrix Soul Seed loader
└── db/
    └── history.ts     # Research history (SQLite)
```

## Soul Integration

This agent inherits philosophy from The Matrix via Soul Seed:
- Loads `psi/The_Source/SOUL_SEED.md` at startup
- Injects Matrix philosophy into all prompts
- Graceful degradation if Matrix unavailable

## Part of The Matrix Ecosystem

- **The Matrix** (The-Oracle-Construct) - AI development environment
- **Agent Orchestra** (matrix-memory-agents) - Multi-agent orchestration
- **Matrix Gemini Agent** (this repo) - Gemini research capabilities

*"Free your mind."*
