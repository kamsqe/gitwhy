import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { GitWhyConfig } from './index.js';
import { defaultConfig } from './index.js';

const ConfigSchema = z.object({
  version: z.literal(1),
  provider: z.object({
    llm: z.string(),
    indexingModel: z.string(),
    queryModel: z.string(),
    embeddingModel: z.string(),
  }),
  scope: z.object({
    since: z.string().optional(),
    until: z.string().optional(),
    branches: z.array(z.string()).optional(),
    pathInclude: z.array(z.string()).optional(),
    pathExclude: z.array(z.string()).optional(),
  }),
  budget: z.object({
    maxUsd: z.number().nonnegative().optional(),
    maxTokens: z.number().int().nonnegative().optional(),
  }),
  storage: z.object({
    indexDir: z.string(),
    vectorBackend: z.string(),
  }),
});

export interface GitWhyPaths {
  readonly root: string;
  readonly configFile: string;
  readonly indexDir: string;
  readonly commitsDb: string;
  readonly statsFile: string;
  readonly tracesDir: string;
}

export function resolvePaths(cwd: string, config: GitWhyConfig = defaultConfig): GitWhyPaths {
  const root = join(cwd, config.storage.indexDir);
  return {
    root,
    configFile: join(root, 'config.json'),
    indexDir: join(root, 'index'),
    commitsDb: join(root, 'index', 'commits.sqlite'),
    statsFile: join(root, 'stats.json'),
    tracesDir: join(root, 'traces'),
  };
}

export function loadConfig(cwd: string): GitWhyConfig {
  const paths = resolvePaths(cwd);
  if (!existsSync(paths.configFile)) return defaultConfig;
  const raw = JSON.parse(readFileSync(paths.configFile, 'utf8')) as unknown;
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid gitwhy config at ${paths.configFile}: ${result.error.message}`);
  }
  return result.data as GitWhyConfig;
}

export function writeConfig(cwd: string, config: GitWhyConfig): void {
  const paths = resolvePaths(cwd, config);
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(paths.indexDir, { recursive: true });
  writeFileSync(paths.configFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function ensureDirs(cwd: string, config: GitWhyConfig = defaultConfig): GitWhyPaths {
  const paths = resolvePaths(cwd, config);
  for (const dir of [paths.root, paths.indexDir, dirname(paths.commitsDb)]) {
    mkdirSync(dir, { recursive: true });
  }
  return paths;
}
