import { describe, expect, it } from 'vitest';
import { detectDefaultConfig } from '../../src/config/index.js';

describe('detectDefaultConfig', () => {
  it('returns openai-flavored defaults when OPENAI_API_KEY is set', () => {
    const config = detectDefaultConfig({ OPENAI_API_KEY: 'sk-...' });
    expect(config.provider.llm).toBe('openai');
    expect(config.provider.indexingModel).toMatch(/^gpt-/);
  });

  it('returns gemini-flavored defaults when only GEMINI_API_KEY is set', () => {
    const config = detectDefaultConfig({ GEMINI_API_KEY: 'AIza-test' });
    expect(config.provider.llm).toBe('gemini');
    expect(config.provider.indexingModel).toMatch(/^gemini-/);
    expect(config.provider.embeddingModel).toMatch(/^(?:gemini|text)-embedding-/);
  });

  it('accepts GOOGLE_API_KEY as an alias for GEMINI_API_KEY', () => {
    const config = detectDefaultConfig({ GOOGLE_API_KEY: 'AIza-test' });
    expect(config.provider.llm).toBe('gemini');
  });

  it('prefers openai when both keys are set', () => {
    const config = detectDefaultConfig({
      OPENAI_API_KEY: 'sk-...',
      GEMINI_API_KEY: 'AIza-...',
    });
    expect(config.provider.llm).toBe('openai');
  });

  it('falls back to openai defaults when no keys are set', () => {
    const config = detectDefaultConfig({});
    expect(config.provider.llm).toBe('openai');
  });
});
