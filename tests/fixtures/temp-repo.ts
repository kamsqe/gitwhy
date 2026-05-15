import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Creates a temporary git repository, runs the provided setup function inside
 * it, and returns the path. Caller is responsible for calling `cleanup()`.
 *
 * Used by tests that need a real git repo to exercise the GitReader and
 * indexer end-to-end.
 */
export interface TempRepo {
  readonly path: string;
  commit(args: { message: string; files: Record<string, string>; date?: string; author?: { name: string; email: string } }): string;
  cleanup(): void;
}

export function createTempRepo(): TempRepo {
  const path = mkdtempSync(join(tmpdir(), 'gitwhy-test-'));
  run(path, 'git init -q -b main');
  run(path, 'git config user.email "test@example.com"');
  run(path, 'git config user.name "Test User"');
  run(path, 'git config commit.gpgsign false');
  run(path, 'git config core.autocrlf false');

  return {
    path,
    commit({ message, files, date, author }) {
      for (const [filename, content] of Object.entries(files)) {
        const full = join(path, filename);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content);
      }
      run(path, 'git add -A');
      const env: Record<string, string> = { ...process.env } as Record<string, string>;
      if (date) {
        env['GIT_AUTHOR_DATE'] = date;
        env['GIT_COMMITTER_DATE'] = date;
      }
      if (author) {
        env['GIT_AUTHOR_NAME'] = author.name;
        env['GIT_AUTHOR_EMAIL'] = author.email;
        env['GIT_COMMITTER_NAME'] = author.name;
        env['GIT_COMMITTER_EMAIL'] = author.email;
      }
      execSync(`git commit -q -m ${JSON.stringify(message)}`, { cwd: path, env });
      return execSync('git rev-parse HEAD', { cwd: path, env }).toString().trim();
    },
    cleanup() {
      rmSync(path, { recursive: true, force: true });
    },
  };
}

function run(cwd: string, cmd: string): void {
  execSync(cmd, { cwd, stdio: 'pipe' });
}
