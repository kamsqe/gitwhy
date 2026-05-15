import { existsSync } from 'node:fs';
import { defaultConfig } from '../../config/index.js';
import { ensureDirs, resolvePaths, writeConfig } from '../../config/loader.js';
import { createGitReader } from '../../indexer/git-reader.js';
import { openDatabase } from '../../storage/sqlite.js';

export interface InitOptions {
  readonly cwd: string;
  readonly force?: boolean;
}

export interface InitResult {
  readonly created: boolean;
  readonly path: string;
  readonly diagnostics: {
    readonly isGitRepo: boolean;
    readonly isEmpty: boolean;
    readonly isShallow: boolean;
    readonly totalCommits: number;
  };
  readonly warnings: readonly string[];
}

export async function runInit(options: InitOptions): Promise<InitResult> {
  const cwd = options.cwd;
  const paths = resolvePaths(cwd);
  const warnings: string[] = [];

  if (existsSync(paths.configFile) && !options.force) {
    const reader = createGitReader({ cwd });
    const diag = await reader.diagnose();
    return {
      created: false,
      path: paths.root,
      diagnostics: {
        isGitRepo: diag.isGitRepo,
        isEmpty: diag.isEmpty,
        isShallow: diag.isShallow,
        totalCommits: diag.totalCommits,
      },
      warnings: [`Config already exists at ${paths.configFile}. Use --force to overwrite.`],
    };
  }

  const reader = createGitReader({ cwd });
  const diag = await reader.diagnose();

  if (!diag.isGitRepo) {
    warnings.push(`No git repository detected at ${cwd}. Run \`git init\` first.`);
  } else if (diag.isEmpty) {
    warnings.push('Git repository has no commits yet — index will be empty.');
  } else if (diag.isShallow) {
    warnings.push('Git repository is a shallow clone. Run `git fetch --unshallow` to index full history.');
  }

  ensureDirs(cwd, defaultConfig);
  writeConfig(cwd, defaultConfig);

  const db = openDatabase({ path: paths.commitsDb });
  db.close();

  return {
    created: true,
    path: paths.root,
    diagnostics: {
      isGitRepo: diag.isGitRepo,
      isEmpty: diag.isEmpty,
      isShallow: diag.isShallow,
      totalCommits: diag.totalCommits,
    },
    warnings,
  };
}
