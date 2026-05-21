import { serve } from '@hono/node-server';
import { createApp } from '../../server/app.js';
import { c } from '../../utils/colors.js';
import { logger } from '../../utils/logger.js';

export interface ServeCommandOptions {
  readonly cwd: string;
  readonly port?: number;
  readonly host?: string;
  readonly allowedOrigins?: readonly string[];
}

const DEFAULT_PORT = 3787;
const DEFAULT_HOST = '127.0.0.1';

/**
 * Start the gitwhy HTTP server on the local machine. The same backend
 * powering MCP tools and CLI commands is exposed as REST endpoints —
 * intended to be consumed by the web UI at gitwhy.pages.dev, but
 * also useful for any HTTP client.
 *
 * The server binds to 127.0.0.1 by default — never exposed publicly —
 * because it shells out to git, calls the LLM with the user's API key,
 * and reads from the local SQLite index.
 */
export function runServeCommand(options: ServeCommandOptions): Promise<void> {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;

  const app = createApp({
    cwd: options.cwd,
    ...(options.allowedOrigins !== undefined && { allowedOrigins: options.allowedOrigins }),
  });

  return new Promise<void>((resolve, reject) => {
    try {
      const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
        const url = `http://${info.address.includes(':') ? `[${info.address}]` : info.address}:${info.port}`;
        process.stdout.write(`${c.ok('✓')} gitwhy HTTP server listening on ${c.bold(url)}\n`);
        process.stdout.write(`  cwd: ${c.dim(options.cwd)}\n`);
        process.stdout.write(`  health: ${c.cyan(`${url}/api/health`)}\n`);
        process.stdout.write('  press Ctrl+C to stop\n');
      });

      const shutdown = (signal: string): void => {
        logger.info(`received ${signal}, shutting down`);
        server.close(() => resolve());
      };
      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
