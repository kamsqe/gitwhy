import { catchupTool } from './catchup.js';
import { contextForPrTool } from './context-for-pr.js';
import { historyTool } from './history.js';
import { pingTool } from './ping.js';
import { registerTool, listTools } from './registry.js';
import { relatedTool } from './related.js';
import { riskTool } from './risk.js';
import { searchTool } from './search.js';
import { suggestCommitMessageTool } from './suggest-commit-message.js';
import { whyTool } from './why.js';

export function registerBuiltinTools(): void {
  if (listTools().length > 0) return;
  registerTool(pingTool);
  registerTool(whyTool);
  registerTool(historyTool);
  registerTool(searchTool);
  registerTool(catchupTool);
  registerTool(riskTool);
  registerTool(relatedTool);
  registerTool(contextForPrTool);
  registerTool(suggestCommitMessageTool);
}
