// src/index.ts — Cloudflare Worker entry point (Hono)

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { User, ApiToken } from './db/types.ts'
import { authMiddleware } from './middleware/authMiddleware.ts'
import { apiTokenMiddleware } from './middleware/apiTokenMiddleware.ts'
import authRoutes from './routes/auth.ts'
import bookmarkRoutes from './routes/bookmarks.ts'
import v1Routes from './routes/v1.ts'
import { getBookmarkBySlug, recordClick } from './db/bookmarks.ts'
import { getUserBySlugPrefix, getUserByTokenHash } from './db/users.ts'
import { hashToken } from './utils/auth.ts'
import { getCookie } from 'hono/cookie'
import { fetchFeed, buildTagList, extractKeywords } from './utils/rss.ts'
// @ts-expect-error — text module loaded by Wrangler rule
import appHtml from './client/app.html'
// @ts-expect-error — text module loaded by Wrangler rule
import stationHtml from './client/station.html'
// @ts-expect-error — text module loaded by Wrangler rule
import exploreHtml from './client/explore.html'
// @ts-expect-error — text module loaded by Wrangler rule
import importPinboardHtml from './client/import-pinboard.html'
// @ts-expect-error — text module loaded by Wrangler rule
import importBrowserHtml from './client/import-browser.html'
// @ts-expect-error — text module loaded by Wrangler rule
import newsHtml from './client/news.html'

// ─── Environment bindings (declared in wrangler.toml) ─────────────────────────
export type Env = {
  DB: D1Database
  TOKEN_SECRET: string
  ENVIRONMENT: string
}

