import type { Database as DatabaseType } from 'better-sqlite3';
import type { AliasResolver } from '../../config/aliases.js';
import { calculateBusFactor } from './bus-factor.js';
import { detectGhostCode } from './ghost-code.js';
import { getHotspots } from './hotspots.js';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface RiskScoreInputs {
  readonly busFactor: number;
  readonly soleOwnerSharePercent: number;
  readonly ownerInactiveDays: number;
  readonly recentCommits90d: number;
  readonly totalCommits: number;
  readonly contributorCount: number;
  readonly isGhostCode: boolean;
}

export interface RiskScoreResult {
  readonly path: string;
  readonly level: RiskLevel;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly inputs: RiskScoreInputs;
}

/**
 * Composite risk score for a file. Combines bus-factor risk, ghost-code
 * status, and hotspot intensity into a single LOW/MEDIUM/HIGH bucket.
 *
 * Weights:
 *   - bus-factor risk: 0.40   (single point of failure is the worst case)
 *   - ghost code:      0.30   (no active maintainer)
 *   - hotspot heat:    0.30   (high recent churn correlates with bugs)
 */
export function calculateRiskScore(
  db: DatabaseType,
  path: string,
  aliases?: AliasResolver,
): RiskScoreResult {
  const normalized = path.replace(/\\/g, '/');
  const bus = calculateBusFactor(db, normalized, aliases);
  const hotspot = getHotspots(db, { pathPrefix: normalized, recentDays: 90, limit: 1 })[0];
  const ghosts = detectGhostCode(db, { pathPrefix: normalized, limit: 1 });
  const ghost = ghosts.find((g) => g.path === normalized);

  const top = bus.contributors[0];
  const soleOwnerShare = top?.sharePercent ?? 0;
  const ownerLastCommit = top?.lastCommit?.getTime() ?? Date.now();
  const ownerInactiveDays = Math.floor((Date.now() - ownerLastCommit) / (24 * 60 * 60 * 1000));

  const inputs: RiskScoreInputs = {
    busFactor: bus.busFactor,
    soleOwnerSharePercent: soleOwnerShare,
    ownerInactiveDays,
    recentCommits90d: hotspot?.recentCommits ?? 0,
    totalCommits: bus.totalCommits,
    contributorCount: bus.contributors.length,
    isGhostCode: ghost !== undefined,
  };

  const busRisk = scoreBusFactor(inputs.busFactor);
  const ghostRisk = inputs.isGhostCode ? 1.0 : ownerInactiveDays > 180 ? 0.5 : 0;
  const hotspotRisk = scoreHotspot(inputs.recentCommits90d, inputs.totalCommits);

  const score = 0.4 * busRisk + 0.3 * ghostRisk + 0.3 * hotspotRisk;
  const level: RiskLevel = score >= 0.6 ? 'high' : score >= 0.3 ? 'medium' : 'low';

  const reasons: string[] = [];
  if (inputs.busFactor === 1) {
    reasons.push(`bus factor = 1 (${top?.authorName ?? 'unknown'} owns ${soleOwnerShare.toFixed(0)}% of the file)`);
  } else if (inputs.busFactor === 2) {
    reasons.push('bus factor = 2 (two-person dependency)');
  }
  if (inputs.isGhostCode) {
    reasons.push(`sole owner inactive for ${ownerInactiveDays} days (ghost code)`);
  } else if (ownerInactiveDays > 180) {
    reasons.push(`top contributor last touched this ${ownerInactiveDays} days ago`);
  }
  if (inputs.recentCommits90d >= 10) {
    reasons.push(`hotspot: ${inputs.recentCommits90d} commits in the last 90 days`);
  } else if (inputs.recentCommits90d >= 5) {
    reasons.push(`moderately active: ${inputs.recentCommits90d} recent commits`);
  }
  if (inputs.contributorCount === 1) {
    reasons.push('only one contributor in indexed history');
  }
  if (reasons.length === 0) {
    reasons.push('no significant risk indicators');
  }

  return { path: normalized, level, score, reasons, inputs };
}

function scoreBusFactor(busFactor: number): number {
  if (busFactor <= 1) return 1.0;
  if (busFactor === 2) return 0.5;
  if (busFactor === 3) return 0.2;
  return 0.1;
}

function scoreHotspot(recentCommits: number, totalCommits: number): number {
  if (recentCommits === 0) return 0;
  const recencyComponent = Math.min(1, recentCommits / 20);
  const churnComponent = Math.min(1, totalCommits / 50);
  return 0.6 * recencyComponent + 0.4 * churnComponent;
}
