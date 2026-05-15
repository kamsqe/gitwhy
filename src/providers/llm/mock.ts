import { createHash } from 'node:crypto';
import type {
  LlmCompletionParams,
  LlmCompletionResult,
  LlmEmbedParams,
  LlmEmbedResult,
  LlmProvider,
} from './types.js';

export interface MockLlmProviderOptions {
  /**
   * Custom responder for `complete()`. If omitted, returns a deterministic
   * stub built from a hash of the messages.
   */
  readonly responder?: (params: LlmCompletionParams) => string;
  /**
   * Custom embedder for `embed()`. If omitted, returns a deterministic
   * 8-dimensional vector seeded by the hash of the input.
   */
  readonly embedder?: (input: string) => number[];
  /** Approximate chars-per-token used to fake usage counts. Default 4. */
  readonly charsPerToken?: number;
  /** Model name to report. Default `mock`. */
  readonly model?: string;
}

export interface MockLlmProvider extends LlmProvider {
  readonly name: 'mock';
  readonly calls: {
    readonly complete: LlmCompletionParams[];
    readonly embed: LlmEmbedParams[];
  };
  reset(): void;
}

export function createMockLlmProvider(options: MockLlmProviderOptions = {}): MockLlmProvider {
  const charsPerToken = options.charsPerToken ?? 4;
  const modelName = options.model ?? 'mock';
  const completeCalls: LlmCompletionParams[] = [];
  const embedCalls: LlmEmbedParams[] = [];

  return {
    name: 'mock',
    get calls() {
      return { complete: completeCalls, embed: embedCalls };
    },
    reset() {
      completeCalls.length = 0;
      embedCalls.length = 0;
    },
    async complete(params: LlmCompletionParams): Promise<LlmCompletionResult> {
      completeCalls.push(params);
      const text = options.responder ? options.responder(params) : defaultResponse(params);
      const promptChars = params.messages.reduce((s, m) => s + m.content.length, 0);
      return {
        text,
        usage: {
          promptTokens: Math.ceil(promptChars / charsPerToken),
          completionTokens: Math.ceil(text.length / charsPerToken),
        },
        model: params.model ?? modelName,
        finishReason: 'stop',
      };
    },
    async embed(params: LlmEmbedParams): Promise<LlmEmbedResult> {
      embedCalls.push(params);
      const inputs = Array.isArray(params.input) ? params.input : [params.input];
      const embedder = options.embedder ?? defaultEmbedding;
      const embeddings = inputs.map(embedder);
      const totalChars = inputs.reduce((s, i) => s + i.length, 0);
      const dimensions = embeddings[0]?.length ?? 0;
      return {
        embeddings,
        usage: { promptTokens: Math.ceil(totalChars / charsPerToken) },
        dimensions,
        model: params.model ?? modelName,
      };
    },
  };
}

function defaultResponse(params: LlmCompletionParams): string {
  const hash = hashMessages(params.messages.map((m) => `${m.role}:${m.content}`).join('\n'));
  return `[mock response ${hash.slice(0, 8)}]`;
}

function defaultEmbedding(input: string): number[] {
  const hash = hashMessages(input);
  return Array.from({ length: 8 }, (_, i) => {
    const byte = hash.charCodeAt((i * 4) % hash.length);
    return (byte - 64) / 64;
  });
}

function hashMessages(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
