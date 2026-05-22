/**
 * Typed client for the gitwhy local HTTP backend.
 *
 * The backend is expected to be running locally via `gitwhy serve`
 * on http://127.0.0.1:3787 (default). User can override via settings.
 */

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:3787';
const STORAGE_KEY = 'gitwhy:backend-url';

export function getBackendUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_BACKEND_URL;
  return window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_BACKEND_URL;
}

export function setBackendUrl(url: string): void {
  if (typeof window === 'undefined') return;
  const normalized = url.replace(/\/+$/, '');
  window.localStorage.setItem(STORAGE_KEY, normalized);
}

// ─── Response types ──────────────────────────────────────────────────────

export interface HealthResponse {
  ok: boolean;
  version: string;
  cwd: string;
  initialized: boolean;
  provider: string;
  models: { indexing: string; query: string; embedding: string };
}

export interface StatusResponse {
  initialized: boolean;
  indexedCommits: number;
  gitTotalCommits: number;
  indexCoverage: number;
  embeddings: number;
  llmCalls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  lastIndexedAt: string | null;
  dbSizeBytes: number;
  topHotspots: Array<{ path: string; recentCommits: number }>;
  warnings: string[];
}

export interface Citation {
  commitHash: string;
  shortHash: string;
  score: number;
  date: string;
  authorName: string;
  originalMessage: string;
  enrichedSummary: string | null;
  /** Optional — present on Ask citations / Search hits when the backend has it. */
  category?: string | null;
}

export interface WhyResponse {
  answer: string;
  confidence: number;
  citations: Citation[];
  modelUsed: string | null;
  usage: { promptTokens: number; completionTokens: number };
  cached: boolean;
  retrieved: number;
  idk: boolean;
}

export interface RiskInputs {
  busFactor: number;
  soleOwnerSharePercent: number;
  ownerInactiveDays: number;
  recentCommits90d: number;
  totalCommits: number;
  contributorCount: number;
  isGhostCode: boolean;
}

export interface RiskResponse {
  text: string;
  data: {
    risk: {
      path: string;
      level: 'low' | 'medium' | 'high';
      score: number;
      reasons: string[];
      inputs: RiskInputs;
    };
    busFactor: {
      path: string;
      totalCommits: number;
      totalLinesChanged: number;
      busFactor: number;
      contributors: Array<{
        authorName: string;
        authorEmail: string;
        commits: number;
        linesChanged: number;
        sharePercent: number;
        lastCommit: string;
      }>;
      soleOwner: unknown;
    };
  };
}

export interface RelatedFileData {
  path: string;
  coCommits: number;
  thisFileCommits: number;
  otherFileCommits: number;
  forwardConfidence: number;
  jaccardLike: number;
}

export interface RelatedResponse {
  text: string;
  data: RelatedFileData[];
}

export interface SimpleTextResponse {
  text: string;
}

export interface SearchHit {
  commitHash: string;
  shortHash: string;
  score: number;
  date: string;
  authorName: string;
  originalMessage: string;
  enrichedSummary: string | null;
  category?: string | null;
}

export interface SearchResponse {
  text: string;
  data: SearchHit[];
}

export interface HistoryCommit {
  commitHash: string;
  shortHash: string;
  authorName: string;
  date: string;
  category: string;
  originalMessage: string;
  enrichedSummary: string | null;
}

export interface HistoryResponse {
  text: string;
  data: HistoryCommit[];
}

export type DiagnosticStatus = 'ok' | 'warn' | 'fail' | 'info';

export interface Diagnostic {
  id: string;
  label: string;
  status: DiagnosticStatus;
  detail: string;
  hint?: string;
}

export interface DiagnosticsResponse {
  ok: boolean;
  checks: Diagnostic[];
}

export interface IndexProgress {
  total: number;
  processed: number;
  enriched: number;
  skipped: number;
  errors: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  currentHash?: string;
}

export interface IndexResult {
  progress: IndexProgress;
  durationMs: number;
  stoppedReason?: 'budget' | 'complete' | 'cancelled';
}

export type IndexJobState = 'running' | 'done' | 'cancelled' | 'failed';

export interface IndexJob {
  id: string;
  state: IndexJobState;
  startedAt: number;
  endedAt: number | null;
  progress: IndexProgress | null;
  result: IndexResult | null;
  error: string | null;
  options: {
    provider?: 'openai' | 'gemini' | 'mock';
    model?: string;
    budgetUsd?: number;
    since?: string;
    until?: string;
    maxCount?: number;
  };
}

export type IndexJobEvent =
  | { type: 'started'; jobId: string; startedAt: number; total: number | null }
  | { type: 'progress'; progress: IndexProgress }
  | { type: 'done'; result: IndexResult }
  | { type: 'cancelled'; lastProgress: IndexProgress | null }
  | { type: 'failed'; message: string };

export interface IndexStartInput {
  provider?: 'openai' | 'gemini' | 'mock';
  model?: string;
  budgetUsd?: number;
  since?: string;
  until?: string;
  maxCount?: number;
  /** Force a full re-walk of git history (bypass incremental default). */
  full?: boolean;
}

