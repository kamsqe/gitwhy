/**
 * Minimal stderr logger. CLI uses stderr so stdout stays clean for
 * structured output (JSON, streamed answers, etc.).
 *
 * The MCP server MUST NOT write anything to stdout — that channel is the
 * MCP wire protocol. All logging from MCP-side code must go through here.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function envLevel(): LogLevel {
  const raw = process.env['GITWHY_LOG']?.toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw;
  }
  return 'info';
}

function emit(level: LogLevel, message: string): void {
  if (levelOrder[level] < levelOrder[envLevel()]) return;
  process.stderr.write(`[gitwhy ${level}] ${message}\n`);
}

export const logger = {
  debug: (message: string): void => emit('debug', message),
  info: (message: string): void => emit('info', message),
  warn: (message: string): void => emit('warn', message),
  error: (message: string): void => emit('error', message),
};
