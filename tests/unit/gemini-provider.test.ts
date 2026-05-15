import { describe, expect, it } from 'vitest';
import {
  createRequestPacer,
  isRetriableError,
  mapMessagesToGeminiContents,
  withRetry,
} from '../../src/providers/llm/gemini.js';

describe('mapMessagesToGeminiContents', () => {
  it('extracts system messages into a single systemInstruction', () => {
    const mapped = mapMessagesToGeminiContents([
      { role: 'system', content: 'be helpful' },
      { role: 'system', content: 'be concise' },
      { role: 'user', content: 'hi' },
    ]);
    expect(mapped.systemInstruction).toBe('be helpful\n\nbe concise');
    expect(mapped.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
  });

  it('returns null systemInstruction when no system messages present', () => {
    const mapped = mapMessagesToGeminiContents([{ role: 'user', content: 'hello' }]);
    expect(mapped.systemInstruction).toBeNull();
  });

  it('maps assistant role to model', () => {
    const mapped = mapMessagesToGeminiContents([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    expect(mapped.contents).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ text: 'hello' }] },
    ]);
  });

  it('merges consecutive same-role messages (Gemini disallows two user-turns in a row)', () => {
    const mapped = mapMessagesToGeminiContents([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'third' },
    ]);
    expect(mapped.contents).toEqual([
      { role: 'user', parts: [{ text: 'first' }, { text: 'second' }] },
      { role: 'model', parts: [{ text: 'reply' }] },
      { role: 'user', parts: [{ text: 'third' }] },
    ]);
  });

  it('handles empty messages list', () => {
    const mapped = mapMessagesToGeminiContents([]);
    expect(mapped.systemInstruction).toBeNull();
    expect(mapped.contents).toEqual([]);
  });
});

describe('isRetriableError', () => {
  it.each([
    ['429 Too Many Requests'],
    ['Rate limit exceeded'],
    ['RESOURCE_EXHAUSTED quota'],
    ['Service unavailable'],
    ['HTTP 503 server error'],
  ])('flags %s as retriable', (msg) => {
    expect(isRetriableError(new Error(msg))).toBe(true);
  });

  it.each([['400 bad request'], ['401 unauthorized'], ['random other error']])(
    'does not flag %s as retriable',
    (msg) => {
      expect(isRetriableError(new Error(msg))).toBe(false);
    },
  );

  it('returns false for non-Error values', () => {
    expect(isRetriableError('string')).toBe(false);
    expect(isRetriableError(null)).toBe(false);
    expect(isRetriableError(undefined)).toBe(false);
  });
});

describe('withRetry', () => {
  it('returns result on first success', async () => {
    let calls = 0;
    const result = await withRetry(
      () => {
        calls++;
        return Promise.resolve('ok');
      },
      { maxRetries: 3, retryBaseDelayMs: 1 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries on retriable errors and eventually succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      () => {
        calls++;
        if (calls < 3) return Promise.reject(new Error('429 rate limit'));
        return Promise.resolve('ok');
      },
      { maxRetries: 5, retryBaseDelayMs: 1 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('does not retry on non-retriable errors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        () => {
          calls++;
          return Promise.reject(new Error('401 unauthorized'));
        },
        { maxRetries: 3, retryBaseDelayMs: 1 },
      ),
    ).rejects.toThrow('401 unauthorized');
    expect(calls).toBe(1);
  });

  it('throws the last error after exhausting retries', async () => {
    let calls = 0;
    await expect(
      withRetry(
        () => {
          calls++;
          return Promise.reject(new Error('429 rate limit'));
        },
        { maxRetries: 2, retryBaseDelayMs: 1 },
      ),
    ).rejects.toThrow('429 rate limit');
    expect(calls).toBe(3); // initial + 2 retries
  });
});

describe('createRequestPacer', () => {
  it('does not wait on the first call', async () => {
    const pacer = createRequestPacer(1000);
    const start = Date.now();
    await pacer.waitTurn();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('waits at least minIntervalMs between consecutive calls', async () => {
    const pacer = createRequestPacer(120);
    await pacer.waitTurn();
    const before = Date.now();
    await pacer.waitTurn();
    const elapsed = Date.now() - before;
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });

  it('is a no-op when minIntervalMs is 0', async () => {
    const pacer = createRequestPacer(0);
    const start = Date.now();
    await pacer.waitTurn();
    await pacer.waitTurn();
    await pacer.waitTurn();
    expect(Date.now() - start).toBeLessThan(50);
  });
});
