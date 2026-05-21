/**
 * Typed client for the gitwhy local HTTP backend.
 *
 * The backend is expected to be running locally via `npx gitwhy serve`
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
    const msg = typeof body.error === 'string' ? body.error : `HTTP ${response.status}`;
    throw new GitWhyApiError(response.status, msg);
  }
  return body as T;
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

  history: (input: { path: string; limit?: number }): Promise<SimpleTextResponse> => {
    const params = new URLSearchParams();
    params.set('path', input.path);
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    return call<SimpleTextResponse>(`/api/history?${params}`);
  },

  catchup: (input: { since: string; limit?: number }): Promise<SimpleTextResponse> =>
    call<SimpleTextResponse>('/api/catchup', { method: 'POST', body: JSON.stringify(input) }),

  search: (input: { query: string; topK?: number }): Promise<SimpleTextResponse> =>
    call<SimpleTextResponse>('/api/search', { method: 'POST', body: JSON.stringify(input) }),

  estimate: (input: { since?: string; until?: string; maxCount?: number } = {}): Promise<EstimateResponse> =>
    call<EstimateResponse>('/api/estimate', { method: 'POST', body: JSON.stringify(input) }),

  contextForPr: (input: { branch?: string; base?: string; files?: string[] }): Promise<SimpleTextResponse> =>
    call<SimpleTextResponse>('/api/context-for-pr', { method: 'POST', body: JSON.stringify(input) }),
};
