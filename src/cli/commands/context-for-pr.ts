import { createMcpRuntimeFactory } from '../../mcp/runtime.js';
import { contextForPrTool } from '../../mcp/tools/context-for-pr.js';

export interface ContextForPrCommandOptions {
  readonly cwd: string;
  /** Branch / ref to analyze. Files derived from `git diff <base>...<branch>`. */
  readonly branch?: string;
  /** Base branch to diff against. Default 'main'. */
  readonly base?: string;
  /** Explicit file list (mutually exclusive with `branch`). */
  readonly files?: readonly string[];
}

/**
 * Generate review-ready PR context: per-file risk, top contributors,
 * recent commits, co-changing files. Powers the `gitwhy-bot` GitHub
 * Action — same code path as the MCP tool, just shelled out from CLI
 * so CI workflows don't need a Node runtime API.
 */
export async function runContextForPrCommand(
  options: ContextForPrCommandOptions,
): Promise<string> {
  const factory = createMcpRuntimeFactory({ cwd: options.cwd });
  const result = await contextForPrTool.handler(
    {
      ...(options.branch !== undefined && { branch: options.branch }),
      ...(options.base !== undefined && { base: options.base }),
      ...(options.files !== undefined && { files: [...options.files] }),
    },
    { cwd: options.cwd, runtime: factory },
  );
  return result.content[0]?.text ?? '';
}
