import { useEffect, useMemo, useState } from 'react';
import { api, type GraphEdge, type GraphNode, type GraphResponse } from '../lib/api';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Spinner } from '../ui/Spinner';
import { ErrorCard } from './RiskTab';

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const VIEW_WIDTH = 760;
const VIEW_HEIGHT = 540;
// Force simulation parameters — tuned by trial: anything more aggressive
// pushes nodes off-screen quickly; anything less and the graph never settles.
const REPULSION = 4000;
const SPRING_REST_LENGTH = 80;
const SPRING_K = 0.02;
const CENTERING = 0.02;
const DAMPING = 0.78;
const SIM_TICKS = 240; // upfront iterations before first paint — gets to a stable-ish layout fast

/**
 * Force-directed file co-change graph. Custom mini-simulator (no extra deps)
 * with the usual three forces: repulsion between all nodes, spring along
 * each edge, gentle centering pull.
 *
 * Visual encoding:
 *   - Node size  = sqrt(commits) — total activity
 *   - Node color = bus factor tier (red=1, amber=2, yellow=3, green=4+)
 *   - Edge width = sqrt(weight) — co-change strength
 *   - Edge alpha = weight relative to max — strong ties stand out
 *
 * Why "wow without halluc": this is pure data viz over numbers that the
 * SQL backend produced. No LLM in the loop. The risks are visual (graph
 * doesn't lay out well above ~60 nodes) not epistemic. We cap aggressively
 * (default 50 nodes) and surface the truncation in the UI so users know
 * they're seeing a slice, not the whole repo.
 */
