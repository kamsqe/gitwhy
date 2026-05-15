import { simpleGit } from 'simple-git';
import { z } from 'zod';
import type { McpTool, McpToolContext, McpToolResponse } from './types.js';

const contextForPrInputSchema = z
  .object({
    branch: z
      .string()
      .min(1)
      .optional()
      .describe('Branch or ref to analyze. If provided, files are derived from `git diff <base>...<branch> --name-only`.'),
    files: z
      .array(z.string().min(1))
      .max(50)
      .optional()
      .describe('Explicit list of repository-relative paths to analyze, used when no branch is given.'),
    base: z
      .string()
      .min(1)
      .optional()
      .describe('Base branch to diff against. Default "main".'),
  })
  .refine((v) => v.branch !== undefined || (v.files !== undefined && v.files.length > 0), {
    message: 'Provide either `branch` or a non-empty `files` array.',
  });

type ContextForPrInput = z.infer<typeof contextForPrInputSchema>;

export const contextForPrTool: McpTool<ContextForPrInput> = {
  name: 'gitwhy.context_for_pr',
  description:
    'Generate review-ready historical context for the files changed in a pull request or branch. For each ' +
    'changed file: surface risk level, top contributors, recent commits, and co-changing files. ' +
    'Use when the user is reviewing a PR, opening a review session, or asking "what should I look at first ' +
    'in this PR?". Can accept either a branch name (we diff against `base`, default "main") or an explicit ' +
    'list of paths.',
  inputSchema: contextForPrInputSchema,
  async handler(input: ContextForPrInput, ctx: McpToolContext): Promise<McpToolResponse> {
    const runtime = ctx.runtime.get();
    const files = input.files ?? (await listChangedFiles(runtime.cwd, input.base ?? 'main', input.branch!));

    if (files.length === 0) {
      return {
        content: [{ type: 'text', text: 'No changed files detected.' }],
      };
    }

    const lines: string[] = [];
    lines.push(`PR review context — ${files.length} file(s):`);
    lines.push('');

    const byRisk: { high: string[]; medium: string[]; low: string[]; unknown: string[] } = {
      high: [],
      medium: [],
      low: [],
      unknown: [],
    };

    for (const path of files.slice(0, 40)) {
      const risk = runtime.insight.riskScore(path);
      if (risk.inputs.totalCommits === 0) {
        byRisk.unknown.push(path);
        continue;
      }
      byRisk[risk.level].push(path);

      lines.push(`## ${path}`);
      lines.push(`Risk: ${risk.level.toUpperCase()}  (bus factor ${risk.inputs.busFactor}, ${risk.inputs.recentCommits90d} recent commits)`);
      for (const reason of risk.reasons.slice(0, 3)) {
        lines.push(`  - ${reason}`);
      }

      const related = runtime.insight.relatedFiles(path, { limit: 3 });
      if (related.length > 0) {
        lines.push('Co-changes with:');
        for (const r of related) {
          lines.push(`  - ${r.path} (${(r.forwardConfidence * 100).toFixed(0)}%)`);
        }
      }
      lines.push('');
    }

    lines.push('---');
    lines.push(
      `Risk summary: ${byRisk.high.length} high, ${byRisk.medium.length} medium, ${byRisk.low.length} low, ${byRisk.unknown.length} unindexed.`,
    );
    if (byRisk.high.length > 0) {
      lines.push(`Review these FIRST: ${byRisk.high.join(', ')}.`);
    }

    return { content: [{ type: 'text', text: lines.join('\n').trim() }] };
  },
};

async function listChangedFiles(cwd: string, base: string, branch: string): Promise<string[]> {
  const git = simpleGit({ baseDir: cwd });
  try {
    const out = await git.raw(['diff', `${base}...${branch}`, '--name-only']);
    return out
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch (err) {
    throw new Error(
      `Failed to diff ${base}...${branch}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
