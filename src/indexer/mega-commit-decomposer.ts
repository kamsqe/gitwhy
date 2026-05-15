import type { ChangedFile, CommitInfo } from './types.js';

export interface DecomposedDiffGroup {
  /** Stable group key, e.g. `src/api` or `<root>` for top-level files. */
  readonly groupKey: string;
  readonly files: readonly ChangedFile[];
  /** Diff text restricted to files in this group. */
  readonly diff: string;
}

export interface DecomposeOptions {
  /** How many path components to use as the group key. Default 2. */
  readonly groupDepth?: number;
  /** Soft target for group count. Decomposer may merge tiny groups into siblings. Default 8. */
  readonly maxGroups?: number;
}

const DEFAULT_GROUP_DEPTH = 2;
const DEFAULT_MAX_GROUPS = 8;

/**
 * Split a mega-commit's diff into per-module groups based on file paths.
 * Each group's diff can then be analyzed independently to keep per-call
 * token counts bounded.
 */
export function decomposeMegaCommit(
  commit: CommitInfo,
  fullDiff: string,
  options: DecomposeOptions = {},
): DecomposedDiffGroup[] {
  const groupDepth = options.groupDepth ?? DEFAULT_GROUP_DEPTH;
  const maxGroups = options.maxGroups ?? DEFAULT_MAX_GROUPS;

  const filesByGroup = new Map<string, ChangedFile[]>();
  for (const file of commit.filesChanged) {
    const key = groupKeyOf(file.path, groupDepth);
    const existing = filesByGroup.get(key) ?? [];
    existing.push(file);
    filesByGroup.set(key, existing);
  }

  const merged = mergeSmallGroups(filesByGroup, maxGroups);
  const fileDiffs = splitDiffByFile(fullDiff);

  return [...merged.entries()]
    .map(([groupKey, files]) => ({
      groupKey,
      files,
      diff: files
        .map((f) => fileDiffs.get(f.path) ?? '')
        .filter((s) => s.length > 0)
        .join('\n'),
    }))
    .sort((a, b) => a.groupKey.localeCompare(b.groupKey));
}

function groupKeyOf(path: string, depth: number): string {
  const parts = path.split('/');
  if (parts.length === 1) return '<root>';
  const slice = parts.slice(0, Math.min(depth, parts.length - 1));
  return slice.join('/');
}

function mergeSmallGroups(
  groups: Map<string, ChangedFile[]>,
  maxGroups: number,
): Map<string, ChangedFile[]> {
  if (groups.size <= maxGroups) return groups;

  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const top = sorted.slice(0, maxGroups - 1);
  const overflow = sorted.slice(maxGroups - 1);

  const result = new Map<string, ChangedFile[]>(top);
  if (overflow.length > 0) {
    const merged = overflow.flatMap(([, files]) => files);
    result.set('<other>', merged);
  }
  return result;
}

export function splitDiffByFile(fullDiff: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = fullDiff.split('\n');

  let currentPath: string | null = null;
  let currentChunk: string[] = [];

  const flush = (): void => {
    if (currentPath !== null && currentChunk.length > 0) {
      result.set(currentPath, currentChunk.join('\n'));
    }
  };

  for (const line of lines) {
    const headerMatch = /^diff --git a\/(\S+) b\/(\S+)/.exec(line);
    if (headerMatch) {
      flush();
      currentPath = headerMatch[2] ?? null;
      currentChunk = [line];
      continue;
    }
    if (currentPath !== null) {
      currentChunk.push(line);
    }
  }
  flush();
  return result;
}
