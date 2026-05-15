/**
 * Tiny FIFO-with-promotion LRU cache. JS Maps preserve insertion order;
 * we evict the oldest entry on overflow and re-insert keys on read to
 * promote them to "most recently used".
 *
 * Used by the Knowledge agent's query cache.
 */

export interface LruCacheOptions {
  readonly maxSize: number;
}

export interface LruCache<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  readonly size: number;
}

export function createLruCache<K, V>(options: LruCacheOptions): LruCache<K, V> {
  const max = Math.max(1, options.maxSize | 0);
  const store = new Map<K, V>();

  return {
    get(key: K): V | undefined {
      if (!store.has(key)) return undefined;
      const v = store.get(key)!;
      store.delete(key);
      store.set(key, v);
      return v;
    },
    set(key: K, value: V): void {
      if (store.has(key)) store.delete(key);
      store.set(key, value);
      if (store.size > max) {
        const oldest = store.keys().next();
        if (!oldest.done) store.delete(oldest.value);
      }
    },
    has(key: K): boolean {
      return store.has(key);
    },
    delete(key: K): boolean {
      return store.delete(key);
    },
    clear(): void {
      store.clear();
    },
    get size(): number {
      return store.size;
    },
  };
}
