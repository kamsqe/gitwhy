import { describe, expect, it } from 'vitest';
import {
  decomposeMegaCommit,
  splitDiffByFile,
} from '../../src/indexer/mega-commit-decomposer.js';
import type { CommitInfo } from '../../src/indexer/types.js';

function commitWithFiles(paths: string[]): CommitInfo {
  return {
    hash: 'abc',
    shortHash: 'abc',
    author: { name: 'a', email: 'a@b' },
    date: new Date('2026-01-01T00:00:00Z'),
    message: 'big change',
    parentHashes: ['x'],
    filesChanged: paths.map((p) => ({
      path: p,
      status: 'modified' as const,
      insertions: 10,
      deletions: 5,
      isBinary: false,
    })),
    insertions: paths.length * 10,
    deletions: paths.length * 5,
  };
}

describe('decomposeMegaCommit', () => {
  it('groups files by top-2 path segments', () => {
    const commit = commitWithFiles([
      'src/api/users.ts',
      'src/api/auth.ts',
      'src/util/format.ts',
      'tests/api/users.test.ts',
    ]);
    const groups = decomposeMegaCommit(commit, '');
    const keys = groups.map((g) => g.groupKey);
    expect(keys).toContain('src/api');
    expect(keys).toContain('src/util');
    expect(keys).toContain('tests/api');
  });

  it('uses <root> for top-level files', () => {
    const commit = commitWithFiles(['README.md', 'package.json']);
    const groups = decomposeMegaCommit(commit, '');
    expect(groups.map((g) => g.groupKey)).toContain('<root>');
  });

  it('merges overflow groups into <other> when exceeding maxGroups', () => {
    const paths = ['a/x.ts', 'b/x.ts', 'c/x.ts', 'd/x.ts', 'e/x.ts', 'f/x.ts'];
    const commit = commitWithFiles(paths);
    const groups = decomposeMegaCommit(commit, '', { maxGroups: 3 });
    expect(groups.length).toBeLessThanOrEqual(3);
    expect(groups.map((g) => g.groupKey)).toContain('<other>');
  });

  it('attaches the diff chunk for each file to its group', () => {
    const commit = commitWithFiles(['src/foo.ts', 'src/bar.ts']);
    const fullDiff = `diff --git a/src/foo.ts b/src/foo.ts
@@ -1 +1 @@
-old foo
+new foo
diff --git a/src/bar.ts b/src/bar.ts
@@ -1 +1 @@
-old bar
+new bar`;
    const groups = decomposeMegaCommit(commit, fullDiff);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.diff).toContain('new foo');
    expect(groups[0]?.diff).toContain('new bar');
  });
});

describe('splitDiffByFile', () => {
  it('splits a multi-file diff into per-file chunks', () => {
    const diff = `diff --git a/a.ts b/a.ts
content for a
diff --git a/b.ts b/b.ts
content for b`;
    const map = splitDiffByFile(diff);
    expect(map.size).toBe(2);
    expect(map.get('a.ts')).toContain('content for a');
    expect(map.get('b.ts')).toContain('content for b');
  });

  it('returns empty map for empty input', () => {
    expect(splitDiffByFile('').size).toBe(0);
  });
});
