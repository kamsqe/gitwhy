import { describe, expect, it } from 'vitest';
import { createLruCache } from '../../src/utils/lru-cache.js';

describe('LRU cache', () => {
  it('returns undefined for missing keys', () => {
    const c = createLruCache<string, number>({ maxSize: 3 });
    expect(c.get('x')).toBeUndefined();
  });

  it('stores and retrieves values', () => {
    const c = createLruCache<string, number>({ maxSize: 3 });
    c.set('a', 1);
    expect(c.get('a')).toBe(1);
  });

  it('evicts the least recently used entry on overflow', () => {
    const c = createLruCache<string, number>({ maxSize: 2 });
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    expect(c.has('a')).toBe(false);
    expect(c.has('b')).toBe(true);
    expect(c.has('c')).toBe(true);
  });

  it('promotes a key to most-recent on get', () => {
    const c = createLruCache<string, number>({ maxSize: 2 });
    c.set('a', 1);
    c.set('b', 2);
    c.get('a');
    c.set('c', 3);
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
  });

  it('overwriting moves the key to most-recent', () => {
    const c = createLruCache<string, number>({ maxSize: 2 });
    c.set('a', 1);
    c.set('b', 2);
    c.set('a', 10);
    c.set('c', 3);
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
  });

  it('clear() empties the cache', () => {
    const c = createLruCache<string, number>({ maxSize: 2 });
    c.set('a', 1);
    c.set('b', 2);
    c.clear();
    expect(c.size).toBe(0);
  });

  it('handles maxSize of 1', () => {
    const c = createLruCache<string, number>({ maxSize: 1 });
    c.set('a', 1);
    c.set('b', 2);
    expect(c.has('a')).toBe(false);
    expect(c.get('b')).toBe(2);
  });
});
