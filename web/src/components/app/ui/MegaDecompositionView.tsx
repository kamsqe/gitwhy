interface MegaDecompositionViewProps {
  enrichedSummary: string;
  /** Optional: when known, lets the component decide whether to render in compact mode. */
  category?: string | null;
}

interface DecomposedGroup {
  module: string;
  summary: string;
}

/**
 * Renders a commit's enriched_summary as either a normal paragraph or, for
 * mega-commits, a structured per-module breakdown.
 *
 * Why mega-commits need this: the indexer's mega-decomposer splits a giant
 * diff into per-module groups, enriches each separately, then concatenates
 * the result as `**module**: summary\n**other_module**: summary`. Rendered
 * as a flat paragraph, that's a wall of bolded prefixes that's hard to
 * scan. As a list of module cards, you can quickly see "ok this 800-line
 * mega touched .github/workflows, tests/, and src/middleware" without
 * reading every word.
 *
 * Parsing is tolerant: if the summary doesn't match the expected `**X**:`
 * pattern at all, we fall back to displaying as plain prose. So normal
 * commits and any future format changes degrade gracefully.
 */
export function MegaDecompositionView({
  enrichedSummary,
  category,
}: MegaDecompositionViewProps) {
  // Only attempt structured render for mega-commits. Non-mega summaries
  // are single coherent prose — splitting them by `**` would mangle them.
  const isMega = category === 'mega';
  const groups = isMega ? parseDecomposition(enrichedSummary) : null;

  if (groups === null || groups.length === 0) {
    // Fallback: plain prose. Markdown bold is preserved as the surrounding
    // `**X**` text — if you want richer rendering swap to a markdown lib.
    return (
      <p className="mt-2 text-sm leading-relaxed text-gw-text">{enrichedSummary}</p>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-[10px] uppercase tracking-wider text-amber-300">
        Decomposed into {groups.length} module{groups.length === 1 ? '' : 's'}
      </p>
      <ul className="space-y-1.5">
        {groups.map((g) => (
          <li
            key={g.module}
            className="rounded-md border border-gw-border bg-gw-surface-2 px-3 py-2"
          >
            <div className="flex items-baseline gap-2">
              <code className="text-xs text-gw-accent">{g.module}</code>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-gw-text">{g.summary}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Parse `**module1**: summary one\n**module2**: summary two` into structured
 * objects. Returns null when the input doesn't look decomposed at all so
 * the caller can fall back to plain prose.
 *
 * The format is produced by indexer.ts's enrichMegaCommit() function:
 *   groupSummaries.push(`**${group.groupKey}**: ${analysis.enrichedSummary}`);
 *   ...
 *   summary: groupSummaries.join('\n')
 *
 * Module keys can contain slashes and dots (e.g. `.github/workflows`) so the
 * regex allows any non-`**` characters inside the bold markers.
 */
function parseDecomposition(text: string): DecomposedGroup[] | null {
  // A decomposition has at least one `**X**: Y` block. Single-block summaries
  // are rare for mega commits — typically they have 2-8 modules — but we
  // accept them.
  const headerRe = /^\*\*([^*]+?)\*\*:\s*/;
  const lines = text.split('\n');
  const groups: DecomposedGroup[] = [];
  let current: DecomposedGroup | null = null;

  for (const line of lines) {
    const m = headerRe.exec(line);
    if (m) {
      if (current !== null) groups.push(current);
      const module = m[1]!.trim();
      const rest = line.slice(m[0].length).trim();
      current = { module, summary: rest };
    } else if (current !== null && line.trim() !== '') {
      // Continuation line for the current module's summary.
      current.summary = `${current.summary} ${line.trim()}`.trim();
    }
  }
  if (current !== null) groups.push(current);

  // Need at least one parsed group AND the parse must have consumed most of
  // the text — if all we got was one match with a tiny summary in a large
  // text, the input probably wasn't a decomposition at all.
  if (groups.length === 0) return null;
  const consumed = groups.reduce((s, g) => s + g.module.length + g.summary.length, 0);
  if (consumed < text.length * 0.4) return null;
  return groups;
}
