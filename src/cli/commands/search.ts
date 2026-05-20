import { createMcpRuntimeFactory } from '../../mcp/runtime.js';
import { searchTool } from '../../mcp/tools/search.js';

export interface SearchCommandOptions {
  readonly cwd: string;
  readonly query: string;
  readonly topK?: number;
}

export async function runSearchCommand(options: SearchCommandOptions): Promise<string> {
  const factory = createMcpRuntimeFactory({ cwd: options.cwd });
  const result = await searchTool.handler(
    {
      query: options.query,
      ...(options.topK !== undefined && { topK: options.topK }),
    },
    { cwd: options.cwd, runtime: factory },
  );
  return result.content[0]?.text ?? '';
}
