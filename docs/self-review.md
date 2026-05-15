# GitWhy — Self-Review

This is the trade-off ledger. The architecture blueprint says *what* we built; this document says *why we chose it over the alternatives*, *what we'd revisit*, and *what the rough edges actually are*. The intended reader is a senior engineer who already understands the code and wants to know whether the reasoning held up.

## 1. The five biggest decisions

### 1.1 TypeScript / Node, not Python / LangGraph

**The choice:** Pure TypeScript with `@modelcontextprotocol/sdk` for the agent surface, no orchestration framework.

**The alternatives considered:** LangGraph (Python; explicit graph definitions), AutoGen (Python; role-playing agents), CrewAI (Python; task assignment), LlamaIndex (Python; RAG-first), Mastra (TypeScript; agent framework with tools).

**Why TypeScript:** Three reasons. (1) Author primary expertise — the project gets done. (2) The MCP SDK is officially supported in TypeScript and was designed alongside the protocol; first-class integration with Claude Code (the most common testing target) is a Node import away. (3) The CLI + MCP server pattern is exactly what Node was built for; a Python equivalent would need a separate venv/pyenv and a heavier install.

**Why no orchestration framework:** GitWhy's agents don't talk to each other at runtime. The Archaeologist's output is *baked* into the SQLite database; Knowledge and Insight *read* it. The "graph" is implicit and degenerate (one node per query, edge to one agent). LangGraph would be a 200KB framework with no nail to drive. We described this in detail in `architecture.md` §6; the short version is that MCP is the orchestration layer, and Cursor is the agent doing the orchestrating.

**Honest trade-off:** If GitWhy v2 adds a "code reviewer" agent that needs to negotiate with Insight ("is this file risky?" → "yes, here's why" → "should I block the PR?") in multi-turn fashion, a graph framework becomes attractive. The current architecture is designed to be a *substrate* for such an agent: the InsightAgent and KnowledgeAgent are callable as plain functions. Migration to a graph framework would be additive, not a rewrite.

### 1.2 SQLite BLOB + JS cosine, not sqlite-vec or pgvector

**The choice:** Store embeddings as raw float32 BLOBs in SQLite, compute cosine similarity in JavaScript at query time.

**The alternatives considered:** sqlite-vec (native SQLite extension), pgvector (Postgres extension), Chroma (separate process), LanceDB (file-based vector DB).

**Why SQLite BLOB:** sqlite-vec is *technically* faster — native SIMD code beats JS — but it ships as a platform-specific binary that has to be `dlopen`'d at runtime. For an npm package distributed via `npx`, that's a real install-flakiness risk: macOS / Linux x64 / Linux arm64 / Windows each need a separate prebuild, the loader has historical edge cases on certain Node versions, and the failure mode is a cryptic load-time error that scares away new users. JS cosine over 50k embeddings runs in <200ms, which is well below MCP latency budgets. We will revisit if/when GitWhy needs to index repos with 100k+ commits.

**Why not pgvector:** A separate database process means a separate install, separate auth, separate operational burden. For a tool that runs on a developer laptop, this is a non-starter. For a hypothetical "GitWhy for teams" hosted offering, pgvector becomes the right choice — and the `VectorStore` interface designed in Phase 1 means swapping it would be a focused PR against `src/providers/vector/`.

**Honest trade-off:** The cosine loop is in user space, not in the SQL engine. On 50k embeddings with 3072 dimensions (gemini-embedding-001), each query walks 150M floats. That's fine on modern hardware but won't scale linearly to 500k commits. We acknowledged this in the code comment on `SqliteBlobVectorStore`.

### 1.3 MCP as the primary surface, CLI as fallback

**The choice:** The MCP server is treated as the headline product. The CLI exists, has feature parity, and is the documented capstone-reviewer path — but every README sentence positions GitWhy first as an editor extension.

**The alternative:** CLI-first, MCP as bonus.

**Why MCP-first:** Naked AI editors already do diff-explanation on demand. The unique value GitWhy provides isn't "AI can explain code" — it's "your editor's AI now has persistent, cross-session memory of *why* this code looks the way it does, and never re-pays the analysis cost." That's a positioning insight, but it has architectural consequences: the MCP tool descriptions are load-bearing UX (they drive whether an AI agent auto-invokes the tool), the answer-with-citations contract matters more than the answer-as-output contract, and the bonus question for the +10 UX rubric points becomes "is the editor + GitWhy a polished UI?" rather than "did GitWhy ship its own UI?"

