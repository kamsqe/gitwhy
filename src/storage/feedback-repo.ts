import type { Database as DatabaseType } from 'better-sqlite3';

export type FeedbackRating = 'up' | 'down';

export interface RecordFeedbackInput {
  readonly question: string;
  readonly answer?: string;
  readonly rating: FeedbackRating;
  readonly confidence?: number;
  readonly citations?: readonly string[];
  readonly note?: string;
}

export interface FeedbackRow {
  readonly id: number;
  readonly occurredAt: Date;
  readonly question: string;
  readonly answer: string | null;
  readonly rating: FeedbackRating;
  readonly confidence: number | null;
  readonly citations: readonly string[];
  readonly note: string | null;
}

export interface FeedbackStats {
  readonly upCount: number;
  readonly downCount: number;
  readonly total: number;
  readonly upRate: number;
  readonly averageConfidence: number | null;
}

export function recordFeedback(db: DatabaseType, input: RecordFeedbackInput): number {
  const result = db
    .prepare(`
      INSERT INTO query_feedback (occurred_at, question, answer, rating, confidence, citations, note)
      VALUES (@occurred_at, @question, @answer, @rating, @confidence, @citations, @note)
    `)
    .run({
      occurred_at: Date.now(),
      question: input.question,
      answer: input.answer ?? null,
      rating: input.rating,
      confidence: input.confidence ?? null,
      citations: input.citations ? JSON.stringify(input.citations) : null,
      note: input.note ?? null,
    });
  return result.lastInsertRowid as number;
}

export function listFeedback(
  db: DatabaseType,
  options: { limit?: number; rating?: FeedbackRating } = {},
): FeedbackRow[] {
  const limitClause = options.limit !== undefined ? `LIMIT ${options.limit | 0}` : '';
  const whereClause = options.rating !== undefined ? `WHERE rating = @rating` : '';
  const rows = db
    .prepare(`
      SELECT id, occurred_at, question, answer, rating, confidence, citations, note
      FROM query_feedback
      ${whereClause}
      ORDER BY occurred_at DESC
      ${limitClause}
    `)
    .all(options.rating !== undefined ? { rating: options.rating } : {}) as Array<{
    id: number;
    occurred_at: number;
    question: string;
    answer: string | null;
    rating: FeedbackRating;
    confidence: number | null;
    citations: string | null;
    note: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    occurredAt: new Date(r.occurred_at),
    question: r.question,
    answer: r.answer,
    rating: r.rating,
    confidence: r.confidence,
    citations: r.citations ? (JSON.parse(r.citations) as string[]) : [],
    note: r.note,
  }));
}

export function getFeedbackStats(db: DatabaseType): FeedbackStats {
  const row = db
    .prepare(`
      SELECT
        SUM(CASE WHEN rating = 'up' THEN 1 ELSE 0 END) AS up_count,
        SUM(CASE WHEN rating = 'down' THEN 1 ELSE 0 END) AS down_count,
        COUNT(*) AS total,
        AVG(confidence) AS avg_confidence
      FROM query_feedback
    `)
    .get() as {
    up_count: number | null;
    down_count: number | null;
    total: number;
    avg_confidence: number | null;
  };

  const up = row.up_count ?? 0;
  const down = row.down_count ?? 0;
  const total = row.total;
  return {
    upCount: up,
    downCount: down,
    total,
    upRate: total > 0 ? up / total : 0,
    averageConfidence: row.avg_confidence,
  };
}
