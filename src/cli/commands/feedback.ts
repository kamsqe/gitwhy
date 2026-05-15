import { existsSync } from 'node:fs';
import { resolvePaths } from '../../config/loader.js';
import { getFeedbackStats, listFeedback, recordFeedback } from '../../storage/feedback-repo.js';
import type { FeedbackRating } from '../../storage/feedback-repo.js';
import { openDatabase } from '../../storage/sqlite.js';

export interface FeedbackSubmitOptions {
  readonly cwd: string;
  readonly rating: FeedbackRating;
  readonly question: string;
  readonly answer?: string;
  readonly confidence?: number;
  readonly citations?: readonly string[];
  readonly note?: string;
}

export interface FeedbackListOptions {
  readonly cwd: string;
  readonly limit?: number;
  readonly rating?: FeedbackRating;
}

function openOrThrow(cwd: string): ReturnType<typeof openDatabase> {
  const paths = resolvePaths(cwd);
  if (!existsSync(paths.commitsDb)) {
    throw new Error(`gitwhy is not initialized at ${cwd}. Run \`gitwhy init\` first.`);
  }
  return openDatabase({ path: paths.commitsDb });
}

export function submitFeedback(options: FeedbackSubmitOptions): number {
  const db = openOrThrow(options.cwd);
  try {
    return recordFeedback(db, {
      question: options.question,
      ...(options.answer !== undefined && { answer: options.answer }),
      rating: options.rating,
      ...(options.confidence !== undefined && { confidence: options.confidence }),
      ...(options.citations !== undefined && { citations: options.citations }),
      ...(options.note !== undefined && { note: options.note }),
    });
  } finally {
    db.close();
  }
}

export function summarizeFeedback(cwd: string): ReturnType<typeof getFeedbackStats> {
  const db = openOrThrow(cwd);
  try {
    return getFeedbackStats(db);
  } finally {
    db.close();
  }
}

export function recentFeedback(
  options: FeedbackListOptions,
): ReturnType<typeof listFeedback> {
  const db = openOrThrow(options.cwd);
  try {
    return listFeedback(db, {
      ...(options.limit !== undefined && { limit: options.limit }),
      ...(options.rating !== undefined && { rating: options.rating }),
    });
  } finally {
    db.close();
  }
}
