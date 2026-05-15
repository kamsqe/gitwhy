import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Load environment variables from a `.env` file using Node 20.12+'s native
 * `process.loadEnvFile`. Silent no-op on older Node or if the file is
 * missing — keeping zero-dep and zero-overhead in production.
 */
export function loadDotEnv(cwd: string = process.cwd()): void {
  const candidates = [resolve(cwd, '.env'), resolve(cwd, '.gitwhy/.env')];

  const loader = (process as { loadEnvFile?: (path: string) => void }).loadEnvFile;
  if (typeof loader !== 'function') return;

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      loader(path);
    } catch {
      // Malformed .env — silently skip; CLI will surface a clearer error
      // when no API keys are found.
    }
  }
}
