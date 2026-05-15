# AGENTS.md

> Quick orientation for AI coding agents (Cursor, Claude Code, Windsurf, Copilot) and the humans who use them, working on this repo.

## What this project is

GitWhy is a persistent memory layer over a git repository, indexed once and exposed both as a CLI and as an MCP server. The agent-facing primitive is the MCP server — when GitWhy is wired into an AI editor, the editor's agent gets tools like `gitwhy.why` and `gitwhy.risk` it can call without the user typing GitWhy's name.

## Quick layout

```
gitwhy/
├── src/
│   ├── agents/              Knowledge + Insight agents (RAG, risk analysis)
│   ├── cli/                 Commander-based CLI; src/cli/index.ts is the entry
│   ├── config/              Config types, loader, provider auto-detection
│   ├── indexer/             Archaeologist: git parsing, categorizers, diff analysis
│   ├── mcp/                 MCP server + 9 tools (src/mcp/tools/)
│   ├── observability/       NDJSON tracer
│   ├── providers/llm/       OpenAI, Gemini, Mock LLM providers
│   ├── providers/vector/    SQLite-blob vector store (JS cosine similarity)
│   ├── storage/             SQLite schema + repos for commits, embeddings, feedback
│   └── utils/               logger, env loader, LRU cache
├── tests/                   Vitest (32 test files, ~280 tests)
├── docs/                    Architecture blueprint, exec summary, self-review
└── web/                     Astro public site (post Phase 6)
```

## Plugin seams (the load-bearing boundaries)

If a change spans an obvious abstraction, edit through the seam — don't bypass it.

| Adding a... | Edit |
|---|---|
| LLM provider (Anthropic, Mistral, etc.) | `src/providers/llm/` — implement `LlmProvider` from `types.ts` |
| Commit categorizer (new bot pattern, etc.) | `src/indexer/categorizers/` — implement `Categorizer` from `types.ts` |
| MCP tool | `src/mcp/tools/` — implement `McpTool`, register in `src/mcp/tools/index.ts` |
| Vector store backend (pgvector, etc.) | `src/providers/vector/` — implement `VectorStore` |
| CLI command | `src/cli/commands/` — add an action in `src/cli/index.ts` |

Every seam has a corresponding test fixture in `tests/fixtures/` or `tests/unit/`.

## Conventions

- **TypeScript strict.** `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, ESM-only. Import `.js` extensions in TS source files (Node ESM convention).
- **Tests must be deterministic.** Use the mock LLM provider (`createMockLlmProvider`) and the temp-repo fixture (`tests/fixtures/temp-repo.ts`). Real LLM calls are reserved for manual smoke tests.
- **No silent error swallowing.** Tracer error spans are fine; `catch {}` is not unless paired with `errors++` and a user-visible signal.
- **Comments are rare.** Only WHY-comments where the reason isn't obvious from naming. Don't summarize behaviour that the next line already shows.

## How to verify a change

```sh
pnpm typecheck    # strict TS
pnpm lint         # ESLint flat config
pnpm test         # Vitest, full suite
pnpm build        # tsc to dist/
```

CI runs all four on Node 20 and 22. If lint or typecheck breaks, every other check is invalidated — fix those first.

## How to run end-to-end against a real repo

```sh
pnpm build
cd /path/to/some/repo
node /path/to/gitwhy/dist/cli/index.js init
node /path/to/gitwhy/dist/cli/index.js index --provider gemini  # or openai, or mock
node /path/to/gitwhy/dist/cli/index.js why "why does X exist?"
node /path/to/gitwhy/dist/cli/index.js risk path/to/file.ts
```

`gitwhy mcp-doctor` is the diagnostic if anything's off.

## Where the architecture is really explained

Code structure is one thing; the *reasoning* behind it is in `docs/architecture.md` and `docs/self-review.md`. Read those before making non-trivial architectural changes.
