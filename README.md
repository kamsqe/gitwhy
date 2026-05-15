# GitWhy

> Persistent memory for AI coding agents over your git history.

GitWhy pre-indexes your git history into an enriched, semantically searchable knowledge base. For commits with bad messages, it uses an LLM to reverse-engineer intent from the actual diff. It exposes the knowledge base over MCP so any AI agent in your editor — and every teammate using that editor — gets fast, citation-backed historical context on demand.

**Status:** Phase 1 scaffolding. Not yet functional.

## Quickstart (planned)

```sh
npx gitwhy init           # Index your repo's history
npx gitwhy why "..."      # Ask a question
```

For MCP integration with Cursor / Claude Code / Windsurf, see [docs/mcp.md](docs/mcp.md) (coming soon).

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

## License

[MIT](./LICENSE)
