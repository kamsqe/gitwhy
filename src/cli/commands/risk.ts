import { createMcpRuntimeFactory } from '../../mcp/runtime.js';
import type { RiskScoreResult } from '../../agents/insight/risk-score.js';
import type { BusFactorResult } from '../../agents/insight/bus-factor.js';

export interface RiskCommandOptions {
  readonly cwd: string;
  readonly path: string;
}

export interface RiskCommandResult {
  readonly risk: RiskScoreResult;
  readonly busFactor: BusFactorResult;
}

export function runRiskCommand(options: RiskCommandOptions): RiskCommandResult {
  const factory = createMcpRuntimeFactory({ cwd: options.cwd });
  const runtime = factory.get();
  const risk = runtime.insight.riskScore(options.path);
  const busFactor = runtime.insight.busFactor(options.path);
  return { risk, busFactor };
}
