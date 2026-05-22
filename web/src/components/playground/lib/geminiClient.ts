/**
 * Browser-direct Gemini API client. The user's API key lives in
 * localStorage and is sent only to Google's API endpoint — never to
 * our origin. This is the "bring your own key" path that lets the
 * Playground answer questions without a backend.
 *
 * No taskType is set on embed calls so the query-side embedding is
 * generated the same way gitwhy indexed the commits server-side
 * (otherwise cosine similarity would be misaligned and retrieval
 * would feel random).
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const KEY_STORAGE = 'gitwhy-playground:gemini-key';
const DEFAULT_GENERATION_MODEL = 'gemini-3.1-flash-lite';
const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';

export function getStoredKey(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(KEY_STORAGE);
}

export function setStoredKey(key: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY_STORAGE, key);
}

export function clearStoredKey(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(KEY_STORAGE);
}

export class GeminiKeyMissingError extends Error {
  constructor() {
    super('No Gemini API key configured.');
    this.name = 'GeminiKeyMissingError';
  }
}

export class GeminiApiError extends Error {
  public readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'GeminiApiError';
  }
}

interface EmbedResponse {
  embedding: { values: number[] };
}

/**
 * Get a Float32Array embedding for `text`. The embedding model has to
 * match what's stored in the playground DB (gemini-embedding-001 → 3072
 * dim) — otherwise cosine similarity returns nonsense.
 */
export async function embedQuery(text: string, apiKey: string): Promise<Float32Array> {
  if (!apiKey) throw new GeminiKeyMissingError();
  const url = `${API_BASE}/models/${DEFAULT_EMBEDDING_MODEL}:embedContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: { parts: [{ text }] },
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new GeminiApiError(
      res.status,
      body.error?.message ?? `Embedding request failed (${res.status}).`,
    );
  }
  const body = (await res.json()) as EmbedResponse;
  return new Float32Array(body.embedding.values);
}

interface GenerateResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export interface GenerateResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Run a one-shot generation. The text returned is the concatenation of
 * all parts in the first candidate. `usageMetadata` lets the UI surface
 * "you spent N tokens" so users see what they paid for.
 */
export async function generate(
  prompt: string,
  apiKey: string,
  model: string = DEFAULT_GENERATION_MODEL,
): Promise<GenerateResult> {
  if (!apiKey) throw new GeminiKeyMissingError();
  const url = `${API_BASE}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        // Disable thinking — flash-lite supports a "thinkingBudget" knob and
        // setting it to 0 keeps responses snappy + cost predictable. Same
        // setting gitwhy's server-side gemini provider uses.
        thinkingConfig: { thinkingBudget: 0 },
        temperature: 0.2,
        maxOutputTokens: 1024,
      },
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new GeminiApiError(
      res.status,
      body.error?.message ?? `Generation request failed (${res.status}).`,
    );
  }
  const body = (await res.json()) as GenerateResponse;
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? '').join('').trim();
  return {
    text,
    promptTokens: body.usageMetadata?.promptTokenCount ?? 0,
    completionTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
  };
}
