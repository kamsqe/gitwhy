import type { Database as DatabaseType } from 'better-sqlite3';
import { calculateBusFactor } from './bus-factor.js';
import type { BusFactorResult } from './bus-factor.js';
import { findRelatedFiles } from './co-change.js';
import type { CoChangeOptions, RelatedFile } from './co-change.js';
import { detectGhostCode } from './ghost-code.js';
import type { GhostCode, GhostCodeOptions } from './ghost-code.js';
import { getHotspots } from './hotspots.js';
import type { Hotspot, HotspotOptions } from './hotspots.js';
import { calculateRiskScore } from './risk-score.js';
import type { RiskScoreResult } from './risk-score.js';

export type {
  BusFactorResult,
  ContributorShare,
} from './bus-factor.js';
export type { Hotspot, HotspotOptions } from './hotspots.js';
export type { GhostCode, GhostCodeOptions } from './ghost-code.js';
export type { RelatedFile, CoChangeOptions } from './co-change.js';
export type { RiskLevel, RiskScoreInputs, RiskScoreResult } from './risk-score.js';

export {
  calculateBusFactor,
  getHotspots,
  detectGhostCode,
  findRelatedFiles,
  calculateRiskScore,
};

export interface InsightAgent {
  busFactor(path: string): BusFactorResult;
  hotspots(options?: HotspotOptions): Hotspot[];
  ghostCode(options?: GhostCodeOptions): GhostCode[];
  relatedFiles(path: string, options?: CoChangeOptions): RelatedFile[];
  riskScore(path: string): RiskScoreResult;
}

/**
 * Convenience facade bundling all Insight queries against a single DB
 * handle. Each method is a pure SQL query — no LLM involvement.
 */
export function createInsightAgent(db: DatabaseType): InsightAgent {
  return {
    busFactor: (path) => calculateBusFactor(db, path),
    hotspots: (options) => getHotspots(db, options),
    ghostCode: (options) => detectGhostCode(db, options),
    relatedFiles: (path, options) => findRelatedFiles(db, path, options),
    riskScore: (path) => calculateRiskScore(db, path),
  };
}
