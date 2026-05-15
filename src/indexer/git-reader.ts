import { simpleGit } from 'simple-git';
import type { SimpleGit } from 'simple-git';
import type { ChangedFile, CommitInfo, FileStatus } from './types.js';

export interface GitReaderOptions {
  readonly cwd: string;
  readonly since?: string;
  readonly until?: string;
  readonly branches?: readonly string[];
  readonly maxCount?: number;
  readonly pathInclude?: readonly string[];
  readonly pathExclude?: readonly string[];
}

export interface GitReaderDiagnostics {
  readonly isGitRepo: boolean;
  readonly isEmpty: boolean;
  readonly isShallow: boolean;
  readonly currentBranch: string | null;
  readonly totalCommits: number;
}

export interface GitReader {
  count(): Promise<number>;
  iterate(): AsyncIterable<CommitInfo>;
  loadDiff(hash: string): Promise<string>;
  diagnose(): Promise<GitReaderDiagnostics>;
}

export function createGitReader(options: GitReaderOptions): GitReader {
  const git = simpleGit({ baseDir: options.cwd });
  return new GitReaderImpl(git, options);
}

export interface ScopeFromConfig {
  readonly since?: string;
  readonly until?: string;
  readonly branches?: readonly string[];
  readonly pathInclude?: readonly string[];
  readonly pathExclude?: readonly string[];
}

export interface ScopeOverrides {
  readonly since?: string;
  readonly until?: string;
  readonly maxCount?: number;
}

/**
 * Build GitReaderOptions by merging a cwd, a config.scope object, and
 * optional CLI overrides. CLI overrides win over config; both are optional.
 */
export function gitReaderOptionsFromConfig(
  cwd: string,
  scope: ScopeFromConfig = {},
  overrides: ScopeOverrides = {},
): GitReaderOptions {
  const since = overrides.since ?? scope.since;
  const until = overrides.until ?? scope.until;
  return {
    cwd,
    ...(since !== undefined && { since }),
    ...(until !== undefined && { until }),
    ...(overrides.maxCount !== undefined && { maxCount: overrides.maxCount }),
    ...(scope.branches !== undefined && { branches: scope.branches }),
    ...(scope.pathInclude !== undefined && { pathInclude: scope.pathInclude }),
    ...(scope.pathExclude !== undefined && { pathExclude: scope.pathExclude }),
  };
}

class GitReaderImpl implements GitReader {
  constructor(
    private readonly git: SimpleGit,
    private readonly options: GitReaderOptions,
  ) {}

  async count(): Promise<number> {
    const args = ['rev-list', '--count', ...buildRangeArgs(this.options)];
    const out = await this.git.raw(args);
    return parseInt(out.trim(), 10);
  }

  async *iterate(): AsyncIterable<CommitInfo> {
    const log = await this.git.log({
      format: {
        hash: '%H',
        shortHash: '%h',
        authorName: '%an',
        authorEmail: '%ae',
        committerDate: '%cI',
        parents: '%P',
        subject: '%s',
        body: '%b',
      },
      ...buildLogRange(this.options),
    });

    for (const entry of log.all) {
      const filesChanged = await this.loadFilesChanged(entry.hash);
      const insertions = filesChanged.reduce((s, f) => s + f.insertions, 0);
      const deletions = filesChanged.reduce((s, f) => s + f.deletions, 0);
      const body = entry.body?.trim() ?? '';
      const message = body ? `${entry.subject}\n\n${body}` : entry.subject;

      yield {
        hash: entry.hash,
        shortHash: entry.shortHash,
        author: { name: entry.authorName, email: entry.authorEmail },
        date: new Date(entry.committerDate),
        message,
        parentHashes: entry.parents ? entry.parents.split(/\s+/).filter(Boolean) : [],
        filesChanged,
        insertions,
        deletions,
      };
    }
  }

  async loadDiff(hash: string): Promise<string> {
    return this.git.raw(['show', hash, '--format=', '--no-renames']);
  }

  async diagnose(): Promise<GitReaderDiagnostics> {
    const isGitRepo = await this.git.checkIsRepo().catch(() => false);
    if (!isGitRepo) {
      return {
        isGitRepo: false,
        isEmpty: true,
        isShallow: false,
        currentBranch: null,
        totalCommits: 0,
      };
    }

    const totalCommits = await this.git
      .raw(['rev-list', '--count', 'HEAD'])
      .then((s) => parseInt(s.trim(), 10))
      .catch(() => 0);

    const isShallow = await this.git
      .raw(['rev-parse', '--is-shallow-repository'])
      .then((s) => s.trim() === 'true')
      .catch(() => false);

    const currentBranch = await this.git
      .raw(['rev-parse', '--abbrev-ref', 'HEAD'])
      .then((s) => s.trim())
      .catch(() => null);

    return {
      isGitRepo: true,
      isEmpty: totalCommits === 0,
      isShallow,
      currentBranch: currentBranch === 'HEAD' ? null : currentBranch,
      totalCommits,
    };
  }

  private async loadFilesChanged(hash: string): Promise<ChangedFile[]> {
    const out = await this.git.raw([
      'show',
      hash,
      '--raw',
      '--numstat',
      '--format=',
      '--no-renames',
    ]);
    return parseFilesChanged(out);
  }
}

function buildLogRange(opts: GitReaderOptions): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  if (opts.since !== undefined) result['--since'] = opts.since;
  if (opts.until !== undefined) result['--until'] = opts.until;
  if (opts.maxCount !== undefined) result['--max-count'] = opts.maxCount;
  return result;
}

function buildRangeArgs(opts: GitReaderOptions): string[] {
  const args: string[] = [];
  if (opts.since !== undefined) args.push(`--since=${opts.since}`);
  if (opts.until !== undefined) args.push(`--until=${opts.until}`);
  if (opts.maxCount !== undefined) args.push(`--max-count=${opts.maxCount}`);
  if (opts.branches && opts.branches.length > 0) {
    args.push(...opts.branches);
  } else {
    args.push('HEAD');
  }
  return args;
}

const STATUS_MAP: Record<string, FileStatus> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
};

export function parseFilesChanged(rawOutput: string): ChangedFile[] {
  const files = new Map<string, Partial<ChangedFile> & { path: string }>();
  for (const rawLine of rawOutput.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line) continue;

    if (line.startsWith(':')) {
      const match = /^:\d+\s+\d+\s+\w+\s+\w+\s+(\w)\s+(.+)$/.exec(line);
      if (!match) continue;
      const statusChar = match[1]!.charAt(0);
      const path = match[2]!;
      const existing = files.get(path) ?? { path };
      existing.status = STATUS_MAP[statusChar] ?? 'modified';
      files.set(path, existing);
      continue;
    }

    const parts = line.split('\t');
    if (parts.length !== 3) continue;
    const [insRaw, delRaw, path] = parts as [string, string, string];
    const existing = files.get(path) ?? { path };
    const isBinary = insRaw === '-' || delRaw === '-';
    existing.insertions = isBinary ? 0 : Number.parseInt(insRaw, 10);
    existing.deletions = isBinary ? 0 : Number.parseInt(delRaw, 10);
    existing.isBinary = isBinary;
    files.set(path, existing);
  }

  return [...files.values()].map((f) => ({
    path: f.path,
    status: f.status ?? 'modified',
    insertions: f.insertions ?? 0,
    deletions: f.deletions ?? 0,
    isBinary: f.isBinary ?? false,
  }));
}
