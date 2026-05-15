---
title: Quick start
description: Index your repo and ask your first question in under five minutes.
---

## Install + index

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

## What just happened

1. **`init`** created a `.gitwhy/` directory with a SQLite database, a config file, and a `traces/` directory for optional NDJSON observability.
2. **`estimate`** walked your repo's git history, categorized each commit (merge / bot / formatting / size-based), and projected how many LLM calls indexing would make plus the rough cost. No network was hit.
3. **`index`** did the real work: for each commit, it ran the categorizer, optionally clustered consecutive micro-commits, decomposed mega-commits, scrubbed secrets from diffs, called the LLM for an enriched summary, generated a vector embedding, and stored everything in the SQLite database. The whole thing is resumable — interrupt it and re-run `index` to continue.
4. **`why`** embedded your question, cosine-searched the stored embeddings, loaded the top-K commits, and synthesized a citation-backed answer with confidence gating.

## More CLI commands

```sh
gitwhy status                                # Coverage + token spend + hotspots
gitwhy risk <path>                           # Risk assessment for a file
gitwhy related <path>                        # Co-changing files
gitwhy commit [--apply]                      # Auto-generate a commit message
gitwhy catchup --since "1 week ago"          # Recent activity digest
gitwhy mcp-doctor                            # Diagnose MCP setup
gitwhy feedback up|down -q "..."             # Record answer feedback
gitwhy mcp                                   # Start the MCP server on stdio
```

## Next: wire it into your editor

The CLI is good, but the headline feature is the MCP server. See [MCP setup](../mcp-setup/) to connect GitWhy to Cursor, Claude Code, or Windsurf so your editor's AI agent can call `gitwhy.why` autonomously.

## Working offline

Set `GITWHY_USE_MOCK_LLM=1` to use the deterministic mock provider — useful for testing the pipeline without burning tokens. A first-class Ollama provider is on the post-launch roadmap.

## Cost transparency

GitWhy never indexes without telling you the projected cost first. The `estimate` command dry-runs the entire pipeline and reports per-category projected tokens + USD before any cloud call is made.

Indexing 5k commits on a real repo with `gpt-4o-mini` typically costs $0.10–$0.50 depending on commit size distribution. With `gemini-2.5-flash` on the free tier, it costs $0 but takes longer due to RPM pacing.
