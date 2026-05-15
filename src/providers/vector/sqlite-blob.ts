import type { Database as DatabaseType } from 'better-sqlite3';
import type {
  VectorDocument,
  VectorQueryOptions,
  VectorSearchResult,
  VectorStore,
} from './types.js';

/**
 * Vector store backed by a SQLite BLOB column. Cosine similarity is computed
 * in JavaScript. Good enough for repos up to ~50k commits with a 1536-dim
 * embedding model (sub-200ms per query).
 *
 * The implementation lives in `src/storage/embeddings-repo.ts`; this module
 * exposes that storage layer through the swappable VectorStore interface.
 */
export interface SqliteBlobVectorStoreOptions {
  readonly db: DatabaseType;
}

export function createSqliteBlobVectorStore(
  options: SqliteBlobVectorStoreOptions,
): VectorStore {
  const { db } = options;
  return new SqliteBlobVectorStore(db);
}

class SqliteBlobVectorStore implements VectorStore {
  readonly name = 'sqlite-blob';

  constructor(private readonly db: DatabaseType) {}

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  upsert(documents: VectorDocument[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO commit_embeddings (commit_hash, embedding, dimensions, model, indexed_at)
      VALUES (@id, @embedding, @dimensions, @model, @indexed_at)
      ON CONFLICT(commit_hash) DO UPDATE SET
        embedding = excluded.embedding,
        dimensions = excluded.dimensions,
        model = excluded.model,
        indexed_at = excluded.indexed_at
    `);
    const txn = this.db.transaction((docs: VectorDocument[]) => {
      const now = Date.now();
      for (const doc of docs) {
        const f32 = Float32Array.from(doc.embedding);
        const model = typeof doc.metadata['model'] === 'string'
          ? (doc.metadata['model'] as string)
          : 'unknown';
        stmt.run({
          id: doc.id,
          embedding: Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength),
          dimensions: f32.length,
          model,
          indexed_at: now,
        });
      }
    });
    txn(documents);
    return Promise.resolve();
  }

  query(
    embedding: number[],
    options: VectorQueryOptions,
  ): Promise<VectorSearchResult[]> {
    const query = Float32Array.from(embedding);
    const rows = this.db
      .prepare(`SELECT commit_hash, embedding, model FROM commit_embeddings`)
      .all() as Array<{ commit_hash: string; embedding: Buffer; model: string }>;

    const results: VectorSearchResult[] = [];
    for (const row of rows) {
      const stored = new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.byteLength / 4,
      );
      const score = cosineSimilarity(query, stored);
      if (Number.isFinite(score)) {
        results.push({
          id: row.commit_hash,
          score,
          metadata: { model: row.model },
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return Promise.resolve(results.slice(0, Math.max(0, options.topK | 0)));
  }

  delete(ids: string[]): Promise<void> {
    const stmt = this.db.prepare(`DELETE FROM commit_embeddings WHERE commit_hash = ?`);
    const txn = this.db.transaction((rows: string[]) => {
      for (const id of rows) stmt.run(id);
    });
    txn(ids);
    return Promise.resolve();
  }

  count(): Promise<number> {
    const row = this.db.prepare(`SELECT COUNT(*) AS c FROM commit_embeddings`).get() as {
      c: number;
    };
    return Promise.resolve(row.c);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
