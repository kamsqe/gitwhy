export interface GitWhyConfig {
  readonly version: 1;
  readonly provider: {
    readonly llm: string;
    readonly indexingModel: string;
    readonly queryModel: string;
    readonly embeddingModel: string;
  };
  readonly scope: {
    readonly since?: string;
    readonly until?: string;
    readonly branches?: readonly string[];
    readonly pathInclude?: readonly string[];
    readonly pathExclude?: readonly string[];
  };
  readonly budget: {
    readonly maxUsd?: number;
    readonly maxTokens?: number;
  };
  readonly storage: {
    readonly indexDir: string;
    readonly vectorBackend: string;
  };
}

export const defaultConfig: GitWhyConfig = {
  version: 1,
  provider: {
    llm: 'openai',
    indexingModel: 'gpt-4o-mini',
    queryModel: 'gpt-4o',
    embeddingModel: 'text-embedding-3-small',
  },
  scope: {},
  budget: {},
  storage: {
    indexDir: '.gitwhy',
    vectorBackend: 'sqlite-vec',
  },
};

export const geminiDefaultConfig: GitWhyConfig = {
  ...defaultConfig,
  provider: {
    llm: 'gemini',
    indexingModel: 'gemini-2.5-flash',
    queryModel: 'gemini-2.5-flash',
    embeddingModel: 'gemini-embedding-001',
  },
};

/**
 * Pick the default config that matches whatever LLM credentials the user
 * appears to have. Used by `gitwhy init` so users don't have to hand-edit
 * config.json for their chosen provider. Lookups are case-insensitive.
 */
export function detectDefaultConfig(env: NodeJS.ProcessEnv = process.env): GitWhyConfig {
  const lookup = (name: string): string | undefined =>
    env[name] ?? env[name.toLowerCase()];
  if (lookup('OPENAI_API_KEY')) return defaultConfig;
  if (lookup('GEMINI_API_KEY') ?? lookup('GOOGLE_API_KEY')) return geminiDefaultConfig;
  return defaultConfig;
}
