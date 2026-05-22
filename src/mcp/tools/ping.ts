import { z } from 'zod';
import { VERSION } from '../../version.js';
import type { McpTool, McpToolContext, McpToolResponse } from './types.js';

const pingInputSchema = z.object({
  message: z
    .string()
    .optional()
    .describe('Optional echo message to confirm the tool received input'),
});

type PingInput = z.infer<typeof pingInputSchema>;

export const pingTool: McpTool<PingInput> = {
  name: 'gitwhy.ping',
  description:
    'Health-check tool. Returns a pong response confirming that the GitWhy MCP server is reachable. ' +
    'Use this to verify the gitwhy MCP server is connected and responsive. ' +
    'Not for end-user history questions — use gitwhy.why for those.',
  inputSchema: pingInputSchema,
  async handler(input: PingInput, _ctx: McpToolContext): Promise<McpToolResponse> {
    const echo = input.message ? ` (echo: ${input.message})` : '';
    return {
      content: [
        {
          type: 'text',
          text: `pong from gitwhy v${VERSION}${echo}`,
        },
      ],
    };
  },
};
