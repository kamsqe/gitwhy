import { pingTool } from './ping.js';
import { listTools, registerTool } from './registry.js';

export function registerBuiltinTools(): void {
  if (listTools().length > 0) return;
  registerTool(pingTool);
  // Future Phase 2-4 tools: why, history, risk, related, context_for_pr,
  // catchup, suggest_commit_message, search.
}
