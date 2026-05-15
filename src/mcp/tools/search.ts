import { z } from 'zod';
import { getCommit } from '../../storage/commits-repo.js';
import type { McpTool, McpToolContext, McpToolResponse } from './types.js';

const searchInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe('Free-text search query. Semantic similarity is used to rank results.'),
  topK: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('Max number of commits to return. Default 10.'),
});

type SearchInput = z.infer<typeof searchInputSchema>;

export const searchTool: McpTool<SearchInput> = {
  name: 'gitwhy.search',
  description:
    'Semantic search over indexed commits. Returns a ranked list of commit hashes and their AI-enriched ' +
    'summaries matching the query. Use this as a fallback when no other tool matches a more specific intent, ' +
    'or when the user wants to scan multiple potentially relevant commits rather than a synthesized answer.',
  inputSchema: searchInputSchema,
  async handler(input: SearchInput, ctx: McpToolContext): Promise<McpToolResponse> {
    const runtime = ctx.runtime.get();
    const topK = input.topK ?? 10;

    const embedResult = await runtime.llm.embed({
      input: input.query,
      model: runtime.config.provider.embeddingModel,
    });
    const queryVec = embedResult.embeddings[0];
    if (!queryVec) {
      return {
        content: [{ type: 'text', text: 'Failed to embed the query.' }],
        isError: true,
      };
    }

    const hits = await runtime.vectorStore.query(Array.from(queryVec), { topK });
    if (hits.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No matching commits found. Run `gitwhy index` first, or try a different query.',
          },
        ],
      };
    }

    const lines: string[] = [];
    lines.push(`Top ${hits.length} commits for "${input.query}":`);
    lines.push('');
    for (const hit of hits) {
      const stored = getCommit(runtime.db, hit.id);
      if (!stored) continue;
      const date = stored.committedAt.toISOString().slice(0, 10);
      lines.push(
        `[${stored.shortHash}] ${date} by ${stored.authorName}  (similarity: ${hit.score.toFixed(2)})`,
      );
      const summary = stored.enrichedSummary ?? stored.message.split('\n', 1)[0];
      lines.push(`  ${summary}`);
      lines.push('');
    }

    return { content: [{ type: 'text', text: lines.join('\n').trim() }] };
  },
};
