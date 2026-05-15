# Contributing to GitWhy

Thanks for your interest. This document will grow as the project matures; for now it's a sketch of the architecture so new contributors can find their way around.

## Architecture at a glance

GitWhy has four layers, all in `src/`:

```
  AI Agent (Cursor / Claude Code / Windsurf)
                  │
                  ▼
       src/mcp/  ◄──────────── MCP server + tools (primary surface)
       src/cli/  ◄──────────── CLI fallback (same backing services)
                  │
                  ▼
       src/agents/   ────────  Archaeologist / Knowledge / Insight
                  │
                  ▼
       src/providers/  ──────  LLM providers, vector stores
       src/storage/    ──────  SQLite metadata, embeddings
       src/indexer/    ──────  Git parsing, commit categorization
```

Every cross-cutting boundary has a small interface in a `types.ts` file. Adding a new LLM provider, a new commit categorizer, a new MCP tool, or a new vector backend is a focused PR against one of these seams.

## Plugin seams (where to add things)

| If you want to... | Edit |
|---|---|
| Add a new LLM provider (Anthropic, Google, etc.) | `src/providers/llm/` — implement `LlmProvider` interface |
| Add a new commit pattern (bot, squash-merge style, etc.) | `src/indexer/categorizers/` — implement `Categorizer` interface |
| Add a new MCP tool | `src/mcp/tools/` — implement `McpTool` interface, register in `registry.ts` |
| Add a new vector store backend | `src/providers/vector/` — implement `VectorStore` interface |

## Local development

```sh
pnpm install        # Install dependencies
pnpm test           # Run Vitest
pnpm typecheck      # tsc --noEmit
pnpm lint           # ESLint
pnpm build          # Compile to dist/
pnpm mcp            # Run the MCP server (stdio)
```

## Tests

- **Positive tests** — Known commits → expected enriched descriptions.
- **Negative tests** — Empty repo, binary files, missing config → graceful failure.
- **Adversarial tests** — Prompt injection in commit messages, huge diffs, secrets.
- **MCP tests** — Tool descriptions trigger correct auto-invocation in real agents (transcript fixtures).

Test fixtures double as a contract for plugin authors — if you add a categorizer, add a fixture.

## Good first issues

Look for issues labeled `good first issue` once the project is launched. The repo will ship with a stockpile of pre-scoped contributions covering new bot patterns, additional LLM providers, edge-case handling, and doc improvements.
