import { GoogleGenAI } from '@google/genai';
import type {
  LlmCompletionParams,
  LlmCompletionResult,
  LlmEmbedParams,
  LlmEmbedResult,
  LlmMessage,
  LlmProvider,
} from './types.js';

export interface GeminiProviderOptions {
  readonly apiKey: string;
  readonly defaultModel?: string;
  readonly defaultEmbeddingModel?: string;
  /** Retry behavior on 429 / quota errors. Default 5 attempts with exponential backoff. */
  readonly maxRetries?: number;
  /** Initial retry delay in ms. Default 4000 (then 8s, 16s, 32s, 64s). */
  readonly retryBaseDelayMs?: number;
  /**
   * Minimum gap between consecutive requests (ms). Default 6500 — gives ~9
   * requests per minute, safely under Gemini's 10 RPM free-tier limit for
   * 2.5-flash. Set to 0 to disable for paid tier.
   */
  readonly minRequestIntervalMs?: number;
}

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_RETRY_BASE_DELAY_MS = 4000;
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 6500;

export function createGeminiProvider(options: GeminiProviderOptions): LlmProvider {
  const ai = new GoogleGenAI({ apiKey: options.apiKey });
  const defaultModel = options.defaultModel ?? DEFAULT_MODEL;
  const defaultEmbeddingModel = options.defaultEmbeddingModel ?? DEFAULT_EMBEDDING_MODEL;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const minIntervalMs = options.minRequestIntervalMs ?? DEFAULT_MIN_REQUEST_INTERVAL_MS;
  const pacer = createRequestPacer(minIntervalMs);

  return {
    name: 'gemini',

    async complete(params: LlmCompletionParams): Promise<LlmCompletionResult> {
      const model = params.model ?? defaultModel;
      const { systemInstruction, contents } = mapMessagesToGeminiContents(params.messages);

      const response = await withRetry(
        async () => {
          await pacer.waitTurn();
          return ai.models.generateContent({
            model,
            contents,
            config: {
              // Disable Gemini 2.5's built-in thinking mode. Thinking tokens
              // count against maxOutputTokens and starve the actual response,
              // producing 2-5-token truncations that look like model errors.
              thinkingConfig: { thinkingBudget: 0 },
              ...(systemInstruction !== null && { systemInstruction }),
              ...(params.maxTokens !== undefined && { maxOutputTokens: params.maxTokens }),
              ...(params.temperature !== undefined && { temperature: params.temperature }),
            },
          });
        },
        { maxRetries, retryBaseDelayMs },
      );

      const text = response.text ?? '';
      const usage = response.usageMetadata;
      const finishReason = response.candidates?.[0]?.finishReason;

      return {
        text,
        usage: {
          promptTokens: usage?.promptTokenCount ?? 0,
          completionTokens: usage?.candidatesTokenCount ?? 0,
        },
        model: response.modelVersion ?? model,
        finishReason: mapFinishReason(finishReason),
      };
    },

    async embed(params: LlmEmbedParams): Promise<LlmEmbedResult> {
      const model = params.model ?? defaultEmbeddingModel;
      const inputs = Array.isArray(params.input) ? params.input : [params.input];

      const response = await withRetry(
        async () => {
          await pacer.waitTurn();
          return ai.models.embedContent({
            model,
            contents: inputs,
          });
        },
        { maxRetries, retryBaseDelayMs },
      );

      const embeddings: number[][] = (response.embeddings ?? []).map((e) => e.values ?? []);
      const firstDim = embeddings[0]?.length ?? 0;
      const usage = response.metadata;

      return {
        embeddings,
        usage: { promptTokens: usage?.billableCharacterCount ?? 0 },
        dimensions: firstDim,
        model,
      };
    },
  };
}

interface MappedContents {
  readonly systemInstruction: string | null;
  readonly contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
}

/**
 * Translate our role-tagged messages into Gemini's expected format.
 * - System messages collapse into a single `systemInstruction`.
 * - User / assistant messages map to user / model contents.
 * - Consecutive same-role messages are merged (Gemini disallows two
 *   consecutive turns from the same role).
 */
export function mapMessagesToGeminiContents(messages: readonly LlmMessage[]): MappedContents {
  const systemParts: string[] = [];
  const turns: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content);
      continue;
    }
    const role = m.role === 'assistant' ? 'model' : 'user';
    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      last.parts.push({ text: m.content });
    } else {
      turns.push({ role, parts: [{ text: m.content }] });
    }
  }

  return {
    systemInstruction: systemParts.length > 0 ? systemParts.join('\n\n') : null,
    contents: turns,
  };
}

function mapFinishReason(reason: string | undefined): LlmCompletionResult['finishReason'] {
  if (reason === 'STOP') return 'stop';
  if (reason === 'MAX_TOKENS') return 'length';
  return 'error';
}

interface RetryOptions {
  readonly maxRetries: number;
  readonly retryBaseDelayMs: number;
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetriableError(err) || attempt === options.maxRetries) throw err;
      const delayMs = options.retryBaseDelayMs * 2 ** attempt;
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

interface RequestPacer {
  waitTurn(): Promise<void>;
}

/**
 * Serialises requests so consecutive calls are spaced at least minIntervalMs
 * apart. Keeps us under provider RPM limits without per-call sleeps from the
 * caller. minIntervalMs=0 disables pacing entirely.
 */
export function createRequestPacer(minIntervalMs: number): RequestPacer {
  let nextSlotAt = 0;
  return {
    async waitTurn(): Promise<void> {
      if (minIntervalMs <= 0) return;
      const now = Date.now();
      const waitMs = Math.max(0, nextSlotAt - now);
      nextSlotAt = Math.max(now, nextSlotAt) + minIntervalMs;
      if (waitMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      }
    },
  };
}

export function isRetriableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('rate-limit') ||
    msg.includes('quota') ||
    msg.includes('resource_exhausted') ||
    msg.includes('unavailable') ||
    msg.includes('503')
  );
}
