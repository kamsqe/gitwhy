interface ConfidenceBadgeProps {
  confidence: number; // 0..1
  idk?: boolean;
}

export function ConfidenceBadge({ confidence, idk }: ConfidenceBadgeProps) {
  const pct = Math.round(confidence * 100);
  const tier = idk ? 'idk' : confidence >= 0.7 ? 'high' : confidence >= 0.4 ? 'mid' : 'low';

  const styles = {
    high: 'bg-emerald-900/30 text-emerald-300 border-emerald-800',
    mid: 'bg-amber-900/30 text-amber-300 border-amber-800',
    low: 'bg-red-900/30 text-red-300 border-red-800',
    idk: 'bg-gw-surface-2 text-gw-text-dim border-gw-border',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[tier]}`}
    >
      <span className="gw-mono">{pct}%</span>
      <span className="text-[10px] uppercase tracking-wider">
        {idk ? "i don't know" : 'confidence'}
      </span>
    </span>
  );
}
