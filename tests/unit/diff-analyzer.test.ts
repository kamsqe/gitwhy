import { describe, expect, it } from 'vitest';
import { analyzeDiff, isFormattingOnlyDiff } from '../../src/indexer/diff-analyzer.js';
import { createMockLlmProvider } from '../../src/providers/llm/mock.js';
import type { CommitInfo } from '../../src/indexer/types.js';

function makeCommit(overrides: Partial<CommitInfo> = {}): CommitInfo {
  return {
    hash: 'abc123def',
    shortHash: 'abc123d',
    author: { name: 'Alice', email: 'alice@example.com' },
    date: new Date('2026-01-01T00:00:00Z'),
    message: 'fix',
    parentHashes: ['parent'],
    filesChanged: [
      { path: 'src/foo.ts', status: 'modified', insertions: 3, deletions: 1, isBinary: false },
    ],
    insertions: 3,
    deletions: 1,
    ...overrides,
  };
}

describe('analyzeDiff', () => {
  it('calls the LLM with system + user messages and returns the enriched summary', async () => {
    const llm = createMockLlmProvider({
      responder: () => 'Added null guard to prevent OAuth crash.',
    });
    const result = await analyzeDiff(
      { commit: makeCommit(), diff: '@@ -1,1 +1,2 @@\n+if (!user) return;' },
      { llm },
    );

    expect(result.enrichedSummary).toBe('Added null guard to prevent OAuth crash.');
    expect(llm.calls.complete).toHaveLength(1);
    expect(llm.calls.complete[0]?.messages[0]?.role).toBe('system');
    expect(llm.calls.complete[0]?.messages[1]?.role).toBe('user');
    expect(llm.calls.complete[0]?.messages[1]?.content).toContain('Commit: abc123d');
  });

  it('redacts secrets in the diff before sending to the LLM', async () => {
    const diff = '+ AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
    const llm = createMockLlmProvider();
    const result = await analyzeDiff({ commit: makeCommit(), diff }, { llm });

    expect(result.secretsRedacted).toBeGreaterThan(0);
    const userPrompt = llm.calls.complete[0]?.messages[1]?.content ?? '';
    expect(userPrompt).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(userPrompt).toContain('[REDACTED:');
  });

  it('does not redact when redactSecrets=false', async () => {
    const diff = '+ AKIAIOSFODNN7EXAMPLE';
    const llm = createMockLlmProvider();
    const result = await analyzeDiff(
      { commit: makeCommit(), diff },
      { llm, redactSecrets: false },
    );

    expect(result.secretsRedacted).toBe(0);
    const userPrompt = llm.calls.complete[0]?.messages[1]?.content ?? '';
    expect(userPrompt).toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('truncates oversized diffs and reports truncated=true', async () => {
    const huge = 'a'.repeat(50_000);
    const llm = createMockLlmProvider();
    const result = await analyzeDiff(
      { commit: makeCommit(), diff: huge },
      { llm, maxDiffChars: 1000 },
    );

    expect(result.truncated).toBe(true);
    const userPrompt = llm.calls.complete[0]?.messages[1]?.content ?? '';
    expect(userPrompt).toContain('[diff truncated');
    expect(userPrompt.length).toBeLessThan(huge.length);
  });

  it('flags inferredFromBadMessage when message is vague', async () => {
    const llm = createMockLlmProvider();
    const result = await analyzeDiff(
      { commit: makeCommit({ message: 'fix' }), diff: '+x' },
      { llm },
    );
    expect(result.inferredFromBadMessage).toBe(true);
  });

  it('does not flag inferredFromBadMessage for descriptive messages', async () => {
    const llm = createMockLlmProvider();
    const result = await analyzeDiff(
      {
        commit: makeCommit({ message: 'Add null guard before pricing lookup' }),
        diff: '+x',
      },
      { llm },
    );
    expect(result.inferredFromBadMessage).toBe(false);
  });

  it('records LLM usage data', async () => {
    const llm = createMockLlmProvider();
    const result = await analyzeDiff({ commit: makeCommit(), diff: '+x' }, { llm });
    expect(result.usage.promptTokens).toBeGreaterThan(0);
    expect(result.usage.completionTokens).toBeGreaterThan(0);
  });
});

describe('isFormattingOnlyDiff', () => {
  it('returns true for a pure whitespace reformatting diff', () => {
    const diff = `diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1,3 +1,3 @@
-const x={a:1,b:2}
+const x = { a: 1, b: 2 }
-function foo(){return 1}
+function foo() { return 1 }`;
    expect(isFormattingOnlyDiff(diff)).toBe(true);
  });

  it('returns false when content changes are present', () => {
    const diff = `diff --git a/x.ts b/x.ts
@@ -1,1 +1,1 @@
-const x = 1
+const x = 2`;
    expect(isFormattingOnlyDiff(diff)).toBe(false);
  });

  it('returns false for a pure addition (no formatting pairs)', () => {
    const diff = `diff --git a/x.ts b/x.ts
@@ -0,0 +1,1 @@
+const x = 1`;
    expect(isFormattingOnlyDiff(diff)).toBe(false);
  });

  it('returns false for mixed formatting + content changes', () => {
    const diff = `diff --git a/x.ts b/x.ts
@@ -1,3 +1,3 @@
-const x=1
+const x = 1
-const y = 2
+const y = 3`;
    expect(isFormattingOnlyDiff(diff)).toBe(false);
  });
});
