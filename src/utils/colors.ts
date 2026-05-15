import kleur from 'kleur';

/**
 * Centralized color palette for CLI output. `kleur` automatically respects
 * `NO_COLOR` and disables colors in non-TTY contexts (CI logs, pipes).
 */
export const c = {
  ok: (s: string) => kleur.green(s),
  warn: (s: string) => kleur.yellow(s),
  fail: (s: string) => kleur.red(s),
  dim: (s: string) => kleur.gray(s),
  bold: (s: string) => kleur.bold(s),
  cyan: (s: string) => kleur.cyan(s),
  magenta: (s: string) => kleur.magenta(s),

  riskLevel(level: 'low' | 'medium' | 'high'): string {
    if (level === 'high') return kleur.bold().red(level.toUpperCase());
    if (level === 'medium') return kleur.bold().yellow(level.toUpperCase());
    return kleur.bold().green(level.toUpperCase());
  },

  checkIcon(level: 'ok' | 'warn' | 'fail'): string {
    if (level === 'ok') return kleur.green('✓');
    if (level === 'warn') return kleur.yellow('⚠');
    return kleur.red('✗');
  },
};
