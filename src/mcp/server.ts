#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Tracer } from '../observability/tracer.js';
import { VERSION } from '../version.js';
import { createMcpRuntimeFactory } from './runtime.js';
import type { McpRuntimeFactory } from './runtime.js';
import { registerBuiltinTools } from './tools/index.js';
import { getTool, listTools } from './tools/registry.js';
import type { McpToolContext } from './tools/types.js';

export interface CreateServerOptions {
  readonly cwd?: string;
  /** Override the runtime factory (used by tests). */
  readonly runtime?: McpRuntimeFactory;
}

export function createServer(options: CreateServerOptions = {}): Server {
  registerBuiltinTools();

  const cwd = options.cwd ?? process.cwd();
  const ctx: McpToolContext = {
    cwd,
    runtime: options.runtime ?? createMcpRuntimeFactory({ cwd }),
  };

  const server = new Server(
    { name: 'gitwhy', version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () =>
    Promise.resolve({
      tools: listTools().map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: zodToJsonSchema(tool.inputSchema, { target: 'jsonSchema7' }) as Record<
          string,
          unknown
        >,
      })),
    }),
  );

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const tool = getTool(request.params.name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
        isError: true,
      };
    }
    const parsed = tool.inputSchema.safeParse(request.params.arguments ?? {});
    if (!parsed.success) {
      return {
        content: [
          { type: 'text', text: `Invalid input for ${tool.name}: ${parsed.error.message}` },
        ],
        isError: true,
      };
    }

    // Try to capture timing via the runtime's tracer when available. Tools
    // like gitwhy.ping don't touch the runtime, so we tolerate the throw.
    let tracer: Tracer | null = null;
    try {
      const rt = ctx.runtime.get();
      tracer = rt.tracer;
    } catch {
      tracer = null;
    }

    const invokeHandler = async (): Promise<CallToolResult> => {
      const response = await tool.handler(parsed.data, ctx);
      // McpToolResponse is a strict subset of CallToolResult (the SDK's union
      // adds an index signature and an optional task-async branch we don't use).
      return response as CallToolResult;
    };

    if (tracer) {
      return tracer.withSpan('mcp_tool', { tool: tool.name }, invokeHandler);
    }
    return invokeHandler();
  });

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`gitwhy MCP server failed: ${message}\n`);
    process.exit(1);
  });
}
