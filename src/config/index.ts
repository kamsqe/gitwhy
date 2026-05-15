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
