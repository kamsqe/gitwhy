import { createMcpRuntimeFactory } from '../../mcp/runtime.js';
import { catchupTool } from '../../mcp/tools/catchup.js';

export interface CatchupCommandOptions {
  readonly cwd: string;
  readonly since: string;
  readonly limit?: number;
}

export async function runCatchupCommand(options: CatchupCommandOptions): Promise<string> {
  const factory = createMcpRuntimeFactory({ cwd: options.cwd });
  const result = await catchupTool.handler(
    {
      since: options.since,
      ...(options.limit !== undefined && { limit: options.limit }),
    },
    { cwd: options.cwd, runtime: factory },
  );
  return result.content[0]?.text ?? '';
}
