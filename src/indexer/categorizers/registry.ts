import type { Categorizer, CategoryResult, CommitInfo } from '../types.js';

const categorizers: Categorizer[] = [];

export function registerCategorizer(categorizer: Categorizer): void {
  if (categorizers.some((c) => c.name === categorizer.name)) {
    throw new Error(`Categorizer '${categorizer.name}' is already registered`);
  }
  categorizers.push(categorizer);
  categorizers.sort((a, b) => b.priority - a.priority);
}

export function listCategorizers(): readonly Categorizer[] {
  return categorizers;
}

export function clearCategorizers(): void {
  categorizers.length = 0;
}

export function categorize(commit: CommitInfo): CategoryResult {
  for (const c of categorizers) {
    const result = c.categorize(commit);
    if (result) return result;
  }
  return { category: 'normal', confidence: 0.5, reason: 'default fallback' };
}
