#!/usr/bin/env node
import { Command } from 'commander';
import { runEstimate } from './commands/estimate.js';
import { runIndexCommand } from './commands/index-command.js';
import { runInit } from './commands/init.js';
import { runWhyCommand } from './commands/why.js';
import { logger } from '../utils/logger.js';

const program = new Command();

program
  .name('gitwhy')
  .description('Persistent memory for AI coding agents over your git history.')
  .version('0.0.1');

program
  .command('ping')
  .description('Health-check: prints a pong response')
  .option('-m, --message <text>', 'optional echo message')
  .action((opts: { message?: string }) => {
    const echo = opts.message ? ` (echo: ${opts.message})` : '';
    process.stdout.write(`pong from gitwhy v0.0.1${echo}\n`);
  });

program
  .command('init')
  .description('Initialize gitwhy in the current repository (creates .gitwhy/)')
  .option('--force', 'overwrite existing config', false)
  .action(async (opts: { force?: boolean }) => {
    const result = await runInit({
      cwd: process.cwd(),
      ...(opts.force !== undefined && { force: opts.force }),
    });
    if (result.created) {
      process.stdout.write(`✓ initialized gitwhy at ${result.path}\n`);
    } else {
      process.stdout.write(`gitwhy already initialized at ${result.path}\n`);
    }
    process.stdout.write(`  commits in repo: ${result.diagnostics.totalCommits}\n`);
    for (const w of result.warnings) {
      process.stdout.write(`  ⚠ ${w}\n`);
    }
  });

program
  .command('estimate')
  .description('Dry-run cost estimation for indexing the current repo')
  .action(async () => {
    const result = await runEstimate({ cwd: process.cwd() });
    process.stdout.write(`\nEstimate for ${result.totalCommits} commits (model: ${result.enrichmentModel})\n\n`);
    process.stdout.write('Category       Count   LLM calls   Tokens (prompt/completion)   Est. cost\n');
    process.stdout.write('-'.repeat(85) + '\n');
    for (const c of result.byCategory) {
      const tokens = `${c.estimatedPromptTokens}/${c.estimatedCompletionTokens}`;
      process.stdout.write(
        `${c.category.padEnd(15)}${String(c.count).padEnd(8)}${String(c.llmCallsPlanned).padEnd(12)}${tokens.padEnd(29)}$${c.estimatedUsd.toFixed(4)}\n`,
      );
    }
    process.stdout.write('-'.repeat(85) + '\n');
    process.stdout.write(
      `${'TOTAL'.padEnd(15)}${String(result.totalCommits).padEnd(8)}${String(result.grandTotal.llmCallsPlanned).padEnd(12)}${`${result.grandTotal.promptTokens}/${result.grandTotal.completionTokens}`.padEnd(29)}$${result.grandTotal.usd.toFixed(4)}\n`,
    );
  });

program
  .command('index')
  .description('Index the repository: parse commits, enrich with AI, store in .gitwhy/')
  .option('--provider <name>', 'LLM provider (openai|mock)', 'openai')
  .option('--model <name>', 'override the enrichment model')
  .option('--budget <usd>', 'stop indexing if cost exceeds this many USD', parseFloat)
  .action(async (opts: { provider?: 'openai' | 'mock'; model?: string; budget?: number }) => {
    await runIndexCommand({
      cwd: process.cwd(),
      ...(opts.provider !== undefined && { provider: opts.provider }),
      ...(opts.model !== undefined && { model: opts.model }),
      ...(opts.budget !== undefined && { budgetUsd: opts.budget }),
    });
  });

program
  .command('why <question...>')
  .description('Ask a question about the indexed git history')
  .option('-k, --top-k <n>', 'commits to retrieve for context (default 5)', (v) => parseInt(v, 10))
  .option('--min-confidence <n>', 'min cosine similarity to attempt synthesis (default 0.4)', parseFloat)
  .action(async (questionParts: string[], opts: { topK?: number; minConfidence?: number }) => {
    const question = questionParts.join(' ').trim();
    if (!question) throw new Error('Provide a question, e.g. `gitwhy why "..."`');

    const result = await runWhyCommand({
      cwd: process.cwd(),
      question,
      ...(opts.topK !== undefined && { topK: opts.topK }),
      ...(opts.minConfidence !== undefined && { minConfidence: opts.minConfidence }),
    });

    process.stdout.write(`\n${result.answer}\n\n`);
    if (result.citations.length > 0) {
      process.stdout.write('Citations:\n');
      for (const c of result.citations) {
        const date = c.date.toISOString().slice(0, 10);
        process.stdout.write(
          `  [${c.shortHash}] ${date} by ${c.authorName}  (similarity: ${c.score.toFixed(2)})\n`,
        );
        if (c.enrichedSummary) {
          process.stdout.write(`    ${c.enrichedSummary}\n`);
        }
      }
      process.stdout.write('\n');
    }
    process.stdout.write(
      `Confidence: ${(result.confidence * 100).toFixed(0)}%  retrieved ${result.retrieved} commits${result.cached ? ', cached' : ''}\n`,
    );
    if (result.idk) {
      process.stdout.write('Result flagged as low-confidence ("I don\'t know" mode).\n');
    }
  });

program
  .command('mcp')
  .description('Start the gitwhy MCP server on stdio')
  .action(async () => {
    const { createServer } = await import('../mcp/server.js');
    const { StdioServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/stdio.js'
    );
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('MCP server connected on stdio');
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(message);
  process.exit(1);
});
