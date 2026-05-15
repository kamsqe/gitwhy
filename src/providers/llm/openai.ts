import OpenAI from 'openai';
import type {
  LlmCompletionParams,
  LlmCompletionResult,
  LlmEmbedParams,
  LlmEmbedResult,
  LlmProvider,
} from './types.js';

export interface OpenAiProviderOptions {
  readonly apiKey: string;
  readonly baseURL?: string;
  readonly organization?: string;
  readonly defaultModel?: string;
  readonly defaultEmbeddingModel?: string;
  readonly maxRetries?: number;
  /**
   * Custom fetch function. The OpenAI SDK accepts this for proxying or
   * testing. Tests inject a stub that returns canned responses.
   */
  readonly fetch?: typeof fetch;
}

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

export function createOpenAiProvider(options: OpenAiProviderOptions): LlmProvider {
  const client = new OpenAI({
    apiKey: options.apiKey,
    ...(options.baseURL !== undefined && { baseURL: options.baseURL }),
    ...(options.organization !== undefined && { organization: options.organization }),
    ...(options.maxRetries !== undefined && { maxRetries: options.maxRetries }),
    ...(options.fetch !== undefined && { fetch: options.fetch }),
  });
  const defaultModel = options.defaultModel ?? DEFAULT_MODEL;
  const defaultEmbeddingModel = options.defaultEmbeddingModel ?? DEFAULT_EMBEDDING_MODEL;

  return {
    name: 'openai',

    async complete(params: LlmCompletionParams): Promise<LlmCompletionResult> {
      const model = params.model ?? defaultModel;
      const response = await client.chat.completions.create({
        model,
        messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
        ...(params.maxTokens !== undefined && { max_tokens: params.maxTokens }),
        ...(params.temperature !== undefined && { temperature: params.temperature }),
      });

      const choice = response.choices[0];
      const text = choice?.message?.content ?? '';
      const usage = response.usage;

      return {
        text,
        usage: {
          promptTokens: usage?.prompt_tokens ?? 0,
          completionTokens: usage?.completion_tokens ?? 0,
        },
        model: response.model,
        finishReason: mapFinishReason(choice?.finish_reason),
      };
    },

    async embed(params: LlmEmbedParams): Promise<LlmEmbedResult> {
      const model = params.model ?? defaultEmbeddingModel;
      const response = await client.embeddings.create({
        model,
        input: params.input,
        encoding_format: 'float',
      });

      const embeddings = response.data.map((d) => d.embedding);
      const firstDim = embeddings[0]?.length ?? 0;

      return {
        embeddings,
        usage: { promptTokens: response.usage?.prompt_tokens ?? 0 },
        dimensions: firstDim,
        model: response.model,
      };
    },
  };
}

function mapFinishReason(reason: string | null | undefined): LlmCompletionResult['finishReason'] {
  if (reason === 'length') return 'length';
  if (reason === 'stop') return 'stop';
  return 'error';
}
