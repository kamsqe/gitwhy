import { createMcpRuntimeFactory } from '../../mcp/runtime.js';
import { historyTool } from '../../mcp/tools/history.js';

export interface HistoryCommandOptions {
  readonly cwd: string;
  readonly path: string;
  readonly limit?: number;
}

export async function runHistoryCommand(options: HistoryCommandOptions): Promise<string> {
  const factory = createMcpRuntimeFactory({ cwd: options.cwd });
  const result = await historyTool.handler(
    {
      path: options.path,
      ...(options.limit !== undefined && { limit: options.limit }),
    },
    { cwd: options.cwd, runtime: factory },
  );
  return result.content[0]?.text ?? '';
}
