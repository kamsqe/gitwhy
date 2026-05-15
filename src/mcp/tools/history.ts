import { z } from 'zod';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { CommitCategory } from '../../indexer/types.js';
import type { McpTool, McpToolContext, McpToolResponse } from './types.js';

const historyInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe('Repository-relative file or directory path (e.g. "src/payment/processPayment.ts" or "src/api/").'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Max commits to return. Default 20, most recent first.'),
});

type HistoryInput = z.infer<typeof historyInputSchema>;

interface HistoryRow {
  hash: string;
  short_hash: string;
  author_name: string;
  committed_at: number;
  message: string;
  category: CommitCategory;
  enriched_summary: string | null;
}

export const historyTool: McpTool<HistoryInput> = {
  name: 'gitwhy.history',
  description:
    'Return a narrative timeline of commits that touched a specific file or directory, with AI-enriched ' +
    'summaries where available. Use when the user wants to understand how a file evolved over time, who ' +
    'has worked on it, or what decisions shaped its current form. ' +
    'Examples: "show me the history of src/payment.ts", "how has the auth module changed?".',
  inputSchema: historyInputSchema,
  async handler(input: HistoryInput, ctx: McpToolContext): Promise<McpToolResponse> {
    const runtime = ctx.runtime.get();
    const limit = input.limit ?? 20;

    const rows = queryFileHistory(runtime.db, input.path, limit);

    if (rows.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No indexed commits found for path "${input.path}". The path may not exist in the indexed history, or indexing may not be complete.`,
          },
        ],
      };
    }

    const lines: string[] = [];
    lines.push(`History for "${input.path}" (${rows.length} commits, most recent first):`);
    lines.push('');
    for (const r of rows) {
      const date = new Date(r.committed_at).toISOString().slice(0, 10);
      const firstLine = r.message.split('\n', 1)[0];
      lines.push(`[${r.short_hash}] ${date} by ${r.author_name} (${r.category})`);
      lines.push(`  message: ${firstLine}`);
      if (r.enriched_summary) {
        lines.push(`  inferred: ${r.enriched_summary}`);
      }
      lines.push('');
    }

    return { content: [{ type: 'text', text: lines.join('\n').trim() }] };
  },
};

function queryFileHistory(db: DatabaseType, path: string, limit: number): HistoryRow[] {
  const normalized = path.replace(/\\/g, '/');
  const pattern = normalized.endsWith('/') ? `${normalized}%` : normalized;
  return db
    .prepare(`
      SELECT DISTINCT c.hash, c.short_hash, c.author_name, c.committed_at, c.message, c.category, c.enriched_summary
      FROM commits c
      INNER JOIN commit_files f ON f.commit_hash = c.hash
      WHERE f.path = @exact OR f.path LIKE @pattern
      ORDER BY c.committed_at DESC
      LIMIT @limit
    `)
    .all({ exact: normalized, pattern, limit }) as HistoryRow[];
}
