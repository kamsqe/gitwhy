import { beforeEach, describe, expect, it } from 'vitest';
import {
  getFeedbackStats,
  listFeedback,
  recordFeedback,
} from '../../src/storage/feedback-repo.js';
import { openDatabase } from '../../src/storage/sqlite.js';
import type { Database as DatabaseType } from 'better-sqlite3';

describe('feedback repo', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = openDatabase({ path: ':memory:', memory: true });
  });

  it('records feedback and returns an integer id', () => {
    const id = recordFeedback(db, {
      question: 'why does X exist?',
      rating: 'up',
      confidence: 0.83,
      citations: ['abc1234', 'def5678'],
    });
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  it('rejects ratings outside up/down via CHECK constraint', () => {
    expect(() =>
      recordFeedback(db, {
        question: 'q',
        rating: 'maybe' as 'up',
      }),
    ).toThrow();
  });

  it('listFeedback returns rows newest-first', () => {
    recordFeedback(db, { question: 'old', rating: 'up' });
    recordFeedback(db, { question: 'newer', rating: 'down' });
    recordFeedback(db, { question: 'newest', rating: 'up' });
    const rows = listFeedback(db);
    expect(rows[0]?.question).toBe('newest');
    expect(rows[2]?.question).toBe('old');
  });

  it('listFeedback filters by rating', () => {
    recordFeedback(db, { question: 'a', rating: 'up' });
    recordFeedback(db, { question: 'b', rating: 'down' });
    recordFeedback(db, { question: 'c', rating: 'up' });
    const downs = listFeedback(db, { rating: 'down' });
    expect(downs).toHaveLength(1);
    expect(downs[0]?.question).toBe('b');
  });

  it('listFeedback honors the limit option', () => {
    for (let i = 0; i < 5; i++) {
      recordFeedback(db, { question: `q${i}`, rating: 'up' });
    }
    expect(listFeedback(db, { limit: 3 })).toHaveLength(3);
  });

  it('round-trips citations as JSON', () => {
    recordFeedback(db, {
      question: 'q',
      rating: 'up',
      citations: ['aaa', 'bbb'],
    });
    const rows = listFeedback(db);
    expect(rows[0]?.citations).toEqual(['aaa', 'bbb']);
  });

  it('getFeedbackStats aggregates up/down counts and rate', () => {
    recordFeedback(db, { question: 'a', rating: 'up', confidence: 0.8 });
    recordFeedback(db, { question: 'b', rating: 'up', confidence: 0.6 });
    recordFeedback(db, { question: 'c', rating: 'down', confidence: 0.4 });
    const stats = getFeedbackStats(db);
    expect(stats.upCount).toBe(2);
    expect(stats.downCount).toBe(1);
    expect(stats.total).toBe(3);
    expect(stats.upRate).toBeCloseTo(2 / 3, 5);
    expect(stats.averageConfidence).toBeCloseTo(0.6, 5);
  });

  it('getFeedbackStats handles empty table', () => {
    const stats = getFeedbackStats(db);
    expect(stats.total).toBe(0);
    expect(stats.upRate).toBe(0);
    expect(stats.averageConfidence).toBeNull();
  });
});
