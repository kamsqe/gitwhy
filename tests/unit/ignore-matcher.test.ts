import { describe, expect, it } from 'vitest';
import { createMatcher, DEFAULT_IGNORE_PATTERNS } from '../../src/indexer/ignore-matcher.js';

describe('ignore-matcher', () => {
  it('matches built-in lockfile patterns at root and nested', () => {
    const m = createMatcher(DEFAULT_IGNORE_PATTERNS);
    expect(m.isExcluded('pnpm-lock.yaml')).toBe(true);
    expect(m.isExcluded('packages/a/pnpm-lock.yaml')).toBe(true);
    expect(m.isExcluded('packages/a/sub/pnpm-lock.yaml')).toBe(true);
    expect(m.isExcluded('go.sum')).toBe(true);
    expect(m.isExcluded('Cargo.lock')).toBe(true);
  });

  it('matches dir-prefixed patterns like dist/**', () => {
    const m = createMatcher(DEFAULT_IGNORE_PATTERNS);
    expect(m.isExcluded('dist/main.js')).toBe(true);
    expect(m.isExcluded('dist/sub/page.css')).toBe(true);
    expect(m.isExcluded('out/index.html')).toBe(true);
    expect(m.isExcluded('node_modules/foo/index.js')).toBe(true);
  });

  it('matches **/*.min.js', () => {
    const m = createMatcher(DEFAULT_IGNORE_PATTERNS);
    expect(m.isExcluded('script.min.js')).toBe(true);
    expect(m.isExcluded('a/b/script.min.js')).toBe(true);
    expect(m.isExcluded('script.js')).toBe(false);
  });

  it('does not over-match normal source files', () => {
    const m = createMatcher(DEFAULT_IGNORE_PATTERNS);
    expect(m.isExcluded('src/index.ts')).toBe(false);
    expect(m.isExcluded('README.md')).toBe(false);
    expect(m.isExcluded('package.json')).toBe(false); // root package.json is NOT excluded
    expect(m.isExcluded('lib/util.js')).toBe(false);
  });

  it('honors a root-anchored pattern', () => {
    // Leading slash anchors to root; without it, `/dist` only matches at root.
    const m = createMatcher(['/dist/**']);
    expect(m.isExcluded('dist/main.js')).toBe(true);
    expect(m.isExcluded('apps/foo/dist/main.js')).toBe(false);
  });

  it('honors a trailing slash → directory', () => {
    const m = createMatcher(['generated/']);
    expect(m.isExcluded('generated/file.ts')).toBe(true);
    expect(m.isExcluded('src/generated/file.ts')).toBe(true);
  });

  it('honors `?` single-char wildcard', () => {
    const m = createMatcher(['file?.txt']);
    expect(m.isExcluded('file1.txt')).toBe(true);
    expect(m.isExcluded('fileab.txt')).toBe(false);
  });

  it('ignores empty lines and comments in user patterns', () => {
    const m = createMatcher(['', '# comment', '  ', 'custom/**']);
    // (The loader, not the matcher, drops comments — but createMatcher with
    // a literal "#" pattern shouldn't match by accident.)
    expect(m.isExcluded('custom/x.ts')).toBe(true);
    expect(m.isExcluded('src/x.ts')).toBe(false);
  });
});
