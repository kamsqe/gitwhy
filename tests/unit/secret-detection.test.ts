import { describe, expect, it } from 'vitest';
import { scanForSecrets } from '../../src/indexer/secret-detection.js';

describe('secret detection', () => {
  it('returns hasSecrets=false for clean input', () => {
    const result = scanForSecrets('const x = 1;\nconsole.log(x);');
    expect(result.hasSecrets).toBe(false);
    expect(result.matches).toHaveLength(0);
    expect(result.redacted).toBe('const x = 1;\nconsole.log(x);');
  });

  it('detects AWS access key IDs', () => {
    const result = scanForSecrets('AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE');
    expect(result.hasSecrets).toBe(true);
    expect(result.matches.some((m) => m.type === 'aws-access-key-id')).toBe(true);
    expect(result.redacted).toContain('[REDACTED:');
    expect(result.redacted).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('detects GitHub personal access tokens', () => {
    const input = 'token: ghp_abcdefghijklmnopqrstuvwxyz0123456789ABC';
    const result = scanForSecrets(input);
    expect(result.hasSecrets).toBe(true);
    expect(result.matches.some((m) => m.type === 'github-token')).toBe(true);
    expect(result.redacted).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789ABC');
  });

  it('detects OpenAI API keys (both legacy and project format)', () => {
    const r1 = scanForSecrets('OPENAI_API_KEY=sk-abcdef0123456789ABCDEF0123456789');
    const r2 = scanForSecrets('apiKey: "sk-proj-abcXYZ_-1234567890abcdefghijk"');
    expect(r1.hasSecrets).toBe(true);
    expect(r2.hasSecrets).toBe(true);
  });

  it('detects Anthropic keys', () => {
    const result = scanForSecrets('ANTHROPIC_API_KEY=sk-ant-abcdef01234567890ABCDEFG');
    expect(result.hasSecrets).toBe(true);
    expect(result.matches.some((m) => m.type === 'anthropic-key')).toBe(true);
  });

  it('detects PEM private key blocks', () => {
    const pem = `-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEAxxx==\n-----END RSA PRIVATE KEY-----`;
    const result = scanForSecrets(`config:\n${pem}`);
    expect(result.hasSecrets).toBe(true);
    expect(result.matches.some((m) => m.type === 'private-key-block')).toBe(true);
    expect(result.redacted).not.toContain('MIIEpAIBAAKCAQ');
  });

  it('detects JWT tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const result = scanForSecrets(`Authorization: ${jwt}`);
    expect(result.hasSecrets).toBe(true);
    expect(result.matches.some((m) => m.type === 'jwt')).toBe(true);
  });

  it('detects generic key=value assignments with long values', () => {
    const result = scanForSecrets('password = "verylongsecretvaluehere12345"');
    expect(result.hasSecrets).toBe(true);
  });

  it('handles multiple secrets in the same input', () => {
    const input = `AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nGH_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789ABC`;
    const result = scanForSecrets(input);
    expect(result.hasSecrets).toBe(true);
    expect(result.matches.length).toBeGreaterThanOrEqual(2);
    expect(result.redacted).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result.redacted).not.toContain('ghp_abc');
  });

  it('returns an empty result for empty input', () => {
    const result = scanForSecrets('');
    expect(result.hasSecrets).toBe(false);
    expect(result.matches).toHaveLength(0);
    expect(result.redacted).toBe('');
  });

  it('preserves surrounding text when redacting', () => {
    const result = scanForSecrets('before AKIAIOSFODNN7EXAMPLE after');
    expect(result.redacted).toMatch(/^before \[REDACTED:.+\] after$/);
  });
});