**Honest trade-off:** Reviewers who don't have Cursor or Claude Code installed see a CLI. The CLI is good, but it doesn't show the split-screen "wow" moment that the MCP integration does. We mitigate with screenshots in `docs/` and the Astro site, but the demo video remains the load-bearing artifact.

### 1.4 Plugin seams designed in Phase 1, not retrofitted

**The choice:** The four cross-cutting interfaces (`LlmProvider`, `VectorStore`, `Categorizer`, `McpTool`) were defined in Phase 1 with registries, before *any* concrete implementation existed.

**The alternative:** YAGNI — build one provider, one tool, one categorizer; refactor to interfaces when a second is needed.

**Why design-first:** The argument against YAGNI in this specific case: each interface has at most 4 methods, costs ~30 lines of TypeScript, and pays off the *first time* we need a second implementation. We hit that payoff in Phase 3.5 when we needed Gemini support — adding it took a single new file in `src/providers/llm/` and a few lines in `src/mcp/runtime.ts`'s resolver. If we'd YAGNI'd, the OpenAI provider would have grown coupling to the openai SDK across the indexer, and the Gemini retrofit would have been a 5-file refactor.

**Honest trade-off:** Some interfaces (notably `Categorizer`) are *thin* — categorizers don't currently have a clear extension story beyond "add a new regex." The interface defends the door, but I have not yet seen a community-contributed categorizer. Real validation of the OSS value here requires the launch.

### 1.5 Two-pass commit upsert in the indexer

**The choice:** When indexing a commit, the indexer upserts the row *twice* — once with empty enrichment fields, then again after the LLM call with the enriched summary. The second upsert preserves prior values via `COALESCE(excluded, existing)`.

**The alternative:** One upsert at the end, after enrichment completes.

**Why two passes:** Discovered during a Phase 3 smoke test. The mega-commit decomposer calls `recordLlmCall` with `related_commit` set to the commit hash, and the `llm_calls.related_commit → commits.hash` foreign key requires the commit row to exist. If we waited to upsert until after enrichment, the FK fires before the row exists and the indexer accumulates `errors++` silently. By upserting an empty row first, the FK always resolves.

**Why not just drop the FK:** Because then the `llm_calls` table loses referential integrity. The team-shareable index claim depends on the data being clean; a `related_commit` pointing at a non-existent hash is a future debugging trap.

**Honest trade-off:** Two writes per commit instead of one. At indexing scale (hundreds of commits per minute on a real repo) this is invisible. At 100k+ commit scale it'd be 200k transactions; we could batch the second upsert if it ever becomes the bottleneck. Currently it isn't.

## 2. Things I'd revisit with more time

### 2.1 Risk-score weight calibration

The 40% bus factor + 30% ghost + 30% hotspot composite is *intuition*. With ground-truth bug data — for instance, a labeled dataset like Defects4J or the bug-fix commits in `tj/commander.js`'s history — we could fit the weights empirically. I have not done this; the current outputs are sensible on the toy repo, which is suggestive but not proof.

The fix is small if someone provides labels: replace the constants in `src/agents/insight/risk-score.ts` with a small JSON file that ships in the npm package, and add a `gitwhy calibrate <bugs-csv>` command to recompute against the user's own ground truth.

### 2.2 Indexer tracing wiring

Phase 5 added structured NDJSON tracing via `GITWHY_TRACE=1` and wired it into the MCP server's tool-call handler. The indexer (the longest-running, most expensive code path) does not yet emit spans — it has its own LLM call accounting in `llm_calls` but no per-stage tracing. A Phase 6 follow-up that I deliberately deprioritized: rewire `src/indexer/indexer.ts` so the per-commit loop opens a span per phase (categorize / load diff / analyze / embed / store).

This was deprioritized because the `gitwhy estimate` command already provides the *predictive* observability ("you'll spend $X to index this repo"), and `gitwhy status` provides the *retrospective* observability ("you've spent $Y so far"). Spans during indexing would be most useful for *debugging slow indexes*, which hasn't been a real problem.

