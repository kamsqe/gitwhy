import { describe, expect, it } from 'vitest';
import { createMockLlmProvider } from '../../src/providers/llm/mock.js';

describe('mock LLM provider', () => {
  it('produces a deterministic response for the same input', async () => {
    const p = createMockLlmProvider();
    const r1 = await p.complete({ messages: [{ role: 'user', content: 'hello' }] });
    const r2 = await p.complete({ messages: [{ role: 'user', content: 'hello' }] });
    expect(r1.text).toBe(r2.text);
  });

  it('produces different responses for different inputs', async () => {
    const p = createMockLlmProvider();
    const r1 = await p.complete({ messages: [{ role: 'user', content: 'foo' }] });
    const r2 = await p.complete({ messages: [{ role: 'user', content: 'bar' }] });
    expect(r1.text).not.toBe(r2.text);
  });

  it('records all complete() calls in calls.complete', async () => {
    const p = createMockLlmProvider();
    await p.complete({ messages: [{ role: 'user', content: 'a' }] });
    await p.complete({ messages: [{ role: 'user', content: 'b' }] });
    expect(p.calls.complete).toHaveLength(2);
    expect(p.calls.complete[0]?.messages[0]?.content).toBe('a');
  });

  it('supports a custom responder', async () => {
    const p = createMockLlmProvider({
      responder: (params) => `replied to ${params.messages[0]?.content ?? ''}`,
    });
    const r = await p.complete({ messages: [{ role: 'user', content: 'ping' }] });
    expect(r.text).toBe('replied to ping');
  });

  it('reports approximate token usage', async () => {
    const p = createMockLlmProvider({ charsPerToken: 4 });
    const r = await p.complete({
      messages: [{ role: 'user', content: 'a'.repeat(40) }],
    });
    expect(r.usage.promptTokens).toBe(10);
    expect(r.usage.completionTokens).toBeGreaterThan(0);
  });

  it('embed() returns vectors with consistent dimensions', async () => {
    const p = createMockLlmProvider();
    const r = await p.embed({ input: ['hello', 'world'] });
    expect(r.embeddings).toHaveLength(2);
    expect(r.dimensions).toBe(8);
    expect(r.embeddings[0]).toHaveLength(8);
    expect(r.embeddings[1]).toHaveLength(8);
  });

  it('embed() is deterministic per input', async () => {
    const p = createMockLlmProvider();
    const r1 = await p.embed({ input: 'x' });
    const r2 = await p.embed({ input: 'x' });
    expect(r1.embeddings[0]).toEqual(r2.embeddings[0]);
  });

  it('reset() clears the call history', async () => {
    const p = createMockLlmProvider();
    await p.complete({ messages: [{ role: 'user', content: 'a' }] });
    expect(p.calls.complete).toHaveLength(1);
    p.reset();
    expect(p.calls.complete).toHaveLength(0);
  });

  it('reports its name as "mock"', () => {
    const p = createMockLlmProvider();
    expect(p.name).toBe('mock');
  });
});
