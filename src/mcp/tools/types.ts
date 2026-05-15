import type { z } from 'zod';

export interface McpToolContext {
  // Populated in later phases: db, vector store, llm provider, config, tracer.
  // Kept minimal in Phase 1 so the seam is stable.
  readonly cwd: string;
}

export interface McpToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface McpTool<TInput = unknown> {
  /** Tool name in the form `gitwhy.<verb>` */
  readonly name: string;
  /** Drives agent auto-invocation. This text is load-bearing UX. */
  readonly description: string;
  /** Zod schema describing the tool's input. */
  readonly inputSchema: z.ZodType<TInput>;
  handler(input: TInput, ctx: McpToolContext): Promise<McpToolResponse>;
}
