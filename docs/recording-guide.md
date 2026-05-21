# Recording the Capstone Video — Step by Step

Practical, executable guide for recording the 2-3 minute capstone demo using the zustand index built during the stress test phase.

The earlier `docs/video-script.md` is the scripted "what to say" reference; **this document is the operational runbook**.

## Before you press record (15-20 min prep)

### Software setup

- **Recorder:** QuickTime Player → `File → New Screen Recording → Options → choose microphone`
- **Terminal font:** 18-20pt, big enough to read in a 1080p video
- **Browser tab open:** `https://gitwhy.pages.dev`
- **Two terminal tabs:**
  - Tab 1: `~/Desktop/projects/epam capstone project/zustand` (the demo target)
  - Tab 2: `~/Desktop/projects/epam capstone project/gitwhy` (for `pnpm test`)
- **Do Not Disturb on** (System Settings → Focus)

### Verify nothing broke since the stress test

```sh
# Set up alias for the gitwhy CLI (per terminal session)
gitwhy_path="/Users/kambarmirmanov/Desktop/projects/epam capstone project/gitwhy/dist/cli/index.js"
alias gitwhy="node \"$gitwhy_path\""

# In the zustand terminal:
gitwhy mcp-doctor --no-probe
# expected: 5 ok, 0 warn, 0 fail

# In the gitwhy terminal:
cd ~/Desktop/projects/epam\ capstone\ project/gitwhy
pnpm test 2>&1 | tail -5
# expected: 290 tests passed
```

If `mcp-doctor` shows the index is missing or stale, re-index:

```sh
gitwhy index --provider gemini --since "6 months ago" --budget 0.10
# ~17 min wall time, ~$0.05 cost
```

## The script — section by section

Speak conversationally. Pause for one beat between sections (silence is fine in editing).

### Section 1: Pitch + setup (0:00 – 0:50)

**Show:** browser at gitwhy.pages.dev, then switch to zustand terminal.

> "GitWhy is a persistent memory layer for AI coding agents over your git history. It pre-indexes a repository, enriches every commit with AI-inferred intent, and exposes the result over MCP so your editor's agent can answer 'why does this exist?' instantly, with citations."

```sh
gitwhy mcp-doctor --no-probe
```

> "I'm in a clone of zustand — a real state management library with 1,360 commits. mcp-doctor verifies the system is wired up: config valid, index populated, all nine MCP tools registered."

```sh
gitwhy status
```

> "Status shows what's actually in the index: 88 commits processed, 75 AI-enriched summaries, total cost of five cents to index six months of history on Gemini Flash Lite."

### Section 2: Headline Q&A (0:50 – 1:50)

> "Now the question that justifies the whole project. Git log won't tell you WHY a change happened. Let me ask GitWhy."

```sh
gitwhy why "why was the GitHub Actions workflow security hardened"
```

Wait ~5-10s for the response.

> "Seventy-nine percent confidence. The answer cites four separate commits across three different authors over six months — least-privilege permissions, credential persistence, commit-hash pinning, OIDC authentication. That's a multi-commit narrative GitWhy synthesized."

```sh
gitwhy why "how does authentication work in zustand"
```

> "Same question pattern, but about something zustand doesn't do. Notice — thirty-five percent confidence, flagged as 'I don't know' mode, and it explicitly says what kind of commit would be needed. GitWhy doesn't hallucinate. When the data isn't there, it tells you."

### Section 3: Insight tools (1:50 – 2:30)

> "Q&A needs an LLM. But the Insight agent — risk scoring, hotspots, co-change — is pure SQL over the indexed metadata. No LLM call, instant results."

```sh
gitwhy risk docs/reference/middlewares/persist.md
```

> "Medium risk on a docs file. Bus factor of one. Real ownership data extracted from indexed history."

```sh
gitwhy related docs/reference/middlewares/persist.md --min 1
```

> "Co-change shows which files historically move together. If you edit the persist docs, you'll probably touch redux, immer, devtools, and subscribe-with-selector — same fifty-percent co-change pattern."

```sh
gitwhy catchup --since "3 months ago"
```

> "Catchup gives a narrated summary of recent activity — forty commits across four categories. Three megas decomposed into per-module summaries, six micros clustered, seven bots filtered out."

### Section 4: Tests + close (2:30 – 3:00)

Switch to gitwhy terminal:

```sh
pnpm test 2>&1 | tail -5
```

> "Two hundred ninety tests across thirty-five files. Includes a dedicated adversarial suite: prompt injection, secrets in diffs, unicode hazards, SQL-injection-shaped inputs, concurrent queries."

Switch to browser, scroll gitwhy.pages.dev. Pause on the architecture page if you can see a Mermaid diagram.

> "Architecture blueprint, executive summary, and self-review are rendered as a polished site at gitwhy.pages.dev. MIT-licensed, open from day one, at github.com slash kamsqe slash gitwhy."

Stop recording: menu bar QuickTime stop, or `Cmd + Ctrl + Esc`.

## Editing (10-15 min)

Use iMovie (built-in), CapCut, or DaVinci Resolve.

- Cut leading + trailing silence
- Cut any pause >1 second
- If you re-said a sentence, keep the better take
- No transitions between sections — jump cuts read as confident
- 0.5s fade-in at start, 0.5s fade-out at end — that's the only effect
- Normalize audio (one-click in most editors)

**Export:** 1080p, mp4 (H.264), aim for 2:30 – 3:00 total runtime.

## Upload + link (5 min)

1. youtube.com/upload → drag mp4 in
2. **Title:** "GitWhy — Persistent memory for AI coding agents over your git history"
3. **Description:** paste README's one-paragraph pitch + GitHub URL
4. **Visibility: Unlisted** (not private, not public)
5. Save → Share → copy the watch URL
6. **Test the URL in an incognito browser window** — must play without sign-in
7. Paste the URL into:
   - `README.md` (replace `*(coming on launch)*` placeholder)
   - `Capstone_project_Kambar_Mirmanov.txt`
   - Optionally the Astro `index.mdx`

## Troubleshooting

| Symptom | Fix |
|---|---|
| `gitwhy why` returns 429 | Daily quota hit. Wait for UTC midnight or change `queryModel` in `.gitwhy/config.json` to `gemini-3.1-flash-lite` |
| Terminal text too small in recording | Bump font to 18-20pt before recording |
| Audio too quiet | Mic closer next time, or normalize in editing |
| QuickTime captured no audio | Options menu → Microphone → pick device |
| Mistakes in take 1 | Just re-record. Keep whichever take had the strongest headline `why` answer |
| Want to redo only one section | Cut that clip; re-record only that section; splice it in |

## Why this exact demo

The four commands chosen are the ones the stress test confirmed as production-quality:

- **`gitwhy why` Q1** — Real cross-commit synthesis at 79% confidence (Gemini Flash Lite, 4 commits / 3 authors / 6 months)
- **`gitwhy why` Q2 (negative)** — Proves the "I don't know" gate is honest, with 35% confidence + explicit explanation of what's missing
- **`gitwhy risk`** — Pure SQL, instant, surfaces real bus-factor patterns
- **`gitwhy related`** — Real co-change matrix from indexed metadata
- **`gitwhy catchup`** — Demonstrates mega-commit decomposition and micro-commit clustering in one output

These five commands together exercise the Archaeologist (indexing-time enrichment, visible in catchup's per-module summaries), the Knowledge agent (Q&A with citations), and the Insight agent (risk + related) — all three multi-agent layers in 90 seconds.
