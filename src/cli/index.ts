#!/usr/bin/env node
import { Command } from 'commander';
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

// Phase 2-4: init, index, why, risk, catchup, commit, related, context-for-pr,
// mcp-doctor, estimate. Stubs added as each feature lands.

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(message);
  process.exit(1);
});
