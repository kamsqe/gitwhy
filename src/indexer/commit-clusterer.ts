import type { CommitCategory, CommitInfo } from './types.js';

export interface ClusterOptions {
  /** Max gap between consecutive micro-commits to keep them in one cluster, in ms. Default 60 minutes. */
  readonly maxGapMs?: number;
  /** Only cluster commits whose category is in this set. Default ['micro']. */
  readonly clusterableCategories?: readonly CommitCategory[];
}

export interface CommitCluster {
  readonly clusterId: string;
  readonly author: { readonly name: string; readonly email: string };
  readonly commits: readonly CommitInfo[];
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly totalInsertions: number;
  readonly totalDeletions: number;
  readonly affectedFiles: readonly string[];
}

const DEFAULT_MAX_GAP_MS = 60 * 60 * 1000;

/**
 * Cluster consecutive micro-commits by the same author within a time window
 * into logical units suitable for a single LLM enrichment pass.
 *
 * Non-clusterable commits (normal, mega, merge, bot, etc.) break clusters.
 * The input order does not matter — we sort by date internally and walk
 * forward in time.
 */
export function clusterCommits(
  commits: readonly CommitInfo[],
  categoryByHash: ReadonlyMap<string, CommitCategory>,
  options: ClusterOptions = {},
): CommitCluster[] {
  const maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS;
  const clusterable = new Set<CommitCategory>(options.clusterableCategories ?? ['micro']);

  const sorted = [...commits].sort((a, b) => a.date.getTime() - b.date.getTime());
  const clusters: CommitCluster[] = [];
  let current: CommitInfo[] = [];

  const finalize = (): void => {
    if (current.length >= 2) {
      clusters.push(buildCluster(current));
    }
    current = [];
  };

  for (const commit of sorted) {
    const category = categoryByHash.get(commit.hash);
    if (!category || !clusterable.has(category)) {
      finalize();
      continue;
    }

    if (current.length === 0) {
      current.push(commit);
      continue;
    }

    const last = current[current.length - 1]!;
    const sameAuthor = last.author.email === commit.author.email;
    const gap = commit.date.getTime() - last.date.getTime();
    if (sameAuthor && gap <= maxGapMs) {
      current.push(commit);
    } else {
      finalize();
      current.push(commit);
    }
  }
  finalize();

  return clusters;
}

function buildCluster(commits: CommitInfo[]): CommitCluster {
  const first = commits[0]!;
  const last = commits[commits.length - 1]!;
  const fileSet = new Set<string>();
  let totalInsertions = 0;
  let totalDeletions = 0;
  for (const c of commits) {
    totalInsertions += c.insertions;
    totalDeletions += c.deletions;
    for (const f of c.filesChanged) fileSet.add(f.path);
  }
  return {
    clusterId: `cluster_${first.shortHash}_${last.shortHash}_${commits.length}`,
    author: { name: first.author.name, email: first.author.email },
    commits,
    startedAt: first.date,
    endedAt: last.date,
    totalInsertions,
    totalDeletions,
    affectedFiles: [...fileSet].sort(),
  };
}