### 2.3 Cluster enrichment

Clusters of micro-commits are *detected and stored*, but the aggregate diff is not yet sent through the LLM for synthesis. This means clustering currently *saves cost* (the micros are stored as raw, not LLM-enriched) without yet *earning back the value* (a cluster with no summary is hard to query against).

The fix is straightforward: in the indexer's final pass over `microCommits`, instead of just `upsertCluster(db, cluster)`, fetch the union of diffs across the cluster's commits, send the combined diff to `analyzeDiff`, and store the synthesized summary on the cluster row. The cluster's embedding then becomes queryable just like a commit's.

I chose to ship the cluster *structure* in v1 and defer enrichment because the marginal cost (≥1 extra LLM call per cluster, potentially expensive on bursty Gemini free tier) didn't pay for itself in capstone scope. Post-launch it's a focused PR.

### 2.4 The MCP-doctor coverage limit

`gitwhy mcp-doctor` verifies five things: `.gitwhy/` exists, config parses, index is populated, all tools are registered with sufficiently long descriptions, and (optionally) LLM credentials probe successfully. It cannot verify what we actually care about: *will Cursor / Claude Code actually invoke `gitwhy.why` when the user asks why something exists?*

Proving that requires a recorded MCP transcript fixture — a real session against a real agent, asserting against the agent's tool-call selection. I scoped this out of capstone v1 because it requires a specific Cursor / Claude Code version to record, would be fragile across upstream changes, and tests written this way fail in CI for reasons unrelated to GitWhy. Post-launch we can ship a `gitwhy mcp-test` command that runs Claude Code's tool-invocation API against a curated set of questions and reports whether each tool triggered.

### 2.5 The Gemini free-tier mega-commit problem

Documented in `architecture.md` §12 as a known limitation. The Gemini 2.5 Flash free tier is 10 RPM in theory but appears to enforce a tighter burst limit in practice. Indexing a single mega-commit decomposed into 8 per-module groups will exceed it, even with the 6.5-second pacer and 5-attempt exponential-backoff retry.

The right fix is either (1) increase pacer interval to 12-15 seconds for free tier (slower but reliable), or (2) cap mega-commit decomposition depth to 3 groups when running on a known-rate-limited provider. The plumbing exists for both; I chose to ship with the current settings and document the limitation rather than over-engineer for a free-tier user who can also just use paid tier or `--provider mock` for testing.

## 3. What surprised me during the build

### 3.1 OpenAI SDK v5's base64-default embeddings

The OpenAI SDK now returns embeddings as base64-encoded strings by default, decoding them client-side. My initial test passed plain number arrays from a custom `fetch` mock; the SDK tried to base64-decode them and got garbage. Fixed by explicitly setting `encoding_format: 'float'` in the embed call. Minor incident, but it's the kind of upstream behavior change that breaks a year of code if you're not testing against the real wire format.

### 3.2 Gemini 2.5's thinking tokens consume the output budget

Gemini 2.5 Flash defaults thinking mode ON. The thinking tokens count against `maxOutputTokens`, so a request with `maxOutputTokens: 120` for a 30-word summary received responses of 2-5 tokens — the thinking consumed everything. Fix: explicitly set `thinkingConfig: { thinkingBudget: 0 }` in the request config. This was a non-obvious failure mode that looked like the model was returning empty completions for no reason.

### 3.3 Better-sqlite3 generic types are fiddly

`db.prepare<Params, Result>` exists in `@types/better-sqlite3` but the Statement<Result> generic doesn't propagate cleanly through `.get()` / `.all()`. After fighting it, I dropped generics in favor of explicit `as { … } | undefined` casts at the boundary. The type assertion is documented next to each cast; less elegant, more honest.

### 3.4 Co-change ordering caught a real test mistake

The first version of the co-change test expected `[api.test.ts, types.ts]` for `src/api.ts`. The test failed because `types.ts` only co-occurred once and the default `minCoCommits` was 2. The test was wrong — but the *bug it caught* was that my mental model of the default threshold was wrong. I'd written the default as 2 to filter "weakly related" files, then forgotten about it when seeding test data. Lowering the threshold for that one test would have hidden the lesson; instead I added a second co-occurrence of `types.ts` in the seed data so the test reflects realistic usage. The test now also documents the rule: *if a file isn't related two or more times, GitWhy won't show it as related.*

