import { existsSync } from 'node:fs';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { detectDefaultConfig } from '../config/index.js';
import { loadConfig, resolvePaths } from '../config/loader.js';
import type { GitWhyConfig } from '../config/index.js';
import { createMcpRuntimeFactory } from '../mcp/runtime.js';
import type { McpRuntimeFactory } from '../mcp/runtime.js';
import { loadDotEnv } from '../utils/env.js';
import { registerDiffRoutes } from './routes/diff.js';
import { registerGraphRoutes } from './routes/graph.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerIncidentRoutes } from './routes/incident.js';
import { registerIndexJobRoutes } from './routes/index-job.js';
import { registerInsightRoutes } from './routes/insight.js';
import { registerMiscRoutes } from './routes/misc.js';
import { registerOnboardingRoutes } from './routes/onboarding.js';
import { registerQueryRoutes } from './routes/query.js';

export interface ServerOptions {
  readonly cwd: string;
  /**
   * Allowed CORS origins. Defaults to `https://gitwhy.pages.dev` plus
   * any localhost origin (for local dev of the web UI).
   */
  readonly allowedOrigins?: readonly string[];
  /** Override runtime factory (used by tests). */
  readonly runtime?: McpRuntimeFactory;
}

/** Convenience shape exposed to route handlers via context. */
export interface AppContext {
  readonly cwd: string;
  readonly isInitialized: boolean;
  readonly config: GitWhyConfig;
  readonly runtime: McpRuntimeFactory;
}

declare module 'hono' {
  interface ContextVariableMap {
    appCtx: AppContext;
  }
}

const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  'https://gitwhy.pages.dev',
];

/**
 * Build the Hono HTTP app exposing GitWhy as REST endpoints.
 *
 * The same backend that powers MCP tools and CLI commands is exposed
 * over HTTP so a browser-based UI (or any other client) can drive it.
 * Designed to be run locally via `gitwhy serve` — the user's API key
 * and repo data never leave their machine.
 */
export function createApp(options: ServerOptions): Hono {
  loadDotEnv(options.cwd);

  const paths = resolvePaths(options.cwd);
  const isInitialized = existsSync(paths.commitsDb);
  const config = isInitialized ? loadConfig(options.cwd) : detectDefaultConfig();
  const runtime = options.runtime ?? createMcpRuntimeFactory({ cwd: options.cwd });

  const ctx: AppContext = {
    cwd: options.cwd,
    isInitialized,
    config,
    runtime,
  };

  const app = new Hono();

  app.use(
    '/api/*',
    cors({
      origin: (origin) => isAllowedOrigin(origin, options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS),
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Accept'],
      maxAge: 86400,
    }),
  );

  app.use('*', async (c, next) => {
    c.set('appCtx', ctx);
    await next();
  });

  registerHealthRoutes(app);
  registerInsightRoutes(app);
  registerQueryRoutes(app);
  registerMiscRoutes(app);
  registerIndexJobRoutes(app);
  registerDiffRoutes(app);
  registerIncidentRoutes(app);
  registerOnboardingRoutes(app);
  registerGraphRoutes(app);

  app.notFound((c) =>
    c.json(
      {
        error: 'Not found',
        hint: 'See GET /api/health for available endpoints.',
      },
      404,
    ),
  );

  app.onError((err, c) => {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  });

  return app;
}

function isAllowedOrigin(
  origin: string | undefined,
  allowed: readonly string[],
): string | null {
  if (!origin) return null;
  if (allowed.includes(origin)) return origin;
  // Always allow any localhost origin (dev mode of the web UI).
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?$/.test(origin)) {
    return origin;
  }
  // Allow Cloudflare Pages preview deploys: <branch>.gitwhy.pages.dev and
  // per-deployment hashes like <hash>.gitwhy.pages.dev. Production
  // gitwhy.pages.dev is covered by the static allow-list above.
  if (/^https:\/\/[a-z0-9-]+\.gitwhy\.pages\.dev$/.test(origin)) {
    return origin;
  }
  return null;
}

/**
 * Helper used by routes to assert the local repo has been indexed before
 * handing off to a runtime-dependent handler. Returns a Response if the
 * precondition fails, otherwise null.
 */
export function requireInitialized(ctx: AppContext): { ok: false; error: string } | { ok: true } {
  if (ctx.isInitialized) return { ok: true };
  return {
    ok: false,
    error: `gitwhy is not initialized at ${ctx.cwd}. Run \`gitwhy init\` and \`gitwhy index\` first.`,
  };
}
