import type { Database as DatabaseType } from 'better-sqlite3';
import { upsertCommit } from '../../src/storage/commits-repo.js';
import type {
  CommitCategory,
  CommitInfo,
  FileStatus,
} from '../../src/indexer/types.js';

export interface SeedCommitInput {
  readonly hash: string;
  readonly author: string;
  readonly email?: string;
  readonly date: string;
  readonly category?: CommitCategory;
  readonly message?: string;
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly insertions?: number;
    readonly deletions?: number;
    readonly status?: FileStatus;
  }>;
}

/**
 * Seed the commits + commit_files tables with controlled data. Used by
 * Insight-agent unit tests instead of running the full indexer against
 * a temp git repo.
 */
export function seedCommit(db: DatabaseType, input: SeedCommitInput): void {
  const files = input.files.map((f) => ({
    path: f.path,
    status: (f.status ?? 'modified') as FileStatus,
    insertions: f.insertions ?? 5,
    deletions: f.deletions ?? 1,
    isBinary: false,
  }));
  const totalInsertions = files.reduce((s, f) => s + f.insertions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);
  const commit: CommitInfo = {
    hash: input.hash,
    shortHash: input.hash.slice(0, 7),
    author: { name: input.author, email: input.email ?? `${input.author}@example.com` },
    date: new Date(input.date),
    message: input.message ?? `${input.author}: ${input.files.map((f) => f.path).join(', ')}`,
    parentHashes: ['p'],
    filesChanged: files,
    insertions: totalInsertions,
    deletions: totalDeletions,
  };
  upsertCommit(db, {
    commit,
    category: input.category ?? 'normal',
    categoryReason: 'seeded for test',
  });
}
