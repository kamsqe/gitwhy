/**
 * Conservative secret detection. Scans text for patterns that look like
 * credentials and produces a redacted copy plus a list of match positions.
 *
 * Used to scrub diffs before sending them to a cloud LLM. False positives
 * are acceptable; false negatives are not.
 *
 * When two patterns match overlapping ranges, the higher-priority (more
 * specific) pattern wins. Pattern order in PATTERNS defines priority.
 */

export interface SecretMatch {
  readonly type: string;
  readonly start: number;
  readonly end: number;
}

export interface SecretScanResult {
  readonly hasSecrets: boolean;
  readonly matches: readonly SecretMatch[];
  /** Input with every match replaced by `[REDACTED:type]`. */
  readonly redacted: string;
}

interface Pattern {
  readonly type: string;
  readonly regex: RegExp;
}

const PATTERNS: readonly Pattern[] = [
  { type: 'private-key-block', regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/g },
  { type: 'aws-access-key-id', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: 'github-token', regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { type: 'anthropic-key', regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { type: 'openai-key', regex: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { type: 'slack-token', regex: /\bxox[bpoars]-[A-Za-z0-9-]{10,}\b/g },
  { type: 'google-api-key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { type: 'stripe-key', regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/g },
  { type: 'jwt', regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },
  { type: 'bearer-token', regex: /\bBearer\s+[A-Za-z0-9_\-.=]{20,}\b/g },
  { type: 'aws-secret-access-key', regex: /\b[A-Za-z0-9/+]{40}\b(?=\s*['"]?\s*$)/gm },
  { type: 'generic-secret-assignment', regex: /(?:api[_-]?key|secret|password|passwd|pwd|token|auth)\s*[:=]\s*['"]?[A-Za-z0-9+/=_-]{20,}['"]?/gi },
];

export function scanForSecrets(input: string): SecretScanResult {
  if (input.length === 0) {
    return { hasSecrets: false, matches: [], redacted: '' };
  }

  const matches: SecretMatch[] = [];

  for (const { type, regex } of PATTERNS) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(input)) !== null) {
      const candidate: SecretMatch = {
        type,
        start: match.index,
        end: match.index + match[0].length,
      };
      if (!overlapsAny(candidate, matches)) {
        matches.push(candidate);
      }
      if (match[0].length === 0) regex.lastIndex++;
    }
  }

  if (matches.length === 0) {
    return { hasSecrets: false, matches: [], redacted: input };
  }

  matches.sort((a, b) => a.start - b.start);
  return {
    hasSecrets: true,
    matches,
    redacted: applyRedaction(input, matches),
  };
}

function overlapsAny(candidate: SecretMatch, existing: readonly SecretMatch[]): boolean {
  for (const m of existing) {
    if (candidate.start < m.end && candidate.end > m.start) return true;
  }
  return false;
}

function applyRedaction(input: string, matches: readonly SecretMatch[]): string {
  let out = '';
  let cursor = 0;
  for (const m of matches) {
    out += input.slice(cursor, m.start);
    out += `[REDACTED:${m.type}]`;
    cursor = m.end;
  }
  out += input.slice(cursor);
  return out;
}
