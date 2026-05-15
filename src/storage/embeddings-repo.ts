import type { Database as DatabaseType } from 'better-sqlite3';

export interface StoredEmbedding {
  readonly commitHash: string;
  readonly embedding: Float32Array;
  readonly dimensions: number;
  readonly model: string;
}

export interface UpsertEmbeddingInput {
  readonly commitHash: string;
  readonly embedding: ReadonlyArray<number> | Float32Array;
  readonly model: string;
}

export function upsertCommitEmbedding(
  db: DatabaseType,
  input: UpsertEmbeddingInput,
): void {
  const float32 = toFloat32(input.embedding);
  const buf = Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength);
  db.prepare(`
    INSERT INTO commit_embeddings (commit_hash, embedding, dimensions, model, indexed_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(commit_hash) DO UPDATE SET
      embedding = excluded.embedding,
      dimensions = excluded.dimensions,
      model = excluded.model,
      indexed_at = excluded.indexed_at
  `).run(input.commitHash, buf, float32.length, input.model, Date.now());
}

export function getCommitEmbedding(
  db: DatabaseType,
  commitHash: string,
): StoredEmbedding | null {
  const row = db
    .prepare(`SELECT commit_hash, embedding, dimensions, model FROM commit_embeddings WHERE commit_hash = ?`)
    .get(commitHash) as
    | { commit_hash: string; embedding: Buffer; dimensions: number; model: string }
    | undefined;
  if (!row) return null;
  return {
    commitHash: row.commit_hash,
    embedding: bufferToFloat32(row.embedding),
    dimensions: row.dimensions,
    model: row.model,
  };
}

export function loadAllCommitEmbeddings(db: DatabaseType): StoredEmbedding[] {
  const rows = db
    .prepare(`SELECT commit_hash, embedding, dimensions, model FROM commit_embeddings`)
    .all() as Array<{ commit_hash: string; embedding: Buffer; dimensions: number; model: string }>;
  return rows.map((row) => ({
    commitHash: row.commit_hash,
    embedding: bufferToFloat32(row.embedding),
    dimensions: row.dimensions,
    model: row.model,
  }));
}

export function countCommitEmbeddings(db: DatabaseType): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM commit_embeddings`).get() as { c: number };
  return row.c;
}

export function deleteCommitEmbedding(db: DatabaseType, commitHash: string): void {
  db.prepare(`DELETE FROM commit_embeddings WHERE commit_hash = ?`).run(commitHash);
}

function toFloat32(input: ReadonlyArray<number> | Float32Array): Float32Array {
  if (input instanceof Float32Array) return input;
  return Float32Array.from(input);
}

function bufferToFloat32(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
