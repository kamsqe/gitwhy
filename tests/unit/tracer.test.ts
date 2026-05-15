import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDefaultTracer,
  createNdjsonTracer,
  createNullTracer,
} from '../../src/observability/tracer.js';

describe('null tracer', () => {
  it('emit() is a no-op', () => {
    const t = createNullTracer();
    expect(() => t.emit({ kind: 'cli', data: {} })).not.toThrow();
  });

  it('withSpan() passes the value through unchanged', async () => {
    const t = createNullTracer();
    const result = await t.withSpan('cli', {}, () => Promise.resolve(42));
    expect(result).toBe(42);
  });
});

describe('NDJSON tracer', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gitwhy-trace-'));
    file = join(dir, 'traces.ndjson');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends one JSON line per emit() call', () => {
    const t = createNdjsonTracer(file);
    t.emit({ kind: 'llm_call', data: { model: 'gpt-4o', tokens: 5 } });
    t.emit({ kind: 'mcp_tool', data: { tool: 'gitwhy.why' } });

    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]!) as { kind: string; data: { model?: string } };
    const second = JSON.parse(lines[1]!) as { kind: string; data: { tool?: string } };
    expect(first.kind).toBe('llm_call');
    expect(first.data.model).toBe('gpt-4o');
    expect(second.data.tool).toBe('gitwhy.why');
  });

  it('withSpan() emits an event with durationMs and the original kind', async () => {
    const t = createNdjsonTracer(file);
    await t.withSpan('mcp_tool', { tool: 'gitwhy.ping' }, () =>
      new Promise<string>((resolve) => setTimeout(() => resolve('ok'), 5)),
    );
    const entry = JSON.parse(readFileSync(file, 'utf8').trim()) as {
      kind: string;
      durationMs: number;
      data: { tool: string };
    };
    expect(entry.kind).toBe('mcp_tool');
    expect(entry.durationMs).toBeGreaterThanOrEqual(5);
    expect(entry.data.tool).toBe('gitwhy.ping');
  });

  it('withSpan() emits an "error" event when the wrapped fn rejects', async () => {
    const t = createNdjsonTracer(file);
    await expect(
      t.withSpan('mcp_tool', { tool: 'broken' }, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    const entry = JSON.parse(readFileSync(file, 'utf8').trim()) as {
      kind: string;
      data: { parentKind: string; error: string };
    };
    expect(entry.kind).toBe('error');
    expect(entry.data.parentKind).toBe('mcp_tool');
    expect(entry.data.error).toBe('boom');
  });

  it('creates the parent directory if it does not exist', () => {
    const nested = join(dir, 'nested', 'deeper', 'traces.ndjson');
    const t = createNdjsonTracer(nested);
    t.emit({ kind: 'cli', data: { ok: true } });
    expect(() => readFileSync(nested, 'utf8')).not.toThrow();
  });
});

describe('createDefaultTracer', () => {
  it('returns a null tracer by default', () => {
    delete process.env['GITWHY_TRACE'];
    const t = createDefaultTracer('/tmp/will-not-write.ndjson');
    expect(() => t.emit({ kind: 'cli', data: {} })).not.toThrow();
  });

  it('returns an NDJSON tracer when GITWHY_TRACE=1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitwhy-trace-'));
    const file = join(dir, 'traces.ndjson');
    process.env['GITWHY_TRACE'] = '1';
    try {
      const t = createDefaultTracer(file);
      t.emit({ kind: 'cli', data: { hello: 1 } });
      const content = readFileSync(file, 'utf8').trim();
      expect(content).toContain('"hello":1');
    } finally {
      delete process.env['GITWHY_TRACE'];
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
