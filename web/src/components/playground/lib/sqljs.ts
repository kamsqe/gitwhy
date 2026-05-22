import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

/**
 * Singleton sql.js initialization. The WASM file is served from
 * /playground/sql-wasm.wasm (copied into web/public/ at build time).
 * Loading is async + heavy (~700kB WASM), so we cache the resolved
 * SqlJs instance and reuse it across DB switches.
 */
let SQL: SqlJsStatic | null = null;
let initPromise: Promise<SqlJsStatic> | null = null;

export async function getSqlJs(): Promise<SqlJsStatic> {
  if (SQL) return SQL;
  if (initPromise) return initPromise;
  initPromise = initSqlJs({
    // Static WASM file shipped alongside the Astro build output.
    locateFile: (file) => `/playground/${file}`,
  }).then((sql) => {
    SQL = sql;
    return sql;
  });
  return initPromise;
}

/**
 * Fetch a SQLite DB file as bytes and open it with sql.js. The DB files
 * (e.g. express.db) are pre-indexed gitwhy databases, shipped as static
 * assets alongside the playground page. Once loaded the entire DB lives
 * in memory — fine for our showcase repos which are ~5-80MB after the
 * embeddings table is stripped for size.
 *
 * Throws if the DB file is missing or malformed.
 */
export async function openRemoteDatabase(url: string): Promise<Database> {
  const [sql, response] = await Promise.all([getSqlJs(), fetch(url)]);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  return new sql.Database(new Uint8Array(buffer));
}

/**
 * Helper: run a parameterized SQL query and return rows as objects. sql.js
 * returns `Statement` objects with a stepping API; this wrapper hides that
 * and matches the shape of better-sqlite3's `all()` so the query code can
 * stay close to what runs on the server.
 */
export function queryAll<T = Record<string, unknown>>(
  db: Database,
  sql: string,
  params: unknown[] | Record<string, unknown> = [],
): T[] {
  const stmt = db.prepare(sql);
  try {
    if (Array.isArray(params)) {
      stmt.bind(params as initSqlJs.BindParams);
    } else {
      stmt.bind(params as initSqlJs.BindParams);
    }
    const rows: T[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }
    return rows;
  } finally {
    stmt.free();
  }
}

export function queryOne<T = Record<string, unknown>>(
  db: Database,
  sql: string,
  params: unknown[] | Record<string, unknown> = [],
): T | null {
  const rows = queryAll<T>(db, sql, params);
  return rows[0] ?? null;
}
