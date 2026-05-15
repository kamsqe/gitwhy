import { z } from 'zod';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { CommitCategory } from '../../indexer/types.js';
import type { McpTool, McpToolContext, McpToolResponse } from './types.js';

const catchupInputSchema = z.object({
  since: z
    .string()
    .min(1)
    .describe(
      'Time range expressed as either an ISO date (e.g. "2026-01-15") or a git-style relative period (e.g. "1 week ago", "3 days ago", "1 month ago").',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe('Max commits to summarize. Default 50.'),
});

type CatchupInput = z.infer<typeof catchupInputSchema>;

interface CatchupRow {
  hash: string;
  short_hash: string;
  author_name: string;
  committed_at: number;
  message: string;
  category: CommitCategory;
  enriched_summary: string | null;
}

export const catchupTool: McpTool<CatchupInput> = {
  name: 'gitwhy.catchup',
  description:
    'Summarize recent repository activity since a given time. Use when the user asks "what happened while ' +
    'I was away?", "what changed recently?", "show me this week\'s commits", or wants a digest of changes ' +
    'in a given period. Groups commits by module and highlights interesting changes (non-bot, non-merge).',
  inputSchema: catchupInputSchema,
  async handler(input: CatchupInput, ctx: McpToolContext): Promise<McpToolResponse> {
    const runtime = ctx.runtime.get();
    const limit = input.limit ?? 50;
    const sinceMs = parseSince(input.since);
    if (sinceMs === null) {
      return {
        content: [
          {
            type: 'text',
            text: `Could not parse "since" value "${input.since}". Use an ISO date or a relative period like "1 week ago".`,
          },
        ],
        isError: true,
      };
    }

    const rows = queryRecentCommits(runtime.db, sinceMs, limit);
    if (rows.length === 0) {
      return {
        content: [
          { type: 'text', text: `No commits indexed since ${new Date(sinceMs).toISOString().slice(0, 10)}.` },
        ],
      };
    }

    const byCategory = new Map<CommitCategory, CatchupRow[]>();
    for (const r of rows) {
      const list = byCategory.get(r.category) ?? [];
      list.push(r);
      byCategory.set(r.category, list);
    }

    const interesting = ['normal', 'mega', 'revert'] satisfies CommitCategory[];
    const noisy = ['merge', 'bot', 'formatting'] satisfies CommitCategory[];

    const lines: string[] = [];
    lines.push(
      `Catchup since ${new Date(sinceMs).toISOString().slice(0, 10)} — ${rows.length} commits across ${byCategory.size} categories.`,
    );
    lines.push('');

    for (const cat of interesting) {
      const list = byCategory.get(cat);
      if (!list || list.length === 0) continue;
      lines.push(`## ${cat} (${list.length})`);
      for (const r of list.slice(0, 10)) {
        const date = new Date(r.committed_at).toISOString().slice(0, 10);
        const summary = r.enriched_summary ?? r.message.split('\n', 1)[0];
        lines.push(`- [${r.short_hash}] ${date} ${r.author_name}: ${summary}`);
      }
      if (list.length > 10) lines.push(`  ...and ${list.length - 10} more`);
      lines.push('');
    }

    const noisyCounts = noisy
      .map((c) => ({ c, n: byCategory.get(c)?.length ?? 0 }))
      .filter((x) => x.n > 0);
    if (noisyCounts.length > 0) {
      const parts = noisyCounts.map((x) => `${x.n} ${x.c}`).join(', ');
      lines.push(`Plus: ${parts}.`);
    }

    return { content: [{ type: 'text', text: lines.join('\n').trim() }] };
  },
};

function queryRecentCommits(db: DatabaseType, sinceMs: number, limit: number): CatchupRow[] {
  return db
    .prepare(`
      SELECT hash, short_hash, author_name, committed_at, message, category, enriched_summary
      FROM commits
      WHERE committed_at >= ?
      ORDER BY committed_at DESC
      LIMIT ?
    `)
    .all(sinceMs, limit) as CatchupRow[];
}

const RELATIVE_PATTERN = /^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i;
const RELATIVE_MS: Record<string, number> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
  year: 31_536_000_000,
};

export function parseSince(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const isoTime = Date.parse(trimmed);
  if (!Number.isNaN(isoTime)) return isoTime;

  const match = RELATIVE_PATTERN.exec(trimmed);
  if (!match) return null;
  const amount = Number.parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();
  const ms = RELATIVE_MS[unit];
  if (ms === undefined) return null;
  return Date.now() - amount * ms;
}
