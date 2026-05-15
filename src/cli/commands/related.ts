import { createMcpRuntimeFactory } from '../../mcp/runtime.js';
import type { RelatedFile } from '../../agents/insight/co-change.js';

export interface RelatedCommandOptions {
  readonly cwd: string;
  readonly path: string;
  readonly limit?: number;
  readonly minCoCommits?: number;
}

export function runRelatedCommand(options: RelatedCommandOptions): {
  related: RelatedFile[];
} {
  const factory = createMcpRuntimeFactory({ cwd: options.cwd });
  const runtime = factory.get();
  const related = runtime.insight.relatedFiles(options.path, {
    ...(options.limit !== undefined && { limit: options.limit }),
    ...(options.minCoCommits !== undefined && { minCoCommits: options.minCoCommits }),
  });
  return { related };
}
