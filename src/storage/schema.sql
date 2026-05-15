-- GitWhy metadata schema. Loaded by `openDatabase` on first use.
-- Embeddings are stored inline as BLOB rows; vector search is done in JS.
-- This file is shipped in the npm package; edits here must be reflected
-- in a migration step that runs against existing user databases.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', '2');

-- One row per indexed commit.
CREATE TABLE IF NOT EXISTS commits (
    hash             TEXT PRIMARY KEY,
    short_hash       TEXT NOT NULL,
    author_name      TEXT NOT NULL,
    author_email     TEXT NOT NULL,
    committed_at     INTEGER NOT NULL,  -- unix ms
    message          TEXT NOT NULL,
    parent_hashes    TEXT NOT NULL,     -- JSON array of hashes
    insertions       INTEGER NOT NULL,
    deletions        INTEGER NOT NULL,
    category         TEXT NOT NULL,     -- micro|normal|mega|merge|bot|revert|formatting|initial
    category_reason  TEXT,
    enriched_summary TEXT,              -- AI-generated description
    enrichment_model TEXT,              -- model used to generate the summary
    indexed_at       INTEGER NOT NULL   -- unix ms
);

CREATE INDEX IF NOT EXISTS idx_commits_author_email ON commits(author_email);
CREATE INDEX IF NOT EXISTS idx_commits_committed_at ON commits(committed_at);
CREATE INDEX IF NOT EXISTS idx_commits_category ON commits(category);

-- One row per file change within a commit.
CREATE TABLE IF NOT EXISTS commit_files (
    commit_hash TEXT NOT NULL,
    path        TEXT NOT NULL,
    old_path    TEXT,
    status      TEXT NOT NULL,         -- added|modified|deleted|renamed|copied
    insertions  INTEGER NOT NULL,
    deletions   INTEGER NOT NULL,
    is_binary   INTEGER NOT NULL,      -- 0 or 1
    PRIMARY KEY (commit_hash, path),
    FOREIGN KEY (commit_hash) REFERENCES commits(hash) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_commit_files_path ON commit_files(path);

-- Clustering: groups of micro-commits analyzed together.
CREATE TABLE IF NOT EXISTS commit_clusters (
    cluster_id       TEXT PRIMARY KEY,
    author_email     TEXT NOT NULL,
    started_at       INTEGER NOT NULL,
    ended_at         INTEGER NOT NULL,
    commit_count     INTEGER NOT NULL,
    enriched_summary TEXT,
    indexed_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS commit_cluster_members (
    cluster_id  TEXT NOT NULL,
    commit_hash TEXT NOT NULL,
    PRIMARY KEY (cluster_id, commit_hash),
    FOREIGN KEY (cluster_id) REFERENCES commit_clusters(cluster_id) ON DELETE CASCADE,
    FOREIGN KEY (commit_hash) REFERENCES commits(hash) ON DELETE CASCADE
);

-- Token usage + cost accounting. Aggregated by `gitwhy estimate` and stats.
CREATE TABLE IF NOT EXISTS llm_calls (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at       INTEGER NOT NULL,  -- unix ms
    provider          TEXT NOT NULL,
    model             TEXT NOT NULL,
    purpose           TEXT NOT NULL,     -- e.g. enrich_commit, embed, query
    prompt_tokens     INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    cost_usd          REAL,
    related_commit    TEXT,
    FOREIGN KEY (related_commit) REFERENCES commits(hash) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_calls_occurred_at ON llm_calls(occurred_at);
CREATE INDEX IF NOT EXISTS idx_llm_calls_purpose ON llm_calls(purpose);

-- Vector embeddings for semantic search over enriched commit summaries.
-- Stored as BLOB (raw float32 little-endian). Search is done in JS via
-- cosine similarity; works well up to ~50k commits at <200ms/query.
CREATE TABLE IF NOT EXISTS commit_embeddings (
    commit_hash TEXT PRIMARY KEY,
    embedding   BLOB NOT NULL,
    dimensions  INTEGER NOT NULL,
    model       TEXT NOT NULL,
    indexed_at  INTEGER NOT NULL,
    FOREIGN KEY (commit_hash) REFERENCES commits(hash) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_commit_embeddings_model ON commit_embeddings(model);

-- Optional: embeddings for cluster summaries.
CREATE TABLE IF NOT EXISTS cluster_embeddings (
    cluster_id TEXT PRIMARY KEY,
    embedding  BLOB NOT NULL,
    dimensions INTEGER NOT NULL,
    model      TEXT NOT NULL,
    indexed_at INTEGER NOT NULL,
    FOREIGN KEY (cluster_id) REFERENCES commit_clusters(cluster_id) ON DELETE CASCADE
);
