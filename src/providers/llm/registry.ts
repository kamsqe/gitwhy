import type { LlmProvider } from './types.js';

const providers = new Map<string, LlmProvider>();

export function registerLlmProvider(provider: LlmProvider): void {
  if (providers.has(provider.name)) {
    throw new Error(`LLM provider '${provider.name}' is already registered`);
  }
  providers.set(provider.name, provider);
}

export function getLlmProvider(name: string): LlmProvider {
  const provider = providers.get(name);
  if (!provider) {
    throw new Error(
      `Unknown LLM provider '${name}'. Registered: ${[...providers.keys()].join(', ') || '(none)'}`,
    );
  }
  return provider;
}

export function listLlmProviders(): string[] {
  return [...providers.keys()];
}

export function clearLlmProviders(): void {
  providers.clear();
}
