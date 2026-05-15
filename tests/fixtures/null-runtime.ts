import type { McpRuntime, McpRuntimeFactory } from '../../src/mcp/runtime.js';

/**
 * Stub runtime factory for tool tests that don't exercise stateful tools.
 * Calling `.get()` throws — tests that touch runtime should build a real one
 * with a temp DB instead.
 */
export const nullRuntimeFactory: McpRuntimeFactory = {
  get(): McpRuntime {
    throw new Error('runtime not available in this test fixture');
  },
  reset(): void {
    // no-op
  },
};