## 4. Things I deliberately did not do

Listing these here so reviewers know what's intentional and what's missed.

- **A web UI for browsing the index.** The Astro site shipped in Phase 6 *displays* the rendered docs and a demo report, but there is no live dashboard for browsing your own indexed commits. The MCP server + editor is the live UI. A separate dashboard is post-launch work.
- **Multi-repo / monorepo aggregation.** A single `.gitwhy/` corresponds to one git repository. Cross-repo "find all commits about authentication across our org" is a v2 feature that requires aggregation infrastructure (or a hosted offering).
- **Real-time freshness on the index.** The index is populated by `gitwhy index` and stays as-is until rerun. There is no file watcher, no git-hook-driven incremental update, no background daemon. `gitwhy status` warns when coverage drops below 50%; the user is expected to rerun the indexer. Live-updating the index is plausible (the schema supports it via `getIndexedHashes` resume) but not built.
- **Quality-tuned prompts.** The system prompts in the Archaeologist and Knowledge agents are first-draft. They cover prompt-injection mitigation, citation format, "I don't know" gating — but they have not been A/B-tested against alternative phrasings. Real prompt evaluation requires a labeled question/answer pair dataset, which is post-launch work.
- **GitHub PR integration as a separate code path.** The `context_for_pr` tool reads the branch diff via simple-git and analyzes each file with existing Insight queries. There is no GitHub API client, no PR commenting, no Action. A GitHub App is on the post-launch roadmap.

## 5. Reflection on the test strategy

Across phases, the suite grew from 12 tests (Phase 1) to 280+ tests (Phase 5). Three observations:

**Adversarial tests caught one real bug.** The Phase 5 adversarial suite includes 19 cases. Eighteen passed first try. One — the SQL-injection-shaped path through `gitwhy.history` — initially passed because the parameterization was working correctly, but writing the test surfaced that my mental model of "what if someone passes a path with `'; DROP TABLE commits; --`" had been a vague "should be fine" rather than verified. The test makes the parameterization a contract going forward, even though the bug was hypothetical.

**Integration tests against a real temp git repo are worth their cost.** Vitest's `beforeAll` lets us spin up an actual git repo, make commits with known content, and run the indexer or GitReader against it. The setup is fast (sub-second) and these tests caught a real bug (the FK ordering issue in §1.5) that mock-only tests would have missed entirely. The cost: one shared fixture in `tests/fixtures/temp-repo.ts` and a minor performance hit (temp filesystem I/O in CI).

**The mock LLM provider is the most leveraged piece of test infrastructure in the project.** Every test that exercises the diff analyzer, indexer, knowledge agent, or any MCP tool that hits an LLM uses the mock. It's 80 lines of code and it determines whether the test suite can run in CI without burning real tokens or flaking on network. A real-world OSS lesson: design for testability *at the seam*, not *after the seam*.

## 6. If I were doing it again

Two changes I'd make if starting from scratch on day one:

1. **Use Astro Starlight from the very beginning, not at Phase 6.** The docs (this self-review, the executive summary, the architecture blueprint) are real deliverables; building them on a docs framework rather than as standalone Markdown means search, navigation, dark mode, and code highlighting come free. Migrating the existing docs to Starlight is straightforward, but writing them with Starlight conventions from the start (e.g., MDX front-matter, sidebar nav) is faster than retrofitting.

2. **Calibrate the risk-score weights before claiming any rubric points on data quality.** I shipped with intuition-weighted constants. With even one weekend of labeling commits on a known repo (say, the 50 most recent bug-fix commits in `tj/commander.js`'s history), I could have grid-searched the three weights against actual outcomes. The numbers in `risk-score.ts` are plausible; they should be defensible. Future work.

Everything else, I'd do the same way again. The MCP-first positioning, the plugin seams, the SQLite-backed everything, the 3-agent separation — these have all paid off across phases without forcing a meaningful rewrite. The build felt linear, not "ship something, then refactor halfway through" — which is itself a signal that the Phase 1 architectural decisions were closer to right than to wrong.
