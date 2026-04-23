-- =============================================================================
-- d11.me — D1 Schema
-- Apply locally:  wrangler d1 execute d11-db --local --file=./schema.sql
-- Apply remote:   wrangler d1 execute d11-db --file=./schema.sql
-- =============================================================================

-- ─── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- SHA-256 hex token used as the Bearer credential (store hashed, never plain)
  token_hash   TEXT    NOT NULL UNIQUE,
  slug_prefix  TEXT    NOT NULL UNIQUE,   -- e.g. "stephen" → d11.me/l/stephen/git
  full_name    TEXT,
  email        TEXT    UNIQUE,
  phone        TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_users_token_hash   ON users (token_hash);
CREATE INDEX IF NOT EXISTS idx_users_slug_prefix  ON users (slug_prefix);

-- ─── Bookmarks ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookmarks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  -- Core link data
  url             TEXT    NOT NULL,
  slug            TEXT    NOT NULL,         -- user-chosen short-link name
  title           TEXT,                     -- fetched <title> or user-provided
  short_description TEXT,                   -- user note or AI summary
  full_text       TEXT,                     -- reserved: cleaned full page text
  favicon_url     TEXT,                     -- https://…/favicon.ico

  -- Visibility & state
  is_public       INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  is_archived     INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),

  -- Tags stored as a JSON array string, e.g. '["dev","tools","cloudflare"]'
  tag_list        TEXT    NOT NULL DEFAULT '[]',

  -- Analytics
  hit_count       INTEGER NOT NULL DEFAULT 0,
  last_accessed   TEXT,

  -- Expiration (optional TTL feature)
  expires_at      TEXT,

  -- Timestamps
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

  -- A slug must be unique per user (namespace approach)
  UNIQUE (user_id, slug)
);

-- Fast lookup for the redirect route GET /l/:prefix/:slug
CREATE INDEX IF NOT EXISTS idx_bookmarks_slug       ON bookmarks (slug);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_id    ON bookmarks (user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_created_at ON bookmarks (created_at);
CREATE INDEX IF NOT EXISTS idx_bookmarks_is_public  ON bookmarks (is_public);

-- ─── Click analytics (optional, for per-click referrer / heatmap data) ────────
CREATE TABLE IF NOT EXISTS click_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  bookmark_id  INTEGER NOT NULL REFERENCES bookmarks (id) ON DELETE CASCADE,
  clicked_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  referrer     TEXT,
  user_agent   TEXT
);

CREATE INDEX IF NOT EXISTS idx_clicks_bookmark_id ON click_events (bookmark_id);
CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at  ON click_events (clicked_at);

-- ─── API Tokens (programmatic access / v1 API / MCP / RSS) ───────────────────
--
-- Each user can issue multiple named tokens — one per consumer ("python script",
-- "claude agent", "n8n workflow").  Only the SHA-256 hash is stored; the raw
-- token is shown exactly once at creation time and never again.
--
-- scopes: JSON array of capability strings, e.g. '["posts:read","tags:read"]'
--   Current defined scopes: posts:read, posts:write, tags:read, tags:write
--   Use '["*"]' to grant all permissions.
--
-- expires_at: optional hard expiry.  NULL means the token never expires.
CREATE TABLE IF NOT EXISTS api_tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,               -- human label, e.g. "my python script"
  token_hash   TEXT    NOT NULL UNIQUE,        -- SHA-256(raw_token) hex — never store raw
  scopes       TEXT    NOT NULL DEFAULT '["posts:read","tags:read"]',
  last_used_at TEXT,                           -- updated on each successful auth
  expires_at   TEXT,                           -- ISO 8601 UTC, NULL = never
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id    ON api_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_token_hash ON api_tokens (token_hash);

-- ─── RSS Feeds (seed rows managed via SQL, admin UI in V2) ───────────────────
CREATE TABLE IF NOT EXISTS rss_feeds (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  url             TEXT    NOT NULL UNIQUE,
  name            TEXT    NOT NULL,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  last_fetched_at TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ─── RSS Items (auto-expire after 30 days, separate from user bookmarks) ─────
CREATE TABLE IF NOT EXISTS rss_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id      INTEGER NOT NULL REFERENCES rss_feeds (id) ON DELETE CASCADE,

  -- Deduplication key — use RSS <guid> or fall back to URL
  guid         TEXT    NOT NULL UNIQUE,

  url          TEXT    NOT NULL,
  title        TEXT,
  summary      TEXT,                           -- <description> snippet, plain text

  -- Tags derived from RSS <category> fields + title keyword extraction
  tag_list     TEXT    NOT NULL DEFAULT '[]',

  published_at    TEXT,                         -- RSS <pubDate> normalised to ISO 8601 UTC
  expires_at      TEXT    NOT NULL,             -- created_at + 30 days, enforced at ingest
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

  -- AI enrichment (populated by external daemon via /api/ai/*)
  ai_tags         TEXT    DEFAULT NULL,         -- JSON array, additive alongside tag_list
  ai_summary      TEXT    DEFAULT NULL,         -- clean AI-generated summary
  ai_processed_at TEXT    DEFAULT NULL          -- NULL = not yet processed by AI
);

CREATE INDEX IF NOT EXISTS idx_rss_items_guid            ON rss_items (guid);
CREATE INDEX IF NOT EXISTS idx_rss_items_expires_at      ON rss_items (expires_at);
CREATE INDEX IF NOT EXISTS idx_rss_items_feed_id         ON rss_items (feed_id);
CREATE INDEX IF NOT EXISTS idx_rss_items_tag_list        ON rss_items (tag_list);
CREATE INDEX IF NOT EXISTS idx_rss_items_ai_processed_at ON rss_items (ai_processed_at);
