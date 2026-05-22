import { z } from 'zod';
import { getCommit } from '../../storage/commits-repo.js';
import type { McpRuntimeFactory } from '../runtime.js';
import type { McpTool, McpToolContext, McpToolResponse } from './types.js';

/**
 * One ranked hit in a semantic-search response. Same shape as a citation
 * in /api/why — kept aligned so the UI can render both with the same card.
 */
export interface SearchHit {
  commitHash: string;
  shortHash: string;
  score: number;
  date: string;
  authorName: string;
  originalMessage: string;
  enrichedSummary: string | null;
  /**
   * The indexer's category for this commit. Surfaced so the UI can render
   * mega-commits with the structured per-module decomposition rather than
   * the flat concatenated summary.
   */
  category: string;
}

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
    const hits = await runSearch(input, ctx.runtime);
    if (hits === 'embed_failed') {
      return {
        content: [{ type: 'text', text: 'Failed to embed the query.' }],
        isError: true,
      };
    }
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
    return { content: [{ type: 'text', text: formatHits(input.query, hits) }] };
  },
};

/**
 * Structured semantic search. Exposed so HTTP routes can render the same
 * data as cards without parsing the MCP tool's text output. Returns the
 * sentinel string 'embed_failed' when the embedding call itself failed
 * (rare — usually a misconfigured provider), or an empty array when the
 * vector store has no matches.
 */
export async function runSearch(
  input: SearchInput,
  runtimeFactory: McpRuntimeFactory,
): Promise<SearchHit[] | 'embed_failed'> {
  const runtime = runtimeFactory.get();
  const topK = input.topK ?? 10;

  const embedResult = await runtime.llm.embed({
    input: input.query,
    model: runtime.config.provider.embeddingModel,
  });
  const queryVec = embedResult.embeddings[0];
  if (!queryVec) return 'embed_failed';

  const hits = await runtime.vectorStore.query(Array.from(queryVec), { topK });
  const results: SearchHit[] = [];
  for (const hit of hits) {
    const stored = getCommit(runtime.db, hit.id);
    if (!stored) continue;
    results.push({
      commitHash: stored.hash,
      shortHash: stored.shortHash,
      score: hit.score,
      date: stored.committedAt.toISOString(),
      authorName: stored.authorName,
      originalMessage: stored.message,
      enrichedSummary: stored.enrichedSummary,
      category: stored.category,
    });
  }
  return results;
}

function formatHits(query: string, hits: SearchHit[]): string {
  const lines: string[] = [];
  lines.push(`Top ${hits.length} commits for "${query}":`);
  lines.push('');
  for (const h of hits) {
    const date = h.date.slice(0, 10);
    lines.push(
      `[${h.shortHash}] ${date} by ${h.authorName}  (similarity: ${h.score.toFixed(2)})`,
    );
    const summary = h.enrichedSummary ?? h.originalMessage.split('\n', 1)[0];
    lines.push(`  ${summary}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}
