import { describe, expect, it } from 'vitest';
import { parseFilesChanged } from '../../src/indexer/git-reader.js';

describe('parseFilesChanged', () => {
  it('handles a simple modified file', () => {
    const raw = `:100644 100644 abc123 def456 M\tsrc/foo.ts
5\t3\tsrc/foo.ts
`;
    const result = parseFilesChanged(raw);
    expect(result).toEqual([
      {
        path: 'src/foo.ts',
        status: 'modified',
        insertions: 5,
        deletions: 3,
        isBinary: false,
      },
    ]);
  });

  it('marks binary files with isBinary=true and zero counts', () => {
    const raw = `:100644 100644 abc def A\tassets/logo.png
-\t-\tassets/logo.png
`;
    const result = parseFilesChanged(raw);
    expect(result).toHaveLength(1);
    expect(result[0]?.isBinary).toBe(true);
    expect(result[0]?.insertions).toBe(0);
    expect(result[0]?.deletions).toBe(0);
    expect(result[0]?.status).toBe('added');
  });

  it('parses multiple files with various statuses', () => {
    const raw = `:100644 100644 a b A\tnew.ts
:100644 100644 c d M\tchanged.ts
:100644 000000 e 0 D\tgone.ts
10\t0\tnew.ts
2\t1\tchanged.ts
0\t8\tgone.ts
`;
    const result = parseFilesChanged(raw);
    expect(result).toHaveLength(3);
    const byPath = Object.fromEntries(result.map((f) => [f.path, f]));
    expect(byPath['new.ts']?.status).toBe('added');
    expect(byPath['changed.ts']?.status).toBe('modified');
    expect(byPath['gone.ts']?.status).toBe('deleted');
    expect(byPath['new.ts']?.insertions).toBe(10);
    expect(byPath['gone.ts']?.deletions).toBe(8);
  });

  it('returns empty for empty input', () => {
    expect(parseFilesChanged('')).toEqual([]);
    expect(parseFilesChanged('\n\n\n')).toEqual([]);
  });

  it('defaults status to modified if only numstat is present', () => {
    const raw = `5\t2\tonly-numstat.ts\n`;
    const result = parseFilesChanged(raw);
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe('modified');
  });

  it('skips malformed raw lines without crashing', () => {
    const raw = `:garbage line\n5\t2\tvalid.ts\n`;
    const result = parseFilesChanged(raw);
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe('valid.ts');
  });
});