// ─── Context variables set by middleware ──────────────────────────────────────
export type Variables = {
  user: User
  apiToken?: ApiToken   // set when authenticated via api_tokens table (v1 / MCP)
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

// ─── Global middleware ────────────────────────────────────────────────────────
app.use('*', cors({
  origin: '*',
  allowHeaders: ['Authorization', 'Content-Type'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}))

// ─── Public routes ────────────────────────────────────────────────────────────

// Auth (register / me)
app.route('/api/auth', authRoutes)

/**
 * GET /l/:prefix/:slug
 * Namespaced short-link redirect: d11.me/l/stephen/cowboys
 *
 * - Bots get an OG-preview HTML page.
 * - Humans get a 302 redirect.
 * - Private links return 404 to unauthenticated visitors.
 */
app.get('/l/:prefix/:slug', async (c) => {
  const { prefix, slug } = c.req.param()

  const user = await getUserBySlugPrefix(c.env.DB, prefix)
  if (!user) return c.notFound()

  // Resolve the requesting user from the auth cookie (if present) so we can
  // pass their id to getBookmarkBySlug — which filters private bookmarks at
  // the SQL level using (is_public = 1 OR user_id = ?).
  let requestingUserId: number | undefined
  const rawToken = getCookie(c, 'd11_auth')
  if (rawToken) {
    const tokenHash = await hashToken(decodeURIComponent(rawToken))
    const requestingUser = await getUserByTokenHash(c.env.DB, tokenHash)
    requestingUserId = requestingUser?.id
  }

  const bookmark = await getBookmarkBySlug(c.env.DB, slug, requestingUserId)
  if (!bookmark) return c.notFound()
  if (bookmark.user_id !== user.id) return c.notFound()

  // Private bookmarks are only accessible to the owner (enforced above via
  // getBookmarkBySlug — bots should not get an OG preview for private links)
  if (!bookmark.is_public && requestingUserId !== bookmark.user_id) return c.notFound()

  // Fire-and-forget analytics
  c.executionCtx.waitUntil(
    recordClick(
      c.env.DB,
      bookmark.id,
      c.req.header('Referer') ?? null,
      c.req.header('User-Agent') ?? null,
    ),
  )

  const ua = c.req.header('User-Agent') ?? ''
  const isBot = /bot|crawler|spider|slack|discord|twitter|facebook|whatsapp|telegram|preview|unfurl/i.test(ua)

  if (isBot) {
    const title = bookmark.title ?? bookmark.url
    const description = bookmark.short_description ?? `Shared via d11.me/l/${prefix}/${slug}`
    return c.html(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escHtml(title)}</title>
  <meta property="og:title" content="${escHtml(title)}">
  <meta property="og:description" content="${escHtml(description)}">
  <meta property="og:url" content="https://d11.me/l/${escHtml(prefix)}/${escHtml(slug)}">
  ${bookmark.favicon_url ? `<link rel="icon" href="${escHtml(bookmark.favicon_url)}">` : ''}
  <meta name="twitter:card" content="summary">
  <meta http-equiv="refresh" content="0;url=${escHtml(bookmark.url)}">
</head>
<body></body>
</html>`)
  }

  return c.redirect(bookmark.url, 302)
})

/**
 * GET /l/:slug  (legacy flat route — no prefix)
 * Looks up a bookmark by slug across all public bookmarks.
 */
app.get('/l/:slug', async (c) => {
  const slug = c.req.param('slug')
  const bookmark = await getBookmarkBySlug(c.env.DB, slug)
  if (!bookmark || !bookmark.is_public) return c.notFound()

  c.executionCtx.waitUntil(
    recordClick(
      c.env.DB,
      bookmark.id,
      c.req.header('Referer') ?? null,
      c.req.header('User-Agent') ?? null,
    ),
  )

  return c.redirect(bookmark.url, 302)
})

// ─── Authenticated API routes ─────────────────────────────────────────────────
app.use('/api/bookmarks/*', authMiddleware)

app.route('/api/bookmarks', bookmarkRoutes)

// Convenience top-level aliases
app.get('/api/tags', authMiddleware, async (c) => {
  return c.redirect('/api/bookmarks/tags/all')
})
app.get('/api/check-slug', authMiddleware, async (c) => {
  const q = c.req.query('q')
  return c.redirect(`/api/bookmarks/check-slug/availability${q ? `?q=${encodeURIComponent(q)}` : ''}`)
})
app.get('/api/check-url', authMiddleware, async (c) => {
  const url = c.req.query('url')
  return c.redirect(`/api/bookmarks/check-url${url ? `?url=${encodeURIComponent(url)}` : ''}`)
})
app.get('/api/preview', authMiddleware, async (c) => {
  const url = c.req.query('url')
  return c.redirect(`/api/bookmarks/preview/fetch${url ? `?url=${encodeURIComponent(url)}` : ''}`)
})

// ─── v1 public API ────────────────────────────────────────────────────────────
// Data endpoints use apiTokenMiddleware (accepts named API tokens or session token).
// Token management uses authMiddleware (session token only — prevents a token from minting tokens).
app.use('/api/v1/posts', apiTokenMiddleware)
app.use('/api/v1/posts/*', apiTokenMiddleware)
app.use('/api/v1/tags', apiTokenMiddleware)
app.use('/api/v1/tokens', authMiddleware)
app.use('/api/v1/tokens/*', authMiddleware)

app.route('/api/v1', v1Routes)

// ─── AI Daemon API ────────────────────────────────────────────────────────────
// Both routes require a named API token with the 'ai:process' scope.
app.use('/api/ai/*', apiTokenMiddleware)

// GET /api/ai/queue?limit=N — return a batch of unprocessed active items
app.get('/api/ai/queue', async (c) => {
  const apiToken = c.var.apiToken
  if (!apiToken) return c.json({ error: 'Forbidden', hint: 'Named API token with ai:process scope required' }, 403)
  let scopes: string[] = []
  try { scopes = JSON.parse(apiToken.scopes) } catch { /* leave empty */ }
  if (!scopes.includes('ai:process')) return c.json({ error: 'Forbidden', hint: 'Token missing ai:process scope' }, 403)

  const limitParam = parseInt(c.req.query('limit') ?? '20', 10)
  const limit = Math.min(Math.max(isNaN(limitParam) ? 20 : limitParam, 1), 50)
  const now = new Date().toISOString()

  const result = await c.env.DB.prepare(
    `SELECT r.id, r.url, r.title, r.summary, r.tag_list, r.published_at, f.name AS feed_name
       FROM rss_items r
       JOIN rss_feeds f ON f.id = r.feed_id
      WHERE r.ai_processed_at IS NULL
        AND r.expires_at > ?
      ORDER BY r.published_at ASC
      LIMIT ?`
  ).bind(now, limit).all()

  return c.json({ items: result.results, count: result.results.length })
})

// PATCH /api/ai/items — write AI tags + summary back for a batch of items
app.patch('/api/ai/items', async (c) => {
  const apiToken = c.var.apiToken
  if (!apiToken) return c.json({ error: 'Forbidden', hint: 'Named API token with ai:process scope required' }, 403)
  let scopes: string[] = []
  try { scopes = JSON.parse(apiToken.scopes) } catch { /* leave empty */ }
  if (!scopes.includes('ai:process')) return c.json({ error: 'Forbidden', hint: 'Token missing ai:process scope' }, 403)

  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
  if (!Array.isArray(body) || body.length === 0) return c.json({ error: 'Body must be a non-empty array' }, 400)
  if (body.length > 50) return c.json({ error: 'Batch too large — max 50 items' }, 400)

  type AiItem = { id: number; ai_tags?: string[]; ai_summary?: string }
  const items: AiItem[] = []
  for (const entry of body) {
    if (typeof entry !== 'object' || entry === null) return c.json({ error: 'Each item must be an object' }, 400)
    const { id, ai_tags, ai_summary } = entry as Record<string, unknown>
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) return c.json({ error: 'Each item must have a positive integer id' }, 400)
    if (ai_tags !== undefined && !Array.isArray(ai_tags)) return c.json({ error: 'ai_tags must be an array' }, 400)
    if (ai_summary !== undefined && typeof ai_summary !== 'string') return c.json({ error: 'ai_summary must be a string' }, 400)
    if (typeof ai_summary === 'string' && ai_summary.length > 2000) return c.json({ error: 'ai_summary too long (max 2000 chars)' }, 400)
    items.push({ id, ai_tags: ai_tags as string[] | undefined, ai_summary: ai_summary as string | undefined })
  }

  const now = new Date().toISOString()
  const stmts = items.map(item =>
    c.env.DB.prepare(
      `UPDATE rss_items SET ai_tags = ?, ai_summary = ?, ai_processed_at = ? WHERE id = ?`
    ).bind(
      item.ai_tags !== undefined ? JSON.stringify(item.ai_tags) : null,
      item.ai_summary ?? null,
      now,
      item.id
    )
  )

  await c.env.DB.batch(stmts)
  return c.json({ updated: items.length })
})

// ─── Station API: GET /api/v/:dashboardTag ──────────────────────────────────
// Optional auth. Authenticated → owner's own bookmarks. Unauthenticated → public only.
// Bookmarks are grouped by their secondary tags (tags other than dashboardTag).
// Secondary tags may carry a sort order via colon suffix: "AiStation:01".
app.get('/api/v/:dashboardTag', async (c) => {
  const rawTag = c.req.param('dashboardTag').toLowerCase()

  // Only allow safe tag characters
  if (!/^[a-z0-9_-]{1,64}$/.test(rawTag)) {
    return c.json({ error: 'Invalid tag name' }, 400)
  }

  // ?community forces the public-all-users query regardless of auth
  const community = c.req.query('community') !== undefined

  // Optional auth via cookie (skipped in community mode)
  let userId: number | undefined
  if (!community) {
    const rawToken = getCookie(c, 'd11_auth')
    if (rawToken) {
      const tokenHash = await hashToken(decodeURIComponent(rawToken))
      const user = await getUserByTokenHash(c.env.DB, tokenHash)
      userId = user?.id
    }
  }

  // The LIKE pattern safely bound as a parameter — not interpolated into SQL
  const likePattern = `%"${rawTag}"%`

  const result = userId
    ? await c.env.DB.prepare(
      `SELECT id, url, title, favicon_url, hit_count, tag_list
         FROM bookmarks
         WHERE user_id = ? AND is_archived = 0 AND tag_list LIKE ?
         ORDER BY created_at ASC`
    ).bind(userId, likePattern).all()
    : await c.env.DB.prepare(
      `SELECT id, url, title, favicon_url, hit_count, tag_list
         FROM bookmarks
         WHERE is_public = 1 AND is_archived = 0 AND tag_list LIKE ?
         ORDER BY created_at ASC`
    ).bind(likePattern).all()

  // Group bookmarks by secondary tags
  // Each secondary tag can carry a numeric sort order via colon suffix: "AiStation:01"
  type Group = { name: string; order: number; bookmarks: unknown[] }
  const groupMap = new Map<string, Group>()

  for (const row of (result.results as Record<string, unknown>[])) {
    let tags: string[] = []
    try { tags = JSON.parse((row.tag_list as string) || '[]') } catch { /* skip */ }

    // Tags other than the dashboard tag are used as group names
    const secondaryTags = tags.filter(t => t.toLowerCase() !== rawTag)
    const groupTags = secondaryTags.length > 0 ? secondaryTags : ['Misc']

    for (const gTag of groupTags) {
      const colonIdx = gTag.indexOf(':')
      const name = colonIdx >= 0 ? gTag.slice(0, colonIdx) : gTag
      const order = colonIdx >= 0 ? (parseInt(gTag.slice(colonIdx + 1), 10) || 500) : 500

      if (!groupMap.has(name)) groupMap.set(name, { name, order, bookmarks: [] })
      groupMap.get(name)!.bookmarks.push({
        id: row.id,
        url: row.url,
        title: row.title,
        favicon_url: row.favicon_url,
        hit_count: row.hit_count,
      })
    }
  }

  const groups = [...groupMap.values()]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))

  return c.json({ dashboardTag: rawTag, groups, authenticated: !!userId, community: community && !userId })
})

// ─── Explore API: GET /api/e — top tags landing (no tag param) ────────────
app.get('/api/e', async (c) => {
  // ?community forces the public-all-users query regardless of auth
  const community = c.req.query('community') !== undefined

  let userId: number | undefined
  if (!community) {
    const rawToken = getCookie(c, 'd11_auth')
    if (rawToken) {
      const tokenHash = await hashToken(decodeURIComponent(rawToken))
      const user = await getUserByTokenHash(c.env.DB, tokenHash)
      userId = user?.id
    }
  }

  // Fetch only tag_list — no need for other columns
  const result = userId
    ? await c.env.DB.prepare(
      `SELECT tag_list FROM bookmarks WHERE user_id = ? AND is_archived = 0`
    ).bind(userId).all()
    : await c.env.DB.prepare(
      `SELECT tag_list FROM bookmarks WHERE is_public = 1 AND is_archived = 0`
    ).all()

  // Tally tag frequency (strip sort-order suffix e.g. "AiStation:01" → "aistation")
  const counts = new Map<string, number>()
  for (const row of (result.results as Record<string, unknown>[])) {
    let tags: string[] = []
    try { tags = JSON.parse((row.tag_list as string) || '[]') } catch { /* skip */ }
    for (const t of tags) {
      const name = t.split(':')[0].toLowerCase()
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }

  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([tag, count]) => ({ tag, count }))

  return c.json({ tags: top, authenticated: !!userId, community: community && !userId })
})

// ─── Explore API: GET /api/e/:dashboardTag ──────────────────────────────────
// Optional auth. Authenticated → owner's own bookmarks. Unauthenticated → public only.
// Bookmarks are grouped by their secondary tags (tags other than dashboardTag).
// Secondary tags may carry a sort order via colon suffix: "AiStation:01".
app.get('/api/e/:dashboardTag', async (c) => {
  const rawTag = c.req.param('dashboardTag').toLowerCase()

  // Only allow safe tag characters
  if (!/^[a-z0-9_-]{1,64}$/.test(rawTag)) {
    return c.json({ error: 'Invalid tag name' }, 400)
  }

  // ?community forces the public-all-users query regardless of auth
  const community = c.req.query('community') !== undefined

  // Optional auth via cookie (skipped in community mode)
  let userId: number | undefined
  if (!community) {
    const rawToken = getCookie(c, 'd11_auth')
    if (rawToken) {
      const tokenHash = await hashToken(decodeURIComponent(rawToken))
      const user = await getUserByTokenHash(c.env.DB, tokenHash)
      userId = user?.id
    }
  }

  // The LIKE pattern safely bound as a parameter — not interpolated into SQL
  const likePattern = `%"${rawTag}"%`

  const result = userId
    ? await c.env.DB.prepare(
      `SELECT id, url, title, favicon_url, hit_count, tag_list
         FROM bookmarks
         WHERE user_id = ? AND is_archived = 0 AND tag_list LIKE ?
         ORDER BY created_at ASC`
    ).bind(userId, likePattern).all()
    : await c.env.DB.prepare(
      `SELECT id, url, title, favicon_url, hit_count, tag_list
         FROM bookmarks
         WHERE is_public = 1 AND is_archived = 0 AND tag_list LIKE ?
         ORDER BY created_at ASC`
    ).bind(likePattern).all()

  // Group bookmarks by secondary tags
  // Each secondary tag can carry a numeric sort order via colon suffix: "AiStation:01"
  type Group = { name: string; order: number; bookmarks: unknown[] }
  const groupMap = new Map<string, Group>()

  for (const row of (result.results as Record<string, unknown>[])) {
    let tags: string[] = []
    try { tags = JSON.parse((row.tag_list as string) || '[]') } catch { /* skip */ }

    // Tags other than the dashboard tag are used as group names
    const secondaryTags = tags.filter(t => t.toLowerCase() !== rawTag)
    const groupTags = secondaryTags.length > 0 ? secondaryTags : ['Misc']

    for (const gTag of groupTags) {
      const colonIdx = gTag.indexOf(':')
      const name = colonIdx >= 0 ? gTag.slice(0, colonIdx) : gTag
      const order = colonIdx >= 0 ? (parseInt(gTag.slice(colonIdx + 1), 10) || 500) : 500

      if (!groupMap.has(name)) groupMap.set(name, { name, order, bookmarks: [] })
      groupMap.get(name)!.bookmarks.push({
        id: row.id,
        url: row.url,
        title: row.title,
        favicon_url: row.favicon_url,
        hit_count: row.hit_count,
      })
    }
  }

  const groups = [...groupMap.values()]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))

  return c.json({ dashboardTag: rawTag, groups, authenticated: !!userId, community: community && !userId })
})

// ─── News API: GET /api/n — top tags from active rss_items ──────────────────
app.get('/api/n', async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT tag_list FROM rss_items WHERE expires_at > ?`
  ).bind(new Date().toISOString()).all()

  const counts = new Map<string, number>()
  for (const row of (result.results as { tag_list: string }[])) {
    let tags: string[] = []
    try { tags = JSON.parse(row.tag_list || '[]') } catch { /* skip */ }
    for (const t of tags) {
      const name = t.split(':')[0].toLowerCase()
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }

  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([tag, count]) => ({ tag, count }))

  return c.json({ tags: top })
})

// ─── News API: GET /api/n/recent — chronological article feed ────────────────
app.get('/api/n/recent', async (c) => {
  const now = new Date().toISOString()
  const result = await c.env.DB.prepare(
    `SELECT r.id, r.url, r.title, r.summary, r.tag_list, r.published_at, r.ai_tags, r.ai_summary,
            f.name AS feed_name
       FROM rss_items r
       JOIN rss_feeds f ON f.id = r.feed_id
      WHERE r.expires_at > ?
      ORDER BY r.published_at DESC
      LIMIT 100`
  ).bind(now).all()
  return c.json({ items: result.results })
})

// ─── News API: GET /api/n/:tag — items matching tag, grouped by secondary tags
app.get('/api/n/:tag', async (c) => {
  const rawTag = c.req.param('tag').toLowerCase()

  if (!/^[a-z0-9_.-]{1,64}$/.test(rawTag)) {
    return c.json({ error: 'Invalid tag name' }, 400)
  }

  const now = new Date().toISOString()
  const likePattern = `%"${rawTag}"%`

  const result = await c.env.DB.prepare(
    `SELECT r.id, r.url, r.title, r.summary, r.tag_list, r.published_at, r.feed_id,
            r.ai_tags, r.ai_summary,
            f.name AS feed_name
       FROM rss_items r
       JOIN rss_feeds f ON f.id = r.feed_id
      WHERE r.expires_at > ? AND r.tag_list LIKE ?
      ORDER BY r.published_at DESC`
  ).bind(now, likePattern).all()

  type Group = { name: string; items: unknown[] }
  const groupMap = new Map<string, Group>()

  for (const row of (result.results as Record<string, unknown>[])) {
    let tags: string[] = []
    try { tags = JSON.parse((row.tag_list as string) || '[]') } catch { /* skip */ }

    const secondaryTags = tags.filter(t => t.toLowerCase() !== rawTag)
    const groupTags = secondaryTags.length > 0 ? secondaryTags : ['misc']

    for (const gTag of groupTags) {
      if (!groupMap.has(gTag)) groupMap.set(gTag, { name: gTag, items: [] })
      groupMap.get(gTag)!.items.push({
        id: row.id,
        url: row.url,
        title: row.title,
        summary: row.summary,
        ai_summary: row.ai_summary,
        ai_tags: row.ai_tags,
        tag_list: row.tag_list,
        published_at: row.published_at,
        feed_name: row.feed_name,
      })
    }
  }

  // Sort groups by item count descending
  const groups = [...groupMap.values()]
    .sort((a, b) => b.items.length - a.items.length)

  return c.json({ tag: rawTag, groups })
})

// ─── Front-end HTML (single SPA served for all UI routes) ────────────────────
app.get('/', (c) => c.html(appHtml as string))
app.get('/add', (c) => c.html(appHtml as string))
app.get('/v/:dashboardTag', (c) => c.html(stationHtml as string))
app.get('/e', (c) => c.html(exploreHtml as string))
app.get('/e/:dashboardTag', (c) => c.html(exploreHtml as string))
app.get('/n', (c) => c.html(newsHtml as string))
app.get('/n/:tag', (c) => c.html(newsHtml as string))
app.get('/import/pinboard', (c) => c.html(importPinboardHtml as string))
app.get('/import/browser', (c) => c.html(importBrowserHtml as string))

// ─── 404 catch-all ────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Not Found' }, 404))

// ─── Cron Trigger: RSS ingest ────────────────────────────────────────────────
async function scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(ingestAllFeeds(env))
}

async function ingestAllFeeds(env: Env): Promise<void> {
  // Load active feeds
  const feedRows = await env.DB.prepare(
    'SELECT id, url, name FROM rss_feeds WHERE is_active = 1'
  ).all()

  const now = new Date()
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()

  for (const feed of feedRows.results as { id: number; url: string; name: string }[]) {
    try {
      const items = await fetchFeed(feed.url)

      for (const item of items) {
        const keywords = extractKeywords(item.title)
        const tagList = buildTagList(item.categories, keywords)

        await env.DB.prepare(`
          INSERT OR IGNORE INTO rss_items
            (feed_id, guid, url, title, summary, tag_list, published_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          feed.id,
          item.guid,
          item.url,
          item.title,
          item.summary,
          tagList,
          item.publishedAt,
          expiresAt,
        ).run()
      }

      // Update last_fetched_at
      await env.DB.prepare(
        `UPDATE rss_feeds SET last_fetched_at = ? WHERE id = ?`
      ).bind(now.toISOString(), feed.id).run()

    } catch (err) {
      // Log but don't abort the whole run — one bad feed shouldn't block others
      console.error(`[rss] Failed to ingest feed ${feed.name}: ${(err as Error).message}`)
    }
  }

  // Hard delete expired items
  await env.DB.prepare(
    `DELETE FROM rss_items WHERE expires_at < ?`
  ).bind(now.toISOString()).run()
}

export default { fetch: app.fetch, scheduled }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
