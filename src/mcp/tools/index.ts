import { catchupTool } from './catchup.js';
import { historyTool } from './history.js';
import { pingTool } from './ping.js';
import { listTools, registerTool } from './registry.js';
import { searchTool } from './search.js';
import { whyTool } from './why.js';

export function registerBuiltinTools(): void {
  if (listTools().length > 0) return;
  registerTool(pingTool);
  registerTool(whyTool);
  registerTool(historyTool);
  registerTool(searchTool);
  registerTool(catchupTool);
  // Future Phase 4 tools: risk, related, context_for_pr, suggest_commit_message.
}