export interface EstimateResponse {
  totalCommits: number;
  enrichmentModel: string;
  byCategory: Array<{
    category: string;
    count: number;
    llmCallsPlanned: number;
    estimatedPromptTokens: number;
    estimatedCompletionTokens: number;
    estimatedUsd: number;
  }>;
  grandTotal: { llmCallsPlanned: number; promptTokens: number; completionTokens: number; usd: number };
}

// ─── Errors ──────────────────────────────────────────────────────────────

export class GitWhyApiError extends Error {
  public readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'GitWhyApiError';
  }
}

export class GitWhyOfflineError extends Error {
  constructor(message = 'gitwhy backend is not reachable') {
    super(message);
    this.name = 'GitWhyOfflineError';
  }
}

// ─── Core fetch helper ──────────────────────────────────────────────────

async function call<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${getBackendUrl()}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (err) {
    throw new GitWhyOfflineError(
      err instanceof Error ? err.message : 'fetch failed',
    );
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
  if (!response.ok) {
    const rawMsg = typeof body.error === 'string' ? body.error : `HTTP ${response.status}`;
    throw new GitWhyApiError(response.status, humanizeError(rawMsg));
  }
  return body as T;
}

/**
 * The server returns raw Zod validation errors as JSON-stringified arrays
 * (e.g. `[{"code":"invalid_type","path":["question"],"message":"Required"}]`).
 * Rendering that directly in the UI is hostile. Extract the human messages
 * and join them, falling back to the raw string when it doesn't look like Zod.
 */
function humanizeError(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[')) return raw;
  try {
    const parsed = JSON.parse(trimmed) as Array<{ message?: string; path?: unknown[] }>;
    if (!Array.isArray(parsed) || parsed.length === 0) return raw;
    return parsed
      .map((issue) => {
        const field = Array.isArray(issue.path) && issue.path.length > 0
          ? issue.path.join('.')
          : null;
        const msg = typeof issue.message === 'string' ? issue.message : 'invalid';
        return field ? `${field}: ${msg}` : msg;
      })
      .join('; ');
  } catch {
    return raw;
  }
}

// ─── Endpoint wrappers ──────────────────────────────────────────────────

export const api = {
  health: (): Promise<HealthResponse> => call<HealthResponse>('/api/health'),

  status: (): Promise<StatusResponse> => call<StatusResponse>('/api/status'),

  why: (input: { question: string; topK?: number; minConfidence?: number; noCache?: boolean }): Promise<WhyResponse> =>
    call<WhyResponse>('/api/why', { method: 'POST', body: JSON.stringify(input) }),

  risk: (input: { path: string }): Promise<RiskResponse> =>
    call<RiskResponse>('/api/risk', { method: 'POST', body: JSON.stringify(input) }),

  related: (input: { path: string; limit?: number; minCoCommits?: number }): Promise<RelatedResponse> =>
    call<RelatedResponse>('/api/related', { method: 'POST', body: JSON.stringify(input) }),

  history: (input: { path: string; limit?: number }): Promise<HistoryResponse> => {
    const params = new URLSearchParams();
    params.set('path', input.path);
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    return call<HistoryResponse>(`/api/history?${params}`);
  },

  catchup: (input: { since: string; limit?: number }): Promise<SimpleTextResponse> =>
    call<SimpleTextResponse>('/api/catchup', { method: 'POST', body: JSON.stringify(input) }),

  search: (input: { query: string; topK?: number }): Promise<SearchResponse> =>
    call<SearchResponse>('/api/search', { method: 'POST', body: JSON.stringify(input) }),

  estimate: (input: { since?: string; until?: string; maxCount?: number } = {}): Promise<EstimateResponse> =>
    call<EstimateResponse>('/api/estimate', { method: 'POST', body: JSON.stringify(input) }),

  contextForPr: (input: { branch?: string; base?: string; files?: string[] }): Promise<SimpleTextResponse> =>
    call<SimpleTextResponse>('/api/context-for-pr', { method: 'POST', body: JSON.stringify(input) }),

  paths: (input: { q: string; limit?: number }): Promise<{ paths: string[] }> => {
    const params = new URLSearchParams();
    params.set('q', input.q);
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    return call<{ paths: string[] }>(`/api/paths?${params}`);
  },

  indexStart: (input: IndexStartInput): Promise<{ job: IndexJob }> =>
    call<{ job: IndexJob }>('/api/index/start', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  indexCancel: (): Promise<{ ok: true }> =>
    call<{ ok: true }>('/api/index/cancel', { method: 'POST' }),

  indexStatus: (): Promise<{ job: IndexJob | null }> =>
    call<{ job: IndexJob | null }>('/api/index/status'),

  /**
   * Open an EventSource against /api/index/stream. The web UI consumes
   * SSE directly via EventSource (not through `call()`), so this just
   * returns a constructed instance. Caller is responsible for closing.
   */
  indexStream: (): EventSource => new EventSource(`${getBackendUrl()}/api/index/stream`),

  diagnostics: (): Promise<DiagnosticsResponse> =>
    call<DiagnosticsResponse>('/api/diagnostics'),

  diff: (input: { hash: string }): Promise<{ hash: string; diff: string; truncated: boolean; maxBytes: number }> => {
    const params = new URLSearchParams();
    params.set('hash', input.hash);
    return call<{ hash: string; diff: string; truncated: boolean; maxBytes: number }>(
      `/api/diff?${params}`,
    );
  },
};
