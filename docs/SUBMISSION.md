# EPAM Capstone Submission Pre-Flight

A single-page checklist to walk through the day you upload `Capstone_project_Kambar_Mirmanov.txt`. Tick every box. If any one is unchecked, do not submit yet.

## 1. Required deliverables in the repo

Every item below must exist at a fixed, grader-findable path:

- [ ] `README.md` — MCP setup as headline, video link at top, live site link
- [ ] `LICENSE` — MIT
- [ ] `AGENTS.md` — agent-friendly orientation
- [ ] `docs/architecture.md` — Architecture Blueprint (with Mermaid)
- [ ] `docs/executive-summary.md` — 1-2 pages, business value framing
- [ ] `docs/self-review.md` — substantive trade-off commentary
- [ ] `docs/video-script.md` — for reference / reproducibility
- [ ] `tests/` — automated test suite (positive + negative + adversarial)
- [ ] `web/` — Astro site sources
- [ ] Live site URL: `https://gitwhy.pages.dev`

## 2. Capability verification (run these before submitting)

```sh
cd path/to/gitwhy
pnpm install
pnpm typecheck     # must pass
pnpm lint          # must pass
pnpm test          # all 279+ must pass
pnpm build         # dist/ produced
pnpm --filter gitwhy-web build   # web/dist/ produced
```

End-to-end smoke test:

```sh
rm -rf .gitwhy
node dist/cli/index.js init
node dist/cli/index.js status            # initialized=false expected
GITWHY_USE_MOCK_LLM=1 node dist/cli/index.js index --provider mock
node dist/cli/index.js status            # 100% coverage
node dist/cli/index.js mcp-doctor --no-probe   # 5 ok, 0 warn, 0 fail expected
node dist/cli/index.js risk src/cli/index.ts
node dist/cli/index.js related src/cli/index.ts
node dist/cli/index.js why "what does this project do"
rm -rf .gitwhy
```

If any of these throws, the submission isn't ready.

## 3. Live site verification

- [ ] Visit `https://gitwhy.pages.dev` in an incognito window — page loads, sidebar renders, all three deliverable doc pages visible.
- [ ] The architecture page's Mermaid diagrams render (they're inline SVG; not just code blocks).
- [ ] Internal links work; external GitHub links resolve.

If the site doesn't deploy, the workflow logs at `https://github.com/kamsqe/gitwhy/actions` will say why. Most common: the `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` repo secret is missing.

## 4. Video demo

- [ ] Recorded to spec from `docs/video-script.md` — 2-3 minutes, MCP split-screen headline + supplementary
- [ ] Uploaded to YouTube **unlisted** (not private)
- [ ] Watch URL works in a Chrome incognito window
- [ ] Linked at the top of `README.md`

## 5. The submission file

Create `Capstone_project_Kambar_Mirmanov.txt` outside the repo (it's not committed). Content:

```
Your @epam.com email
https://github.com/kamsqe/gitwhy
https://www.youtube.com/watch?v=...     (the unlisted video link)
```

No prose. Three lines. The platform parses them.

## 6. Submission strategy (per the EPAM Q&A 2026-05-13)

The upload is one-shot, but the committee reviews submissions in a later batch. The repo and video URLs inside the .txt remain editable; the committee grades whatever lives at those URLs when they actually start the review (not the day of upload).

So:

1. **Submit the .txt as soon as eligible.** Don't wait to finish polishing the repo first.
2. **Tag a `submission` git tag** at the moment of upload, so the submission-day state can always be reproduced if it matters: `git tag submission && git push --tags`.
3. **Keep iterating** on the repo, site, and video between submission and grading. If you find a bug or improve a doc, push it.

## 7. Final pre-flight

- [ ] Test-upload the `.txt` file to the EPAM platform once *before* the deadline to verify the platform accepts it. If the platform rejects for "size" or "suspicious links", the fallback is to zip the file or print-to-PDF and upload that instead. Discover this hours-before-deadline, not minutes-before.

## 8. After upload

- [ ] Verify the repo and video links work for someone who is not signed into your accounts (incognito browser test).
- [ ] Save a copy of the uploaded `.txt` outside the repo (Google Drive / Notes / etc.) — the EPAM platform doesn't always let you re-download.
- [ ] Take a screenshot of the upload confirmation page.

## Rubric coverage map

| Rubric line | Artifact |
|---|---|
| Working multi-agent system | `src/agents/{archaeologist,knowledge,insight}/`, demoed in video Scene 1+2 |
| Code delivery (structure + comments) | `src/`, `tests/`, `docs/architecture.md` §1-12 |
| LLM Behavior Tests — normal flow | `tests/unit/indexer.test.ts`, `tests/unit/knowledge-agent.test.ts`, `tests/unit/cli-commands.test.ts` |
| LLM Behavior Tests — edge + adversarial | `tests/unit/adversarial.test.ts` (19 named cases) |
| Video Demo — live + tests + self-review | per `docs/video-script.md` |
| +10 UX & Presentation | Polished CLI (colored output, `mcp-doctor`, `status`) + live Astro site + MCP-as-the-UI editor demo |
| +10 Data Quality | Pre-indexed demo data; curated fixtures; secret detection (12 patterns); "I don't know" gating; `gitwhy estimate` cost transparency |
| +10 Code Excellence | Plugin seams from Phase 1; strict TS; CI matrix Node 20+22; `docs/self-review.md` substantive trade-off commentary |
| Architecture Blueprint | `docs/architecture.md` |
| Self-Review | `docs/self-review.md` |
| Executive Summary | `docs/executive-summary.md` |
| README with setup | `README.md` |
| Test Suite | `tests/` (279+ tests across 33 files) |
