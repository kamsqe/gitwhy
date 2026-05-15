import type { McpTool } from './types.js';

const tools = new Map<string, McpTool>();

export function registerTool<TInput>(tool: McpTool<TInput>): void {
  if (tools.has(tool.name)) {
    throw new Error(`MCP tool '${tool.name}' is already registered`);
  }
  tools.set(tool.name, tool as McpTool);
}

export function getTool(name: string): McpTool | undefined {
  return tools.get(name);
}

export function listTools(): readonly McpTool[] {
  return [...tools.values()];
}

export function clearTools(): void {
  tools.clear();
}
