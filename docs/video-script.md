# Video Demo Script

**Target length:** 2-3 minutes total.
**Format:** Screen recording with voiceover. 1080p, mp4, upload to YouTube unlisted, link the watch URL in `Capstone_project_Kambar_Mirmanov.txt`.

The video has two parts: a 60-second headline scene (the MCP split-screen) and 60-90s of supplementary clips. Speak conversationally; this is *not* a slide deck.

---

## Pre-recording setup

1. **Have the gitwhy repo open in two side-by-side editors:**
   - **Left:** Cursor (or Claude Code) with NO MCP server connected. Plain.
   - **Right:** Same editor, with `gitwhy` MCP server connected. Verified working via `gitwhy mcp-doctor`.
2. **Pre-index a real repo with substantive history.** The gitwhy repo itself works (5+ commits), but `tj/commander.js` cloned + indexed produces better demo material. Indexed against Gemini, with `GITWHY_USE_MOCK_LLM=1` disabled.
3. **Have a single question ready** that has a strong answer in the indexed history. Examples that work well:
   - "Why does this file have a 30-second timeout?"
   - "Why was the auth middleware rewritten?"
   - "What does the indexer's mega-commit decomposer do?"
4. **Test run once** with screen recording off, asking the agent the question on both sides, to confirm the right side gives a substantially better answer.
5. **Close all unrelated browser tabs and notifications.** OBS or QuickTime Player for recording.

---

## Scene 1 — Headline split-screen (60 seconds)

**[0:00–0:05]** *Cold open. No title card.*

> Voiceover: "Every developer wastes hours understanding unfamiliar code. The answers live in git history. The commit messages don't."

**[0:05–0:20]** *Left pane focus. User types in the editor's chat: "Why does this file have a 30-second timeout?"*

> Voiceover: "Without GitWhy, the AI editor reads the current file and guesses. It might say something like 'looks like a timeout to prevent hanging requests.' True, but generic, no source."

**[0:20–0:50]** *Right pane focus. Same question typed in. The agent auto-invokes `gitwhy.why`. The response shows up with a citation like `[abc1234]`.*

> Voiceover: "With GitWhy connected as an MCP server, the same agent gets the real answer instantly — with a citation. 'Added in commit abc1234 because Stripe webhooks were timing out on accounts with more than 100 pending invoices.' Specific, sourced, useful."

**[0:50–1:00]** *Closing card: `npx gitwhy init && npx gitwhy index` + a 3-line JSON snippet for MCP config.*

> Voiceover: "Three commands and three lines of config. GitWhy indexes once, then your editor's agent gets persistent memory for every session after."

---

## Scene 2 — Supplementary clips (60-90 seconds)

Short, punchy. No long voiceover; each clip needs <15s of narration.

**[1:00–1:15]** *Terminal: `gitwhy init` then `gitwhy estimate` showing the cost table.*

> Voiceover: "GitWhy never indexes without showing the projected cost first."

**[1:15–1:30]** *Terminal: `gitwhy index` running, progress messages streaming. Shows enriched=N, errors=0, cost=$X.X.*

> Voiceover: "Indexing categorizes every commit, clusters micro-commits, decomposes mega-commits, and scrubs secrets from diffs before any cloud call."

**[1:30–1:45]** *Terminal: `gitwhy risk src/payment.ts` showing risk level + reasons.*

> Voiceover: "The Insight agent runs pure SQL over the indexed metadata. Bus factor, hotspots, ghost code, co-change. No LLM needed."

**[1:45–2:00]** *Terminal: `pnpm test` running, finishing with "279 tests passed". Then `gitwhy mcp-doctor` showing 5 ok, 0 warn, 0 fail.*

> Voiceover: "Two hundred seventy-nine tests including a dedicated adversarial suite — prompt injection, secrets, unicode hazards, SQL-injection-shaped inputs. The mcp-doctor command verifies the wiring."

**[2:00–2:15]** *Browser tab: the Astro site at kamsqe.github.io/gitwhy, scrolling through architecture page with Mermaid diagrams.*

> Voiceover: "Architecture blueprint, executive summary, and self-review are all in the repo and rendered on the live site. MIT licensed and open from day one."

**[2:15–2:20]** *End card: github.com/kamsqe/gitwhy + live site URL.*

> Voiceover: "GitWhy. Persistent memory for AI coding agents. github.com slash kamsqe slash gitwhy."

---

## Post-production checklist

- [ ] Trim leading/trailing silence
- [ ] Normalize audio (quiet voiceover sounds amateurish)
- [ ] Add a single fade-in at the very start and fade-out at the end; no transitions between scenes (jump cuts read as confident)
- [ ] Upload to YouTube **unlisted** (not private — the committee needs to view it without an account)
- [ ] Verify the share link works in a Chrome incognito window
- [ ] Paste the link into `Capstone_project_Kambar_Mirmanov.txt`

## Backup recordings

Record one full take, then re-record only the headline scene (Scene 1) two more times — that's the one most worth getting right. Keep the best Scene 1 and the supplementary scenes from your first take. Editing in iMovie / DaVinci Resolve takes 20-30 minutes.
