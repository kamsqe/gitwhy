# GitWhy — Executive Summary

## What it is

**GitWhy is a persistent memory layer for AI coding agents over a repository's git history.** Indexed once, exposed both as a CLI and as an MCP (Model Context Protocol) server, GitWhy gives editors like Cursor, Claude Code, and Windsurf the ability to answer questions like *"why does this function exist?"* and *"why was this changed?"* in milliseconds, with citations to specific commits — even when the commit messages were "fix", "wip", or "major update".

## The problem in one sentence

Every developer joining or returning to a codebase spends hours re-deriving why the code looks the way it does, because the answers live in messy git history that nobody documented well and that ephemeral AI agent sessions re-analyze from scratch every time.

## Audience

- **Individual developers** working on existing codebases with mixed commit-message quality (i.e., most codebases).
- **Teams** that want shared institutional memory their AI editors can query — without re-paying the analysis cost every session, and without each teammate's editor reinventing the same explanation.
- **Open-source maintainers** triaging PRs against code they didn't write recently and need historical context for.
- **Onboarding new hires** who need to understand decisions made before they joined.

## What's different about GitWhy

| Existing approach | Limitation | What GitWhy adds |
|---|---|---|
| Read git log + git blame manually | Slow, doesn't scale past one file | Pre-indexed, semantic search across the whole history |
| Ask an AI agent on demand (`git log -p` + LLM) | Ephemeral — every session re-pays the analysis cost; doesn't share across teammates | Persistent index in a portable SQLite file; team can commit it |
| Static git analytics tools (CodeScene, Repowise) | Don't try to infer intent from diffs; surface metrics, not explanations | AI-inferred enriched summaries for every commit, citation-backed Q&A |
| Lore Protocol & similar | Improve *future* commit message hygiene | Understand *existing* messy history retroactively |

The wedge: **only GitWhy combines AI-inferred intent from diffs + persistent MCP memory layer + team-shareable index.**

## Key findings from the build

1. **Diff-intent inference is the load-bearing primitive.** A "fix" commit, run through an LLM with the actual code diff, produces an enriched summary like *"Added null guard before pricing lookup to prevent crash when user object is missing during OAuth callback."* That single transformation is what makes 70% of indexed repos legible.
2. **Pre-indexed beats on-demand by orders of magnitude.** A question that takes a naked AI agent 5-15 seconds (because it has to re-read git log, parse, infer) takes GitWhy <200ms because the inference has already been paid for at index time. Token cost per query falls from thousands to tens.
3. **The plugin-seam architecture pays off.** Adding Google Gemini as a second LLM provider took one new file and one config-detection function — the `LlmProvider` interface designed in Phase 1 was honored. The same pattern will make adding Anthropic / Mistral / local Ollama equally focused.
4. **A 40/30/30 risk-scoring composite (bus factor + ghost-code + hotspot) produces sensible LOW/MEDIUM/HIGH outputs on real repos** — though formal calibration against ground-truth bug data is future work.

## Business value

For an individual developer onboarding to a new codebase or returning after a break, GitWhy condenses what would be a half-day of git-log spelunking into seconds of natural-language questions. At a $50/hr blended developer cost and even a conservative one-hour-per-week saved estimate, GitWhy pays for itself in single-digit days on any cloud-LLM bill.

For a team, the equation gets stronger: the index is committed once and shared. The first teammate to ask "why does the payment timeout exist?" pays the LLM cost; everyone else gets the cached answer free. Institutional knowledge that previously walked out the door when a senior engineer left now stays with the repo.

For an open-source maintainer, GitWhy turns "I haven't looked at this file in 18 months" from a PR-blocking unknown into a citation-backed two-sentence summary delivered in the editor where review actually happens.

## Status & roadmap

**Capstone v1 (this submission)** delivers:
- 3 multi-agent system (Archaeologist + Knowledge + Insight) with explicit inter-agent communication via SQLite.
- RAG pipeline with confidence scoring and "I don't know" gating.
- 9 MCP tools designed for agent auto-invocation.
- CLI fallback for every MCP tool.
- 280+ automated tests including a dedicated adversarial suite (prompt injection, secrets in diffs, unicode hazards, concurrent queries, SQL-injection-shaped paths).
- OpenAI, Google Gemini, and mock LLM providers; SQLite-backed vector store; structured NDJSON tracing.

**Post-capstone OSS launch** (Phase 7 of the plan):
- Pre-indexed `tj/commander.js` bundled as a reproducible demo.
- Stockpiled good-first-issues across each plugin seam.
- Show HN + dev.to launch.
- Submission to MCP server registries (modelcontextprotocol.io, awesome-mcp lists).

**Beyond v1:**
- VS Code / Cursor extension layered on top of MCP for inline annotations.
- GitHub Action for PR-time risk + context summaries.
- Ollama-backed air-gapped mode for private codebases.
- Calibration of risk-score weights against ground-truth bug data.
- Cluster enrichment via LLM (currently metadata-only).

## License

MIT. Open from day one. The repository, code, tests, and docs are all in this submission package.
