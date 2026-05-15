export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompletionParams {
  messages: LlmMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface LlmTokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface LlmCompletionResult {
  text: string;
  usage: LlmTokenUsage;
  model: string;
  finishReason: 'stop' | 'length' | 'error';
}

export interface LlmEmbedParams {
  input: string | string[];
  model?: string;
  signal?: AbortSignal;
}

export interface LlmEmbedResult {
  embeddings: number[][];
  usage: { promptTokens: number };
  dimensions: number;
  model: string;
}

export interface LlmProvider {
  readonly name: string;
  complete(params: LlmCompletionParams): Promise<LlmCompletionResult>;
  embed(params: LlmEmbedParams): Promise<LlmEmbedResult>;
}
