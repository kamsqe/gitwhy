/**
 * Public library entry point.
 *
 * Re-exports the core plugin seams and the MCP server factory. Most users
 * will interact with gitwhy via the CLI or the MCP server, but the library
 * surface is here for embedders, plugin authors, and tests.
 */

export type {
  LlmProvider,
  LlmMessage,
  LlmCompletionParams,
  LlmCompletionResult,
  LlmEmbedParams,
  LlmEmbedResult,
  LlmTokenUsage,
} from './providers/llm/types.js';

export type {
  VectorStore,
  VectorDocument,
  VectorSearchResult,
  VectorQueryOptions,
} from './providers/vector/types.js';

export type {
  Categorizer,
  CategoryResult,
  CommitCategory,
  CommitInfo,
  ChangedFile,
  FileStatus,
} from './indexer/types.js';

export type { McpTool, McpToolContext, McpToolResponse } from './mcp/tools/types.js';
export type { GitWhyConfig } from './config/index.js';

export { defaultConfig } from './config/index.js';
export {
  registerLlmProvider,
  getLlmProvider,
  listLlmProviders,
} from './providers/llm/registry.js';
export {
  registerCategorizer,
  listCategorizers,
  categorize,
} from './indexer/categorizers/registry.js';
export { registerTool, getTool, listTools } from './mcp/tools/registry.js';
export { createServer } from './mcp/server.js';
export { createMcpRuntimeFactory } from './mcp/runtime.js';
export type { McpRuntime, McpRuntimeFactory } from './mcp/runtime.js';

export { createKnowledgeAgent } from './agents/knowledge/index.js';
export type {
  KnowledgeAgent,
  QueryOptions,
  QueryResult,
  Citation,
} from './agents/knowledge/index.js';

export { createSqliteBlobVectorStore, cosineSimilarity } from './providers/vector/sqlite-blob.js';
export { createMockLlmProvider } from './providers/llm/mock.js';
export { createOpenAiProvider } from './providers/llm/openai.js';
export { createGeminiProvider } from './providers/llm/gemini.js';
export type { MockLlmProvider } from './providers/llm/mock.js';

export { indexRepo } from './indexer/indexer.js';
export type { IndexerOptions, IndexProgress, IndexResult } from './indexer/indexer.js';
export { createGitReader } from './indexer/git-reader.js';
export type { GitReader, GitReaderOptions, GitReaderDiagnostics } from './indexer/git-reader.js';
export { scanForSecrets } from './indexer/secret-detection.js';
export type { SecretScanResult, SecretMatch } from './indexer/secret-detection.js';
export { analyzeDiff, isFormattingOnlyDiff } from './indexer/diff-analyzer.js';
export type { DiffAnalysisResult, DiffAnalyzeInput, DiffAnalyzeOptions } from './indexer/diff-analyzer.js';
export { clusterCommits } from './indexer/commit-clusterer.js';
export type { CommitCluster, ClusterOptions } from './indexer/commit-clusterer.js';
export { decomposeMegaCommit } from './indexer/mega-commit-decomposer.js';
export { estimateCostUsd, getModelPricing } from './indexer/pricing.js';

export { loadConfig, writeConfig, resolvePaths } from './config/loader.js';
export type { GitWhyPaths } from './config/loader.js';

export { openDatabase, getSchemaVersion } from './storage/sqlite.js';
export {
  upsertCommit,
  getCommit,
  listCommits,
  countCommits,
  getIndexedHashes,
  recordLlmCall,
  getUsageSummary,
  upsertCluster,
} from './storage/commits-repo.js';
export type { StoredCommit, UsageSummary } from './storage/commits-repo.js';
export {
  upsertCommitEmbedding,
  getCommitEmbedding,
  loadAllCommitEmbeddings,
  countCommitEmbeddings,
  deleteCommitEmbedding,
} from './storage/embeddings-repo.js';
export type { StoredEmbedding } from './storage/embeddings-repo.js';

export { createLruCache } from './utils/lru-cache.js';
export type { LruCache } from './utils/lru-cache.js';
