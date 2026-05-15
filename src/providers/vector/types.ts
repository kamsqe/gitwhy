export interface VectorDocument {
  id: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  content?: string;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
  content?: string;
}

export interface VectorQueryOptions {
  topK: number;
  filter?: Record<string, unknown>;
}

export interface VectorStore {
  readonly name: string;
  initialize(): Promise<void>;
  upsert(documents: VectorDocument[]): Promise<void>;
  query(embedding: number[], options: VectorQueryOptions): Promise<VectorSearchResult[]>;
  delete(ids: string[]): Promise<void>;
  count(): Promise<number>;
  close(): Promise<void>;
}
