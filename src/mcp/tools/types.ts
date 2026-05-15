import type { z } from 'zod';
import type { McpRuntimeFactory } from '../runtime.js';

export interface McpToolContext {
  readonly cwd: string;
  /**
   * Lazy accessor for the shared runtime (DB, LLM, vector store, agents).
   * Tools that need state call `ctx.runtime.get()` on demand. Trivial tools
   * (e.g. `gitwhy.ping`) don't touch it and remain cheap.
   */
  readonly runtime: McpRuntimeFactory;
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
