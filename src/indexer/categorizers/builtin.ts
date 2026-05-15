import type { Categorizer, CommitInfo } from '../types.js';
import { listCategorizers, registerCategorizer } from './registry.js';

/**
 * Built-in commit categorizers, ordered by priority. Higher priority
 * categorizers run first; the first non-null result wins.
 *
 * Priority bands (loose convention so plugins know where they fit):
 *   100+ : structural facts that bypass everything else (merges, initial commits)
 *    80+ : message-driven specializations (reverts, bots)
 *     1+ : size-based fallback
 */

export const mergeCategorizer: Categorizer = {
  name: 'merge',
  priority: 100,
  categorize(commit: CommitInfo) {
    if (commit.parentHashes.length >= 2) {
      return {
        category: 'merge',
        confidence: 1,
        reason: `commit has ${commit.parentHashes.length} parents`,
      };
    }
    return null;
  },
};

export const initialCategorizer: Categorizer = {
  name: 'initial',
  priority: 95,
  categorize(commit: CommitInfo) {
    if (commit.parentHashes.length === 0) {
      return {
        category: 'initial',
        confidence: 1,
        reason: 'commit has no parents',
      };
    }
    return null;
  },
};

const BOT_EMAIL_PATTERNS: readonly RegExp[] = [
  /@users\.noreply\.github\.com$/i,
  /^[^@]*\[bot\][^@]*@/i,
  /^dependabot/i,
  /^renovate/i,
  /^github-actions/i,
  /^copilot/i,
  /^release-please/i,
];

const BOT_NAME_PATTERNS: readonly RegExp[] = [
  /\[bot\]/i,
  /^dependabot$/i,
  /^renovate(?:-bot)?$/i,
  /^github-actions$/i,
  /^copilot$/i,
];

const BOT_MESSAGE_PATTERNS: readonly RegExp[] = [
  /^chore\(deps(?:-dev)?\):\s*bump\b/i,
  /^(?:bump|update)\s+\S+\s+from\s+\S+\s+to\s+\S+/i,
];

export const botCategorizer: Categorizer = {
  name: 'bot',
  priority: 90,
  categorize(commit: CommitInfo) {
    const emailMatch = BOT_EMAIL_PATTERNS.find((p) => p.test(commit.author.email));
    if (emailMatch && /bot/i.test(commit.author.email)) {
      return botResult('email', commit.author.email);
    }
    const nameMatch = BOT_NAME_PATTERNS.find((p) => p.test(commit.author.name));
    if (nameMatch) {
      return botResult('name', commit.author.name);
    }
    const firstLine = commit.message.split('\n', 1)[0] ?? '';
    const msgMatch = BOT_MESSAGE_PATTERNS.find((p) => p.test(firstLine));
    if (msgMatch && /noreply|bot/i.test(commit.author.email)) {
      return botResult('message+noreply', firstLine);
    }
    return null;
  },
};

function botResult(field: string, sample: string): ReturnType<Categorizer['categorize']> {
  return {
    category: 'bot',
    confidence: 0.95,
    reason: `bot pattern matched on ${field}: ${truncate(sample, 60)}`,
  };
}

export const revertCategorizer: Categorizer = {
  name: 'revert',
  priority: 85,
  categorize(commit: CommitInfo) {
    const firstLine = commit.message.split('\n', 1)[0]?.trim() ?? '';
    if (/^revert\b/i.test(firstLine) || /^revert\s+"/i.test(firstLine)) {
      return {
        category: 'revert',
        confidence: 0.9,
        reason: 'message starts with "Revert"',
      };
    }
    return null;
  },
};

const VAGUE_MESSAGE_PATTERNS: readonly RegExp[] = [
  /^(?:fix|fixes|fixed|fixing|fixup)\b\.?$/i,
  /^(?:wip|wip\d+|work in progress)\b\.?$/i,
  /^(?:update|updates|updated|updating)\b\.?$/i,
  /^(?:change|changes|changed|changing)\b\.?$/i,
  /^(?:test|tests|testing)\b\.?$/i,
  /^(?:stuff|misc|tmp|temp|temporary|cleanup|clean ?up)\b\.?$/i,
  /^(?:more|less)\b\.?$/i,
  /^\.+$/,
];

const MICRO_LINE_THRESHOLD = 20;
const MEGA_LINE_THRESHOLD = 500;

export const sizeCategorizer: Categorizer = {
  name: 'size',
  priority: 10,
  categorize(commit: CommitInfo) {
    const total = commit.insertions + commit.deletions;
    if (total >= MEGA_LINE_THRESHOLD) {
      return {
        category: 'mega',
        confidence: 0.9,
        reason: `${total} lines changed (>= ${MEGA_LINE_THRESHOLD})`,
      };
    }
    if (total < MICRO_LINE_THRESHOLD && isVagueMessage(commit.message)) {
      return {
        category: 'micro',
        confidence: 0.85,
        reason: `${total} lines changed and message is vague (${truncate(commit.message, 30)})`,
      };
    }
    return {
      category: 'normal',
      confidence: 0.7,
      reason: `${total} lines changed`,
    };
  },
};

export function isVagueMessage(message: string): boolean {
  const firstLine = message.split('\n', 1)[0]?.trim() ?? '';
  if (firstLine.length === 0) return true;
  if (firstLine.split(/\s+/).length <= 2 && firstLine.length <= 15) return true;
  return VAGUE_MESSAGE_PATTERNS.some((p) => p.test(firstLine));
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export const builtinCategorizers: readonly Categorizer[] = [
  mergeCategorizer,
  initialCategorizer,
  botCategorizer,
  revertCategorizer,
  sizeCategorizer,
];

export function registerBuiltinCategorizers(): void {
  if (listCategorizers().length > 0) return;
  for (const c of builtinCategorizers) registerCategorizer(c);
}
