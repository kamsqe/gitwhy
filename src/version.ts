import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The package's `version` field, read once at startup from package.json.
 * Centralizes version reporting so the CLI's --version, the MCP server's
 * advertised version, /api/health, and the `ping` tool all agree.
 *
 * Why runtime read rather than bake-in: avoids the trap where one hardcoded
 * string gets bumped during release while four others are forgotten.
 * Layout note: after build, this module sits at `dist/version.js`, so
 * `../package.json` resolves to the package root in both the source tree
 * and node_modules installs.
 */
const moduleDir = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(moduleDir, '..', 'package.json');

interface PackageJson {
  readonly version: string;
  readonly name: string;
}

const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as PackageJson;

export const VERSION = pkg.version;
export const PACKAGE_NAME = pkg.name;
