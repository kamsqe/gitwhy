# GitWhy

> **Persistent memory for AI coding agents over your git history.**
> Indexed once, exposed over MCP — so your editor's AI agent answers *"why does this exist?"* instantly, with citations.

---

**🌐 Live site / docs:** [gitwhy.pages.dev](https://gitwhy.pages.dev)
**🎥 Demo video:** *(coming on launch)*
**📦 Repository:** [github.com/kamsqe/gitwhy](https://github.com/kamsqe/gitwhy)
**📜 License:** [MIT](./LICENSE)

---

## The pitch in one paragraph

Every developer wastes hours re-deriving why a codebase looks the way it does. The answers live in git history, but commit messages are usually unhelpful (`fix`, `wip`, `major update`) and on-demand AI editors re-pay the analysis cost every session. GitWhy indexes your repository's history once, uses an LLM to reverse-engineer intent from actual code diffs, and exposes the result over MCP — so any compatible editor (Cursor, Claude Code, Windsurf) gets fast, citation-backed historical context as a native tool call.

## Quick start

```sh
# 1. Initialize gitwhy in your repo
npx gitwhy init

# 2. Set your LLM credentials (one of these)
export OPENAI_API_KEY=sk-...
export GEMINI_API_KEY=AIza...

# 3. Estimate cost, then index
npx gitwhy estimate
npx gitwhy index

# 4. Ask anything
npx gitwhy why "why does processPayment have a 30 second timeout?"
```

### MCP integration (the headline feature)

Add to your AI editor's MCP config (Cursor, Claude Code, Windsurf, etc.):

```jsonc
{
  "mcpServers": {
    "gitwhy": {
      "command": "npx",
      "args": ["gitwhy", "mcp"]
    }
  }
}
```

Your editor's agent now has 9 tools it can call autonomously: `gitwhy.why`, `gitwhy.history`, `gitwhy.risk`, `gitwhy.related`, `gitwhy.context_for_pr`, `gitwhy.catchup`, `gitwhy.search`, `gitwhy.suggest_commit_message`, `gitwhy.ping`. Ask your editor *"why does this file exist?"* and it calls `gitwhy.why` for you — no need to type GitWhy's name.

Run `npx gitwhy mcp-doctor` to verify your setup is wired correctly.

## What it does

**The Archaeologist agent** (indexing-time):
- Categorizes every commit (merge / bot / formatting / initial / revert / size-based)
- Clusters consecutive micro-commits ("wip", "wip2", "fix typo") by the same author into logical units
- Decomposes mega-commits (>500-line diffs) into per-module groups before LLM analysis
- Pre-scrubs diffs for secrets (12 patterns: AWS, GitHub, OpenAI, JWT, PEM, etc.) before any cloud call
- Generates a one-sentence enriched summary + an embedding for every commit

**The Knowledge agent** (query-time):
- Embeds your question, vector-searches the indexed history, synthesizes an answer with inline citations
- Confidence-gates with a hard "I don't know" threshold below 0.4 cosine similarity
- LRU-caches identical questions for free repeat queries

**The Insight agent** (SQL analytics):
- Bus factor per file (minimum contributors for 50% of changes)
- Hotspot detection (recent × total churn, excluding bots/merges/formatting)
- Ghost-code detection (files whose dominant contributor has been inactive)
- Co-change analysis (forward confidence + Jaccard-like correlation)
- Composite risk score with human-readable reasons

## How it compares

| Tool | What it does | What GitWhy adds |
|---|---|---|
| `git log -p` + naked AI editor | Explains a diff on demand | Pre-indexed, persistent, citation-backed; 100× faster per query, no re-analysis cost |
| **Repowise / CodeScene** | Static git analytics (hotspots, ownership) | AI-inferred *intent* from diffs, not just metrics; MCP-native; conversational Q&A |
| **Lore Protocol** | Improves *future* commit message hygiene | Understands *existing* messy history retroactively |

## CLI reference

```sh
gitwhy init                                  # Initialize .gitwhy/ in cwd
gitwhy estimate                              # Dry-run cost projection
gitwhy index --provider openai|gemini|mock   # Index the repo
gitwhy status                                # Coverage + token spend + hotspots
gitwhy why "..."                             # Ask a question
gitwhy risk <path>                           # Risk assessment for a file
gitwhy related <path>                        # Co-changing files
gitwhy commit [--apply]                      # Auto-generate a commit message
gitwhy mcp                                   # Start the MCP server on stdio
gitwhy mcp-doctor                            # Diagnose MCP setup
gitwhy feedback up|down -q "..."             # Record answer feedback
```

## Privacy

GitWhy can run fully local. Set `GITWHY_USE_MOCK_LLM=1` to use the deterministic mock provider (for tests). Real LLM calls always run through the secret scanner first — 12 patterns covering AWS, GitHub, OpenAI, Anthropic, Slack, Stripe keys, JWTs, PEM blocks, and generic `KEY=value` assignments. Detected secrets are redacted *before* the diff is sent.

The Ollama local-provider implementation is on the post-launch roadmap; the `LlmProvider` interface already accommodates it.

## Documentation

- **[Architecture Blueprint](./docs/architecture.md)** — system design, Mermaid diagrams, tech stack rationale
- **[Executive Summary](./docs/executive-summary.md)** — what it is, who it's for, business value
- **[Self-Review](./docs/self-review.md)** — trade-off ledger, what would change with more time
- **[AGENTS.md](./AGENTS.md)** — orientation for AI agents and humans working on the repo

## Development

```sh
pnpm install
pnpm test         # 280+ tests across 33 files
pnpm typecheck    # strict TS
pnpm lint         # ESLint flat config
pnpm build        # compile to dist/
```

CI runs on Node 20 and 22 against every PR.

## Status

**Capstone v1** — multi-agent (Archaeologist + Knowledge + Insight), 9 MCP tools, OpenAI + Gemini + mock providers, vector RAG with confidence gating, NDJSON observability, dedicated adversarial test suite. Built MIT-licensed and open from day one.

**Post-launch** — Ollama provider, GitHub Action, VS Code extension, multi-repo support, calibrated risk-score weights. Contributions welcome — see [AGENTS.md](./AGENTS.md) for orientation.
