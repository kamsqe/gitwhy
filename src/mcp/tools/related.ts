import { z } from 'zod';
import type { McpTool, McpToolContext, McpToolResponse } from './types.js';

const relatedInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe('Repository-relative file path (e.g. "src/payment/processPayment.ts").'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('Max number of related files to return. Default 10.'),
  minCoCommits: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Minimum co-occurrence threshold. Default 2.'),
});

type RelatedInput = z.infer<typeof relatedInputSchema>;

export const relatedTool: McpTool<RelatedInput> = {
  name: 'gitwhy.related',
  description:
    'Return files that historically change together with the target file (co-change analysis). ' +
    'Use BEFORE the user starts editing a file to surface "you\'ll probably also need to update X". ' +
    'High forward-confidence (close to 1.0) means the related file is almost always changed alongside the ' +
    'target — likely a test file, a co-evolving module, or a tightly coupled dependency. ' +
    'Triggers: "what files change with X?", "what should I also look at if I edit Y?", "show me code coupled to Z".',
  inputSchema: relatedInputSchema,
  async handler(input: RelatedInput, ctx: McpToolContext): Promise<McpToolResponse> {
    const runtime = ctx.runtime.get();
    const options = {
      ...(input.limit !== undefined && { limit: input.limit }),
      ...(input.minCoCommits !== undefined && { minCoCommits: input.minCoCommits }),
    };
    const related = runtime.insight.relatedFiles(input.path, options);

    if (related.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No co-changing files found for "${input.path}". Either the path has no indexed history, or no other files have co-changed at least ${input.minCoCommits ?? 2} times.`,
          },
        ],
      };
    }

    const baseCommits = related[0]!.thisFileCommits;
    const lines: string[] = [];
    lines.push(
      `Files that change with "${input.path}" (in ${baseCommits} commits of indexed history):`,
    );
    lines.push('');
    for (const r of related) {
      lines.push(
        `  ${r.path}  —  ${r.coCommits}/${baseCommits} commits  (confidence ${(r.forwardConfidence * 100).toFixed(0)}%)`,
      );
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
};
