import { describe, expect, it } from 'vitest';
import { createOpenAiProvider } from '../../src/providers/llm/openai.js';

function makeFetch(handler: (url: string, init: RequestInit) => unknown): typeof fetch {
  return (async (input: Request | URL | string, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = handler(url, init);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('OpenAI provider', () => {
  it('parses a chat completion response correctly', async () => {
    const fakeFetch = makeFetch(() => ({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 1700000000,
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'hello back' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    }));

    const provider = createOpenAiProvider({ apiKey: 'test', fetch: fakeFetch });
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.text).toBe('hello back');
    expect(result.usage.promptTokens).toBe(12);
    expect(result.usage.completionTokens).toBe(3);
    expect(result.finishReason).toBe('stop');
    expect(result.model).toBe('gpt-4o-mini');
  });

  it('maps "length" finish reason correctly', async () => {
    const fakeFetch = makeFetch(() => ({
      id: '1',
      object: 'chat.completion',
      created: 0,
      model: 'gpt-4o-mini',
      choices: [{ index: 0, message: { role: 'assistant', content: 'truncated' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));

    const provider = createOpenAiProvider({ apiKey: 'test', fetch: fakeFetch });
    const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.finishReason).toBe('length');
  });

  it('parses an embeddings response correctly', async () => {
    const fakeFetch = makeFetch((url) => {
      expect(url).toContain('/embeddings');
      return {
        object: 'list',
        model: 'text-embedding-3-small',
        data: [
          { object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] },
          { object: 'embedding', index: 1, embedding: [0.4, 0.5, 0.6] },
        ],
        usage: { prompt_tokens: 4, total_tokens: 4 },
      };
    });

    const provider = createOpenAiProvider({ apiKey: 'test', fetch: fakeFetch });
    const result = await provider.embed({ input: ['hello', 'world'] });

    expect(result.embeddings).toHaveLength(2);
    expect(result.embeddings[0]).toEqual([0.1, 0.2, 0.3]);
    expect(result.dimensions).toBe(3);
    expect(result.usage.promptTokens).toBe(4);
  });

  it('reports its name as "openai"', () => {
    const provider = createOpenAiProvider({ apiKey: 'test' });
    expect(provider.name).toBe('openai');
  });

  it('passes the requested model in the request body', async () => {
    let capturedBody: unknown = null;
    const fakeFetch = makeFetch((_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return {
        id: '1',
        object: 'chat.completion',
        created: 0,
        model: 'gpt-4o',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
    });

    const provider = createOpenAiProvider({ apiKey: 'test', fetch: fakeFetch });
    await provider.complete({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'gpt-4o',
      maxTokens: 100,
      temperature: 0.3,
    });

    expect(capturedBody).toMatchObject({
      model: 'gpt-4o',
      max_tokens: 100,
      temperature: 0.3,
    });
  });
});