export function GraphTab() {
  const [maxNodes, setMaxNodes] = useState(40);
  const [minCo, setMinCo] = useState(2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<GraphResponse | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const load = async (mn: number, mc: number): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.graph({ maxNodes: mn, minCoCommits: mc }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(maxNodes, minCo);
    // Only auto-load on mount; sliders apply via Refresh button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Co-change graph</h1>
        <p className="mt-1 text-sm text-gw-text-dim">
          Files that change together cluster together. Node size = total
          activity, node color = bus factor (red = single-point-of-failure).
          Edge thickness = how often a pair co-changes.
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs uppercase tracking-wider text-gw-text-faint">
              Max nodes
            </label>
            <input
              type="number"
              min="5"
              max="200"
              value={maxNodes}
              onChange={(e) => setMaxNodes(Math.max(5, Math.min(200, Number.parseInt(e.target.value, 10) || 40)))}
              className="mt-1 w-24 rounded-md border border-gw-border bg-gw-surface px-3 py-2 text-sm gw-mono focus:border-gw-accent"
              disabled={loading}
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-gw-text-faint">
              Min co-commits per edge
            </label>
            <input
              type="number"
              min="1"
              max="100"
              value={minCo}
              onChange={(e) => setMinCo(Math.max(1, Math.min(100, Number.parseInt(e.target.value, 10) || 2)))}
              className="mt-1 w-24 rounded-md border border-gw-border bg-gw-surface px-3 py-2 text-sm gw-mono focus:border-gw-accent"
              disabled={loading}
            />
          </div>
          <Button onClick={() => void load(maxNodes, minCo)} disabled={loading}>
            {loading ? (
              <>
                <Spinner size={14} /> Loading…
              </>
            ) : (
              'Refresh'
            )}
          </Button>
        </div>
        {data && (
          <p className="mt-3 text-xs text-gw-text-faint">
            Showing {data.nodes.length} of {data.totalCandidates.toLocaleString()} files
            ·{' '}
            {data.edges.length} edge{data.edges.length === 1 ? '' : 's'} above
            threshold
            {data.truncated && <span className="text-amber-300"> · capped — raise max nodes to see more</span>}
          </p>
        )}
      </Card>

      {error && <ErrorCard message={error} />}

      {data && data.nodes.length === 0 && !loading && (
        <Card>
          <p className="text-sm text-gw-text-dim">
            No co-change data yet. Either the index is empty or you set the
            min-co-commits threshold higher than any pair achieves. Try
            lowering the threshold or re-indexing.
          </p>
        </Card>
      )}

      {data && data.nodes.length > 0 && (
        <Card className="!p-2">
          <GraphCanvas
            nodes={data.nodes}
            edges={data.edges}
            hovered={hovered}
            onHover={setHovered}
          />
          <Legend />
        </Card>
      )}
    </div>
  );
}

function GraphCanvas({
  nodes,
  edges,
  hovered,
  onHover,
}: {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  hovered: string | null;
  onHover: (path: string | null) => void;
}) {
  // Snapshot the simulated state once per (nodes, edges) tuple. Keeping the
  // sim deterministic avoids the graph "dancing" when the user hovers.
  const sim = useMemo(() => runSimulation(nodes, edges), [nodes, edges]);

  const maxWeight = edges.reduce((m, e) => Math.max(m, e.weight), 1);
  const maxCommits = nodes.reduce((m, n) => Math.max(m, n.commits), 1);

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      className="w-full"
      style={{ minHeight: '420px' }}
      role="img"
      aria-label="File co-change graph"
    >
      {/* Edges — drawn first so nodes sit on top. */}
      {edges.map((e, i) => {
        const a = sim.byPath.get(e.source);
        const b = sim.byPath.get(e.target);
        if (!a || !b) return null;
        const opacity = 0.15 + 0.55 * (e.weight / maxWeight);
        const stroke = Math.max(0.5, 1.5 * Math.sqrt(e.weight / maxWeight) + 0.5);
        const highlighted =
          hovered === null || hovered === e.source || hovered === e.target;
        return (
          <line
            key={`${e.source}|${e.target}|${i}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="#7daee5"
            strokeWidth={stroke}
            opacity={highlighted ? opacity : 0.05}
          />
        );
      })}

      {/* Nodes. */}
      {sim.nodes.map((n) => {
        const r = 4 + 10 * Math.sqrt(n.commits / maxCommits);
        const fill = colorForBusFactor(n.busFactor);
        const highlighted = hovered === null || hovered === n.path;
        return (
          <g
            key={n.path}
            onMouseEnter={() => onHover(n.path)}
            onMouseLeave={() => onHover(null)}
            style={{ cursor: 'pointer' }}
            opacity={highlighted ? 1 : 0.25}
          >
            <circle cx={n.x} cy={n.y} r={r} fill={fill} stroke="#0f172a" strokeWidth={1.2} />
            {(hovered === n.path || r > 12) && (
              <text
                x={n.x}
                y={n.y - r - 4}
                textAnchor="middle"
                className="text-[10px]"
                fill="#e5e7eb"
              >
                {basename(n.path)}
              </text>
            )}
          </g>
        );
      })}

      {/* Hover detail bottom-left. */}
      {hovered !== null && (
        <HoverDetail path={hovered} nodes={nodes} />
      )}
    </svg>
  );
}

function HoverDetail({
  path,
  nodes,
}: {
  path: string;
  nodes: readonly GraphNode[];
}) {
  const n = nodes.find((x) => x.path === path);
  if (!n) return null;
  return (
    <g>
      <rect
        x={10}
        y={VIEW_HEIGHT - 56}
        width={Math.min(VIEW_WIDTH - 20, 8 * path.length + 80)}
        height={46}
        rx={6}
        fill="#0f172a"
        stroke="#334155"
      />
      <text x={20} y={VIEW_HEIGHT - 36} fill="#e5e7eb" className="text-[12px]">
        {path}
      </text>
      <text
        x={20}
        y={VIEW_HEIGHT - 20}
        fill="#9ca3af"
        className="text-[11px] gw-mono"
      >
        {n.commits} commits · bus factor {n.busFactor ?? '—'}
      </text>
    </g>
  );
}

function Legend() {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pb-1 text-[11px] text-gw-text-faint">
      <span>Bus factor:</span>
      <LegendDot color="#dc2626" label="1 (single owner)" />
      <LegendDot color="#f59e0b" label="2" />
      <LegendDot color="#facc15" label="3" />
      <LegendDot color="#10b981" label="4+" />
      <LegendDot color="#6b7280" label="—" />
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden />
      <span>{label}</span>
    </span>
  );
}

function colorForBusFactor(bf: number | null): string {
  if (bf === null) return '#6b7280';
  if (bf === 1) return '#dc2626';
  if (bf === 2) return '#f59e0b';
  if (bf === 3) return '#facc15';
  return '#10b981';
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

/**
 * Run the force-directed simulation to a stable-ish layout. Synchronous so
 * the result is deterministic per (nodes, edges) tuple — re-renders don't
 * jiggle the graph.
 */
function runSimulation(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): { nodes: SimNode[]; byPath: Map<string, SimNode> } {
  // Initial layout: scatter nodes on a circle so they don't all collapse
  // through 0,0 on the first repulsion tick.
  const sim: SimNode[] = nodes.map((n, i) => {
    const angle = (i / nodes.length) * 2 * Math.PI;
    const radius = Math.min(VIEW_WIDTH, VIEW_HEIGHT) / 3;
    return {
      ...n,
      x: VIEW_WIDTH / 2 + Math.cos(angle) * radius,
      y: VIEW_HEIGHT / 2 + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    };
  });
  const byPath = new Map(sim.map((n) => [n.path, n]));

  for (let tick = 0; tick < SIM_TICKS; tick++) {
    // Repulsion (Coulomb-like) — N² but capped at ~50 nodes so this is fine.
    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        const a = sim[i]!;
        const b = sim[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy + 0.01;
        const force = REPULSION / distSq;
        const dist = Math.sqrt(distSq);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // Spring pull along edges. Strong ties (high weight) pull harder.
    const maxWeight = edges.reduce((m, e) => Math.max(m, e.weight), 1);
    for (const e of edges) {
      const a = byPath.get(e.source);
      const b = byPath.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const k = SPRING_K * (0.5 + e.weight / maxWeight);
      const f = k * (dist - SPRING_REST_LENGTH);
      const fx = (dx / dist) * f;
      const fy = (dy / dist) * f;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // Gentle pull to center so disconnected nodes don't drift off-screen.
    for (const n of sim) {
      n.vx += (VIEW_WIDTH / 2 - n.x) * CENTERING;
      n.vy += (VIEW_HEIGHT / 2 - n.y) * CENTERING;
    }

    // Integrate + dampen.
    for (const n of sim) {
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      n.x += n.vx;
      n.y += n.vy;
      // Soft bounds — let the view extend a bit but clamp at viewport edge
      // minus a margin so circles aren't half-cut.
      const margin = 24;
      n.x = Math.max(margin, Math.min(VIEW_WIDTH - margin, n.x));
      n.y = Math.max(margin, Math.min(VIEW_HEIGHT - margin, n.y));
    }
  }

  return { nodes: sim, byPath };
}
