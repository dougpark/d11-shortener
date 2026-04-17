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
