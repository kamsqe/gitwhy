import { describe, expect, it } from 'vitest';
import { gitReaderOptionsFromConfig } from '../../src/indexer/git-reader.js';

describe('gitReaderOptionsFromConfig', () => {
  it('returns just cwd when scope and overrides are empty', () => {
    expect(gitReaderOptionsFromConfig('/repo')).toEqual({ cwd: '/repo' });
  });

  it('passes scope.since/until/branches/paths through', () => {
    const opts = gitReaderOptionsFromConfig('/repo', {
      since: '2024-01-01',
      until: '2024-12-31',
      branches: ['main', 'release'],
      pathInclude: ['src/'],
      pathExclude: ['vendor/'],
    });
    expect(opts).toEqual({
      cwd: '/repo',
      since: '2024-01-01',
      until: '2024-12-31',
      branches: ['main', 'release'],
      pathInclude: ['src/'],
      pathExclude: ['vendor/'],
    });
  });

  it('CLI overrides win over config.scope for since/until/maxCount', () => {
    const opts = gitReaderOptionsFromConfig(
      '/repo',
      { since: '2024-01-01', until: '2024-06-30' },
      { since: '6 months ago', until: '1 week ago', maxCount: 50 },
    );
    expect(opts.since).toBe('6 months ago');
    expect(opts.until).toBe('1 week ago');
    expect(opts.maxCount).toBe(50);
  });

  it('partial overrides leave the rest of config.scope intact', () => {
    const opts = gitReaderOptionsFromConfig(
      '/repo',
      { since: '2024-01-01', until: '2024-12-31' },
      { maxCount: 100 },
    );
    expect(opts.since).toBe('2024-01-01');
    expect(opts.until).toBe('2024-12-31');
    expect(opts.maxCount).toBe(100);
  });

  it('omits keys that have no value (no `since: undefined` in output)', () => {
    const opts = gitReaderOptionsFromConfig('/repo', {}, {});
    expect('since' in opts).toBe(false);
    expect('until' in opts).toBe(false);
    expect('maxCount' in opts).toBe(false);
  });
});
