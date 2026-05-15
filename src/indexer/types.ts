export type CommitCategory =
  | 'micro'
  | 'normal'
  | 'mega'
  | 'merge'
  | 'bot'
  | 'revert'
  | 'formatting'
  | 'initial';

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';

export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: FileStatus;
  insertions: number;
  deletions: number;
  isBinary: boolean;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  author: { name: string; email: string };
  date: Date;
  message: string;
  parentHashes: string[];
  filesChanged: ChangedFile[];
  insertions: number;
  deletions: number;
}

export interface CategoryResult {
  category: CommitCategory;
  confidence: number;
  reason: string;
}

export interface Categorizer {
  readonly name: string;
  readonly priority: number;
  categorize(commit: CommitInfo): CategoryResult | null;
}
