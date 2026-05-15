import { z } from 'zod';
import type { McpTool, McpToolContext, McpToolResponse } from './types.js';

const riskInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe('Repository-relative file path to assess (e.g. "src/payment/processPayment.ts").'),
});

type RiskInput = z.infer<typeof riskInputSchema>;

export const riskTool: McpTool<RiskInput> = {
  name: 'gitwhy.risk',
  description:
    'Compute a risk assessment (LOW / MEDIUM / HIGH) for a specific file. Combines bus factor, ghost-code ' +
    'status, and hotspot intensity into a single score with human-readable reasons. ' +
    'Use this BEFORE suggesting edits to a file, when reviewing a PR, or when the user asks "is this file risky?" ' +
    'or "who owns this code?". Returns reasons that surface single-owner risk, departed contributors, and ' +
    'recent churn velocity.',
  inputSchema: riskInputSchema,
  async handler(input: RiskInput, ctx: McpToolContext): Promise<McpToolResponse> {
    const runtime = ctx.runtime.get();
    const result = runtime.insight.riskScore(input.path);

    if (result.inputs.totalCommits === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No indexed history for "${input.path}". The file may not exist or may not have been indexed yet.`,
          },
        ],
      };
    }

    const lines: string[] = [];
    lines.push(
      `Risk: ${result.level.toUpperCase()} (score ${result.score.toFixed(2)})  —  ${input.path}`,
    );
    lines.push('');
    lines.push('Reasons:');
    for (const reason of result.reasons) {
      lines.push(`  • ${reason}`);
    }
    lines.push('');
    lines.push(
      `Stats: bus factor ${result.inputs.busFactor}, ${result.inputs.contributorCount} total contributors, ` +
        `${result.inputs.totalCommits} commits, ${result.inputs.recentCommits90d} in the last 90 days.`,
    );

    const bus = runtime.insight.busFactor(input.path);
    if (bus.contributors.length > 0) {
      lines.push('');
      lines.push('Top contributors:');
      for (const c of bus.contributors.slice(0, 5)) {
        const date = c.lastCommit.toISOString().slice(0, 10);
        lines.push(
          `  ${c.authorName} — ${c.sharePercent.toFixed(0)}% of changes, ${c.commits} commits, last touched ${date}`,
        );
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
};
