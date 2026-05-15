import { z } from 'zod';
import type { McpTool, McpToolContext, McpToolResponse } from './types.js';

const whyInputSchema = z.object({
  question: z
    .string()
    .min(1)
    .describe('The natural-language question about the codebase history.'),
  topK: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('How many commits to retrieve for context. Default 5.'),
});

type WhyInput = z.infer<typeof whyInputSchema>;

export const whyTool: McpTool<WhyInput> = {
  name: 'gitwhy.why',
  description:
    'Answer a natural-language question about the repository\'s history using AI-enriched commit summaries. ' +
    'Use this when the user asks why a function, file, decision, or behavior exists; or why something was changed, ' +
    'reverted, or implemented a particular way. Returns an answer with cited commit hashes. ' +
    'Examples: "why does processPayment have a 30 second timeout?", "why was the auth middleware rewritten?".',
  inputSchema: whyInputSchema,
  async handler(input: WhyInput, ctx: McpToolContext): Promise<McpToolResponse> {
    const runtime = ctx.runtime.get();
    const result = await runtime.knowledge.ask(input.question, {
      ...(input.topK !== undefined && { topK: input.topK }),
    });

    const lines: string[] = [];
    lines.push(result.answer);
    lines.push('');

    if (result.citations.length > 0) {
      lines.push('Citations:');
      for (const c of result.citations) {
        const date = c.date.toISOString().slice(0, 10);
        lines.push(
          `  [${c.shortHash}] ${date} by ${c.authorName} (similarity: ${c.score.toFixed(2)})`,
        );
        if (c.enrichedSummary) {
          lines.push(`    ${c.enrichedSummary}`);
        } else {
          lines.push(`    message: ${c.originalMessage}`);
        }
      }
      lines.push('');
    }

    lines.push(
      `Confidence: ${(result.confidence * 100).toFixed(0)}%  (retrieved ${result.retrieved} commits${result.cached ? ', cached' : ''})`,
    );
    if (result.idk) {
      lines.push('Result flagged as low-confidence ("I don\'t know" mode).');
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  },
};
