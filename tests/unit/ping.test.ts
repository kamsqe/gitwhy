import { describe, expect, it } from 'vitest';
import { pingTool } from '../../src/mcp/tools/ping.js';
import { nullRuntimeFactory } from '../fixtures/null-runtime.js';

const ctx = { cwd: process.cwd(), runtime: nullRuntimeFactory };

describe('gitwhy.ping tool', () => {
  it('returns a pong response with no input', async () => {
    const result = await pingTool.handler({}, ctx);
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.text).toContain('pong from gitwhy');
  });

  it('echoes a message when provided', async () => {
    const result = await pingTool.handler({ message: 'hello' }, ctx);
    expect(result.content[0]?.text).toContain('echo: hello');
  });

  it('has a description that mentions purpose for agent auto-invocation', () => {
    expect(pingTool.description.toLowerCase()).toContain('health');
    expect(pingTool.description.toLowerCase()).toContain('gitwhy');
  });

  it('has a name in the gitwhy.<verb> namespace', () => {
    expect(pingTool.name).toMatch(/^gitwhy\.[a-z_]+$/);
  });

  it('rejects malformed input via its zod schema', () => {
    const parsed = pingTool.inputSchema.safeParse({ message: 42 });
    expect(parsed.success).toBe(false);
  });
});
