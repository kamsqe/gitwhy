import { existsSync } from 'node:fs';
import { loadConfig, resolvePaths } from '../../config/loader.js';
import { registerBuiltinTools } from '../../mcp/tools/index.js';
import { listTools } from '../../mcp/tools/registry.js';
import { resolveLlmFromEnv } from '../../mcp/runtime.js';
import { loadDotEnv } from '../../utils/env.js';
import { countCommitEmbeddings } from '../../storage/embeddings-repo.js';
import { countCommits } from '../../storage/commits-repo.js';
import { openDatabase } from '../../storage/sqlite.js';

export interface DoctorOptions {
  readonly cwd: string;
  /** When true, send a tiny probe to the configured LLM to verify credentials. Default true. */
  readonly probeLlm?: boolean;
}

export type CheckLevel = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  readonly id: string;
  readonly title: string;
  readonly level: CheckLevel;
  readonly detail: string;
}

export interface DoctorResult {
  readonly checks: readonly DoctorCheck[];
  readonly tools: ReadonlyArray<{ name: string; descriptionLength: number }>;
  readonly summary: { readonly ok: number; readonly warn: number; readonly fail: number };
}

export async function runMcpDoctor(options: DoctorOptions): Promise<DoctorResult> {
  const cwd = options.cwd;
  loadDotEnv(cwd);
  const checks: DoctorCheck[] = [];
  const paths = resolvePaths(cwd);

  // 1. .gitwhy/ initialized?
  if (!existsSync(paths.configFile)) {
    checks.push({
      id: 'init',
      title: '.gitwhy/ initialized',
      level: 'fail',
      detail: `No config at ${paths.configFile}. Run \`gitwhy init\`.`,
    });
  } else {
    checks.push({
      id: 'init',
      title: '.gitwhy/ initialized',
      level: 'ok',
      detail: paths.root,
    });
  }

  // 2. Config valid?
  let configValid = false;
  let configProvider = 'unknown';
  if (existsSync(paths.configFile)) {
    try {
      const cfg = loadConfig(cwd);
      configProvider = cfg.provider.llm;
      configValid = true;
      checks.push({
        id: 'config',
        title: 'Config valid',
        level: 'ok',
        detail: `provider=${cfg.provider.llm}, indexingModel=${cfg.provider.indexingModel}, queryModel=${cfg.provider.queryModel}, embeddingModel=${cfg.provider.embeddingModel}`,
      });
    } catch (err) {
      checks.push({
        id: 'config',
        title: 'Config valid',
        level: 'fail',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 3. Index populated?
  let indexedCount = 0;
  let embeddingCount = 0;
  if (existsSync(paths.commitsDb)) {
    const db = openDatabase({ path: paths.commitsDb });
    try {
      indexedCount = countCommits(db);
      embeddingCount = countCommitEmbeddings(db);
    } finally {
      db.close();
    }
    if (indexedCount === 0) {
      checks.push({
        id: 'index',
        title: 'Index populated',
        level: 'warn',
        detail: 'Database exists but has 0 commits. Run `gitwhy index`.',
      });
    } else {
      const embedLevel: CheckLevel = embeddingCount === 0 ? 'warn' : 'ok';
      checks.push({
        id: 'index',
        title: 'Index populated',
        level: embedLevel,
        detail: `${indexedCount} commits indexed, ${embeddingCount} embeddings stored.${
          embeddingCount === 0 ? ' Q&A will fall back to idk without embeddings.' : ''
        }`,
      });
    }
  } else {
    checks.push({
      id: 'index',
      title: 'Index populated',
      level: 'fail',
      detail: `No DB at ${paths.commitsDb}. Run \`gitwhy index\`.`,
    });
  }

  // 4. MCP tools registered?
  registerBuiltinTools();
  const tools = listTools().map((t) => ({ name: t.name, descriptionLength: t.description.length }));
  const shortDescriptionTools = tools.filter((t) => t.descriptionLength < 120);
  if (tools.length === 0) {
    checks.push({
      id: 'tools',
      title: 'MCP tools registered',
      level: 'fail',
      detail: 'No tools registered.',
    });
  } else if (shortDescriptionTools.length > 0) {
    checks.push({
      id: 'tools',
      title: 'MCP tools registered',
      level: 'warn',
      detail: `${tools.length} tools registered, but ${shortDescriptionTools.length} have descriptions <120 chars (may not auto-invoke reliably): ${shortDescriptionTools.map((t) => t.name).join(', ')}.`,
    });
  } else {
    checks.push({
      id: 'tools',
      title: 'MCP tools registered',
      level: 'ok',
      detail: `${tools.length} tools: ${tools.map((t) => t.name).join(', ')}.`,
    });
  }

  // 5. LLM credentials available?
  if (configValid) {
    try {
      const cfg = loadConfig(cwd);
      const llm = resolveLlmFromEnv(cfg);
      checks.push({
        id: 'creds',
        title: 'LLM credentials',
        level: 'ok',
        detail: `provider=${llm.name} (configured: ${configProvider})`,
      });

      if (options.probeLlm !== false && llm.name !== 'mock') {
        try {
          const probe = await llm.complete({
            messages: [{ role: 'user', content: 'reply with just OK' }],
            maxTokens: 10,
            temperature: 0,
          });
          checks.push({
            id: 'probe',
            title: 'LLM probe call',
            level: 'ok',
            detail: `model=${probe.model}, tokens=${probe.usage.promptTokens}+${probe.usage.completionTokens}, response="${probe.text.slice(0, 30).replace(/\n/g, ' ')}"`,
          });
        } catch (err) {
          checks.push({
            id: 'probe',
            title: 'LLM probe call',
            level: 'fail',
            detail: err instanceof Error ? err.message.slice(0, 200) : String(err),
          });
        }
      }
    } catch (err) {
      checks.push({
        id: 'creds',
        title: 'LLM credentials',
        level: 'fail',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary = {
    ok: checks.filter((c) => c.level === 'ok').length,
    warn: checks.filter((c) => c.level === 'warn').length,
    fail: checks.filter((c) => c.level === 'fail').length,
  };

  return { checks, tools, summary };
}
