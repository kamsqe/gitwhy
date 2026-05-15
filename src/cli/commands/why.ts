import { createMcpRuntimeFactory } from '../../mcp/runtime.js';
import type { QueryResult } from '../../agents/knowledge/index.js';

export interface WhyCommandOptions {
  readonly cwd: string;
  readonly question: string;
  readonly topK?: number;
  readonly minConfidence?: number;
}

export async function runWhyCommand(options: WhyCommandOptions): Promise<QueryResult> {
  const factory = createMcpRuntimeFactory({ cwd: options.cwd });
  const runtime = factory.get();
  return runtime.knowledge.ask(options.question, {
    ...(options.topK !== undefined && { topK: options.topK }),
    ...(options.minConfidence !== undefined && { minConfidence: options.minConfidence }),
  });
}
