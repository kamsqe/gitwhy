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
