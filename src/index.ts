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
import { renderHeader } from './utils/header.ts'
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
// @ts-expect-error — text module loaded by Wrangler rule
import adminHtml from './client/admin.html'
// @ts-expect-error — text module loaded by Wrangler rule
import analyticsHtml from './client/analytics.html'

// ─── Environment bindings (declared in wrangler.toml) ─────────────────────────
export type Env = {
  DB: D1Database
  TOKEN_SECRET: string
  ENVIRONMENT: string
  AI: Ai
  AI_BOOKMARK_MODEL: string
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
app.use('/api/v1/rss/*', apiTokenMiddleware)
app.use('/api/v1/tokens', authMiddleware)
app.use('/api/v1/tokens/*', authMiddleware)

app.route('/api/v1', v1Routes)

// ─── AI Enrichment — real-time suggestions for new bookmarks ──────────────────────
// Authenticated via session token. Returns suggestions only — does NOT write to DB.
app.post('/api/ai/enrich', authMiddleware, async (c) => {
  let body: { url?: string; title?: string; short_description?: string; selected_text?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const { url = '', title = '', short_description = '', selected_text = '' } = body
  if (!url && !title) return c.json({ ai_summary: null, ai_tags: [] })

  const model = c.env.AI_BOOKMARK_MODEL || '@cf/meta/llama-3.2-1b-instruct'
  const snippet = (selected_text || short_description).slice(0, 300)

  const messages = [{
    role: 'user' as const,
    content: `You are a bookmark tagger. Given this webpage:\nTitle: ${title}\nURL: ${url}\nText: ${snippet}\n\nReturn only valid JSON with no markdown:\n{"summary":"one sentence, max 160 chars","tags":["tag1","tag2","tag3"]}\n\nTags: lowercase, 1-2 words, topical, max 5.`,
  }]

  try {
    type AiResult = { response?: string }
    const result = await Promise.race([
      c.env.AI.run(model, { messages, max_tokens: 512 }) as Promise<AiResult>,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
    ])
    const raw = (result as AiResult).response ?? ''
    let parsed: { summary?: unknown; tags?: unknown } = {}
    try { parsed = JSON.parse(raw) } catch {
      const m = raw.match(/\{[\s\S]*?\}/)
      if (m) try { parsed = JSON.parse(m[0]) } catch { /* discard */ }
    }
    return c.json({
      ai_summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 160) : null,
      ai_tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((t): t is string => typeof t === 'string').slice(0, 5)
        : [],
    })
  } catch {
    return c.json({ ai_summary: null, ai_tags: [] })
  }
})

// ─── AI Daemon API ────────────────────────────────────────────────────────────
// Requires a named API token with one or more ai:process:* scopes.
// Legacy scope 'ai:process' is accepted and grants access to both RSS and bookmarks.
app.use('/api/ai/*', apiTokenMiddleware)

function parseAiAllowed(scopesJson: string): { rss: boolean; bookmarks: boolean } {
  let scopes: string[] = []
  try { scopes = JSON.parse(scopesJson) } catch { /* leave empty */ }
  const legacy = scopes.includes('ai:process')
  return {
    rss: legacy || scopes.includes('ai:process:rss'),
    bookmarks: legacy || scopes.includes('ai:process:bookmarks'),
  }
}

// GET /api/ai/queue — return a batch of unprocessed items (RSS and/or bookmarks)
//   ?source=rss|bookmarks|all  (default: all, limited by token scopes)
//   &limit=1-50                (default: 20)
//   &offset=0                  (for paging)
//   &force=true                (include already-processed items)
app.get('/api/ai/queue', async (c) => {
  const apiToken = c.var.apiToken
  if (!apiToken) return c.json({ error: 'Forbidden', hint: 'Named API token with ai:process scope required' }, 403)

  const allowed = parseAiAllowed(apiToken.scopes)
  if (!allowed.rss && !allowed.bookmarks) {
    return c.json({ error: 'Forbidden', hint: 'Token missing ai:process:rss or ai:process:bookmarks scope' }, 403)
  }

  const limitParam = parseInt(c.req.query('limit') ?? '20', 10)
  const offsetParam = parseInt(c.req.query('offset') ?? '0', 10)
  const limit = Math.min(Math.max(isNaN(limitParam) ? 20 : limitParam, 1), 50)
  const offset = Math.max(isNaN(offsetParam) ? 0 : offsetParam, 0)
  const force = c.req.query('force') === 'true'

  const requestedSource = c.req.query('source') ?? 'all'
  if (!['rss', 'bookmarks', 'all'].includes(requestedSource)) {
    return c.json({ error: "source must be 'rss', 'bookmarks', or 'all'" }, 400)
  }

  const includeRss = allowed.rss && (requestedSource === 'rss' || requestedSource === 'all')
  const includeBookmarks = allowed.bookmarks && (requestedSource === 'bookmarks' || requestedSource === 'all')

  const now = new Date().toISOString()
  const notProcessedRss = force ? '' : 'AND r.ai_processed_at IS NULL'
  const notProcessedBm = force ? '' : 'AND b.ai_processed_at IS NULL'

  const rssSql = `
    SELECT 'rss' AS source, r.id, r.url, r.title, r.summary AS body, r.tag_list,
           r.published_at AS created_at, json_object('feed_name', f.name) AS context
      FROM rss_items r
      JOIN rss_feeds f ON f.id = r.feed_id
     WHERE r.expires_at > ? ${notProcessedRss}`

  const bmSql = `
    SELECT 'bookmark' AS source, b.id, b.url, b.title, b.short_description AS body, b.tag_list,
           b.created_at, json_object('user_id', b.user_id) AS context
      FROM bookmarks b
      JOIN users u ON u.id = b.user_id
     WHERE b.is_archived = 0
       AND (b.is_public = 1 OR u.ai_allow_private = 1)
       ${notProcessedBm}`

  let itemsSql: string
  let itemsBindings: (string | number)[]

  if (includeRss && includeBookmarks) {
    itemsSql = `${rssSql} UNION ALL ${bmSql} ORDER BY created_at ASC LIMIT ? OFFSET ?`
    itemsBindings = [now, limit, offset]
  } else if (includeRss) {
    itemsSql = `${rssSql} ORDER BY created_at ASC LIMIT ? OFFSET ?`
    itemsBindings = [now, limit, offset]
  } else {
    itemsSql = `${bmSql} ORDER BY created_at ASC LIMIT ? OFFSET ?`
    itemsBindings = [limit, offset]
  }

  const [itemsResult, rssCountResult, bmCountResult] = await c.env.DB.batch([
    c.env.DB.prepare(itemsSql).bind(...itemsBindings),
    includeRss
      ? c.env.DB.prepare(`SELECT COUNT(*) AS cnt FROM rss_items r WHERE r.expires_at > ? ${notProcessedRss}`).bind(now)
      : c.env.DB.prepare('SELECT 0 AS cnt'),
    includeBookmarks
      ? c.env.DB.prepare(`SELECT COUNT(*) AS cnt FROM bookmarks b JOIN users u ON u.id = b.user_id WHERE b.is_archived = 0 AND (b.is_public = 1 OR u.ai_allow_private = 1) ${notProcessedBm}`)
      : c.env.DB.prepare('SELECT 0 AS cnt'),
  ])

  type RawRow = { source: 'rss' | 'bookmark'; id: number; url: string; title: string | null; body: string | null; tag_list: string; created_at: string; context: string }
  const items = (itemsResult.results as RawRow[]).map(row => {
    let tags: string[] = []
    try { tags = [...new Set((JSON.parse(row.tag_list || '[]') as string[]).map(t => t.split(':')[0].toLowerCase()))] } catch { /* leave empty */ }
    let context: Record<string, unknown> = {}
    try { context = JSON.parse(row.context || '{}') } catch { /* leave empty */ }
    return { source: row.source, id: row.id, url: row.url, title: row.title, body: row.body, tags, created_at: row.created_at, context }
  })

  const rssTotal = (rssCountResult.results[0] as { cnt: number } | undefined)?.cnt ?? 0
  const bmTotal = (bmCountResult.results[0] as { cnt: number } | undefined)?.cnt ?? 0

  return c.json({
    items,
    count: items.length,
    total_pending: rssTotal + bmTotal,
    source_breakdown: { rss: rssTotal, bookmarks: bmTotal },
  })
})

// PATCH /api/ai/items — write AI tags + summary back for a batch of items
//   Body: [{ source: "rss"|"bookmark", id, ai_tags?, ai_summary? }, ...]
//   source is required; routes writes to rss_items or bookmarks accordingly.
//   Token must hold the matching ai:process:rss / ai:process:bookmarks scope.
app.patch('/api/ai/items', async (c) => {
  const apiToken = c.var.apiToken
  if (!apiToken) return c.json({ error: 'Forbidden', hint: 'Named API token with ai:process scope required' }, 403)

  const allowed = parseAiAllowed(apiToken.scopes)
  if (!allowed.rss && !allowed.bookmarks) {
    return c.json({ error: 'Forbidden', hint: 'Token missing ai:process:rss or ai:process:bookmarks scope' }, 403)
  }

  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
  if (!Array.isArray(body) || body.length === 0) return c.json({ error: 'Body must be a non-empty array' }, 400)
  if (body.length > 50) return c.json({ error: 'Batch too large — max 50 items' }, 400)

  type AiItem = { source: 'rss' | 'bookmark'; id: number; ai_tags?: string[]; ai_summary?: string }
  const items: AiItem[] = []

  for (const entry of body) {
    if (typeof entry !== 'object' || entry === null) return c.json({ error: 'Each item must be an object' }, 400)
    const { source, id, ai_tags, ai_summary } = entry as Record<string, unknown>
    if (source !== 'rss' && source !== 'bookmark') return c.json({ error: "Each item must have source 'rss' or 'bookmark'" }, 400)
    if (source === 'rss' && !allowed.rss) return c.json({ error: 'Token lacks ai:process:rss scope' }, 403)
    if (source === 'bookmark' && !allowed.bookmarks) return c.json({ error: 'Token lacks ai:process:bookmarks scope' }, 403)
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) return c.json({ error: 'Each item must have a positive integer id' }, 400)
    if (ai_tags !== undefined && !Array.isArray(ai_tags)) return c.json({ error: 'ai_tags must be an array' }, 400)
    if (ai_summary !== undefined && typeof ai_summary !== 'string') return c.json({ error: 'ai_summary must be a string' }, 400)
    if (typeof ai_summary === 'string' && ai_summary.length > 2000) return c.json({ error: 'ai_summary too long (max 2000 chars)' }, 400)
    items.push({ source: source as 'rss' | 'bookmark', id, ai_tags: ai_tags as string[] | undefined, ai_summary: ai_summary as string | undefined })
  }

  const now = new Date().toISOString()
  const stmts = items.map(item => {
    const table = item.source === 'rss' ? 'rss_items' : 'bookmarks'
    return c.env.DB.prepare(
      `UPDATE ${table} SET ai_tags = ?, ai_summary = ?, ai_processed_at = ? WHERE id = ?`
    ).bind(
      item.ai_tags !== undefined ? JSON.stringify(item.ai_tags) : null,
      item.ai_summary ?? null,
      now,
      item.id
    )
  })

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
      `SELECT id, url, title, short_description, favicon_url, hit_count, tag_list, ai_summary, ai_tags, created_at
         FROM bookmarks
         WHERE user_id = ? AND is_archived = 0 AND tag_list LIKE ?
         ORDER BY created_at ASC`
    ).bind(userId, likePattern).all()
    : await c.env.DB.prepare(
      `SELECT id, url, title, short_description, favicon_url, hit_count, tag_list, ai_summary, ai_tags, created_at
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
        short_description: row.short_description ?? null,
        ai_summary: row.ai_summary ?? null,
        ai_tags: row.ai_tags ?? null,
        created_at: row.created_at,
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
      `SELECT id, url, title, short_description, favicon_url, hit_count, tag_list, ai_summary, ai_tags, created_at
         FROM bookmarks
         WHERE user_id = ? AND is_archived = 0 AND tag_list LIKE ?
         ORDER BY created_at ASC`
    ).bind(userId, likePattern).all()
    : await c.env.DB.prepare(
      `SELECT id, url, title, short_description, favicon_url, hit_count, tag_list, ai_summary, ai_tags, created_at
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
        tag_list: row.tag_list,
        short_description: row.short_description,
        ai_summary: row.ai_summary,
        ai_tags: row.ai_tags,
        created_at: row.created_at,
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
    `SELECT tag_list, ai_tags FROM rss_items WHERE expires_at > ?`
  ).bind(new Date().toISOString()).all()

  const counts = new Map<string, number>()
  for (const row of (result.results as { tag_list: string; ai_tags: string | null }[])) {
    let tags: string[] = []
    try { tags = JSON.parse(row.tag_list || '[]') } catch { /* skip */ }
    let aiTags: string[] = []
    try { aiTags = JSON.parse(row.ai_tags || '[]') } catch { /* skip */ }
    for (const t of [...tags, ...aiTags]) {
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
  const [result, countResult] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT r.id, r.url, r.title, r.summary, r.tag_list, r.published_at, r.ai_tags, r.ai_summary,
              f.name AS feed_name
         FROM rss_items r
         JOIN rss_feeds f ON f.id = r.feed_id
        WHERE r.expires_at > ?
        ORDER BY r.published_at DESC
        LIMIT 100`
    ).bind(now),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total FROM rss_items WHERE expires_at > ?`
    ).bind(now),
  ])
  const total = (countResult.results[0] as { total: number } | undefined)?.total ?? result.results.length
  return c.json({ items: result.results, total })
})

// ─── News API: GET /api/n/search?q= — FTS across all rss_items ───────────────
app.get('/api/n/search', async (c) => {
  const raw = (c.req.query('q') || '').trim()
  if (!raw) return c.json({ items: [], total: 0 })

  // Build a safe FTS5 query: quote each token so special chars don't break the parser
  const ftsQuery = raw.trim().split(/\s+/)
    .map(t => '"' + t.replace(/"/g, '""') + '"')
    .join(' ')

  const now = new Date().toISOString()
  const [result, countResult] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT r.id, r.url, r.title, r.summary, r.tag_list, r.published_at, r.ai_tags, r.ai_summary,
              f.name AS feed_name
         FROM rss_items_fts fts
         JOIN rss_items r ON r.id = fts.rowid
         JOIN rss_feeds f ON f.id = r.feed_id
        WHERE rss_items_fts MATCH ? AND r.expires_at > ?
        ORDER BY r.published_at DESC
        LIMIT 100`
    ).bind(ftsQuery, now),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total
         FROM rss_items_fts fts
         JOIN rss_items r ON r.id = fts.rowid
        WHERE rss_items_fts MATCH ? AND r.expires_at > ?`
    ).bind(ftsQuery, now),
  ])
  const total = (countResult.results[0] as { total: number } | undefined)?.total ?? result.results.length
  return c.json({ items: result.results, total })
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
      WHERE r.expires_at > ? AND (r.tag_list LIKE ? OR r.ai_tags LIKE ?)
      ORDER BY r.published_at DESC`
  ).bind(now, likePattern, likePattern).all()

  type Group = { name: string; items: unknown[] }
  const groupMap = new Map<string, Group>()

  for (const row of (result.results as Record<string, unknown>[])) {
    let tags: string[] = []
    try { tags = JSON.parse((row.tag_list as string) || '[]') } catch { /* skip */ }
    let aiTags: string[] = []
    try { aiTags = JSON.parse((row.ai_tags as string) || '[]') } catch { /* skip */ }

    // Combine original and AI tags, normalise to base tag (strip colon suffix)
    const allTagNames = [...new Set([
      ...tags.map(t => t.split(':')[0].toLowerCase()),
      ...aiTags.map(t => t.split(':')[0].toLowerCase()),
    ])]

    const secondaryTags = allTagNames.filter(t => t !== rawTag)
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

// ─── Admin API ────────────────────────────────────────────────────────────────
// All admin routes require a valid session + is_admin = 1.

function requireAdmin(c: Parameters<typeof authMiddleware>[0]): Response | null {
  const user = c.var.user as User
  if (!user || user.is_admin !== 1) {
    return c.json({ error: 'Forbidden' }, 403) as Response
  }
  return null
}

// GET /api/admin/stats — site-wide stats for the admin dashboard.
app.get('/api/admin/stats', authMiddleware, async (c) => {
  const deny = requireAdmin(c)
  if (deny) return deny
  const now = new Date().toISOString()

  const [bm, users, tokens, feeds, rssItems, bmPublic, bmAi, bm7d, bm30d, topTags] =
    await c.env.DB.batch([
      c.env.DB.prepare('SELECT COUNT(*) AS cnt FROM bookmarks'),
      c.env.DB.prepare('SELECT COUNT(*) AS cnt FROM users'),
      c.env.DB.prepare('SELECT COUNT(*) AS cnt FROM api_tokens'),
      c.env.DB.prepare('SELECT COUNT(*) AS total, SUM(is_active) AS active FROM rss_feeds'),
      c.env.DB.prepare('SELECT COUNT(*) AS cnt FROM rss_items WHERE expires_at > ?').bind(now),
      c.env.DB.prepare('SELECT COUNT(*) AS cnt FROM bookmarks WHERE is_public = 1'),
      c.env.DB.prepare('SELECT COUNT(*) AS cnt FROM bookmarks WHERE ai_processed_at IS NOT NULL'),
      c.env.DB.prepare(`SELECT COUNT(*) AS cnt FROM bookmarks WHERE created_at >= datetime('now','-7 days')`),
      c.env.DB.prepare(`SELECT COUNT(*) AS cnt FROM bookmarks WHERE created_at >= datetime('now','-30 days')`),
      c.env.DB.prepare('SELECT tag_list FROM bookmarks WHERE tag_list != \'[]\''),
    ])

  // Tally tag frequencies from all bookmarks
  const tagCounts = new Map<string, number>()
  for (const row of (topTags.results as { tag_list: string }[])) {
    let tags: string[] = []
    try { tags = JSON.parse(row.tag_list) } catch { /* skip */ }
    for (const t of tags) {
      const name = t.split(':')[0].toLowerCase()
      tagCounts.set(name, (tagCounts.get(name) ?? 0) + 1)
    }
  }
  const top10Tags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }))

  const bmRow = bm.results[0] as { cnt: number }
  const usrRow = users.results[0] as { cnt: number }
  const tokRow = tokens.results[0] as { cnt: number }
  const feedRow = feeds.results[0] as { total: number; active: number }
  const rssRow = rssItems.results[0] as { cnt: number }
  const pubRow = bmPublic.results[0] as { cnt: number }
  const aiRow = bmAi.results[0] as { cnt: number }
  const w7Row = bm7d.results[0] as { cnt: number }
  const w30Row = bm30d.results[0] as { cnt: number }

  return c.json({
    bookmarks: {
      total: bmRow.cnt,
      public: pubRow.cnt,
      private: bmRow.cnt - pubRow.cnt,
      ai_processed: aiRow.cnt,
      new_7d: w7Row.cnt,
      new_30d: w30Row.cnt,
    },
    users: usrRow.cnt,
    api_tokens: tokRow.cnt,
    rss_feeds: { total: feedRow.total, active: feedRow.active },
    rss_items: rssRow.cnt,
    top_tags: top10Tags,
  })
})

// GET /api/admin/users — list all users with per-user bookmark stats (admin only)
app.get('/api/admin/users', authMiddleware, async (c) => {
  const deny = requireAdmin(c)
  if (deny) return deny

  const result = await c.env.DB.prepare(
    `SELECT u.id, u.slug_prefix, u.full_name, u.email, u.created_at, u.is_admin, u.ai_allow_private,
            COUNT(b.id)                                                  AS bookmark_total,
            SUM(CASE WHEN b.is_public = 1  THEN 1 ELSE 0 END)           AS bookmark_public,
            SUM(CASE WHEN b.is_public = 0  THEN 1 ELSE 0 END)           AS bookmark_private,
            SUM(CASE WHEN b.ai_processed_at IS NOT NULL THEN 1 ELSE 0 END) AS bookmark_ai,
            MAX(b.created_at)                                            AS last_bookmark_at
       FROM users u
       LEFT JOIN bookmarks b ON b.user_id = u.id AND b.is_archived = 0
       GROUP BY u.id
       ORDER BY bookmark_total DESC`
  ).all()

  return c.json({ users: result.results })
})

// PATCH /api/admin/users/:id — update is_admin and/or ai_allow_private (admin only)
// Body: { is_admin?: boolean, ai_allow_private?: boolean }
// Prevents self-demotion of is_admin.
app.patch('/api/admin/users/:id', authMiddleware, async (c) => {
  const deny = requireAdmin(c)
  if (deny) return deny

  const targetId = parseInt(c.req.param('id') ?? '', 10)
  if (!Number.isInteger(targetId) || targetId < 1) {
    return c.json({ error: 'Invalid user id' }, 400)
  }

  const currentUser = c.var.user as User

  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
  if (typeof body !== 'object' || body === null) return c.json({ error: 'Invalid body' }, 400)

  const patch = body as Record<string, unknown>
  const setClauses: string[] = []
  const bindings: (number)[] = []

  if ('is_admin' in patch) {
    if (targetId === currentUser.id) return c.json({ error: 'You cannot change your own admin status' }, 400)
    if (patch.is_admin !== true && patch.is_admin !== false) return c.json({ error: 'is_admin must be true or false' }, 400)
    setClauses.push('is_admin = ?')
    bindings.push(patch.is_admin ? 1 : 0)
  }

  if ('ai_allow_private' in patch) {
    if (patch.ai_allow_private !== true && patch.ai_allow_private !== false) return c.json({ error: 'ai_allow_private must be true or false' }, 400)
    setClauses.push('ai_allow_private = ?')
    bindings.push(patch.ai_allow_private ? 1 : 0)
  }

  if (setClauses.length === 0) return c.json({ error: 'No valid fields to update' }, 400)

  bindings.push(targetId)
  const result = await c.env.DB.prepare(
    `UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`
  ).bind(...bindings).run()

  if (result.meta.changes === 0) return c.json({ error: 'User not found' }, 404)

  return c.json({ ok: true, id: targetId })
})

// DELETE /api/admin/users/:id — delete a user and all their data (admin only)
// Prevents self-delete. Bookmarks cascade via FK.
app.delete('/api/admin/users/:id', authMiddleware, async (c) => {
  const deny = requireAdmin(c)
  if (deny) return deny

  const targetId = parseInt(c.req.param('id') ?? '', 10)
  if (!Number.isInteger(targetId) || targetId < 1) {
    return c.json({ error: 'Invalid user id' }, 400)
  }

  const currentUser = c.var.user as User
  if (targetId === currentUser.id) {
    return c.json({ error: 'You cannot delete your own account' }, 400)
  }

  const result = await c.env.DB.prepare(
    `DELETE FROM users WHERE id = ?`
  ).bind(targetId).run()

  if (result.meta.changes === 0) return c.json({ error: 'User not found' }, 404)

  return c.json({ ok: true, id: targetId })
})

// ─── Admin RSS Feeds BREAD ────────────────────────────────────────────────────

// GET /api/admin/feeds — list all feeds with per-feed stats
app.get('/api/admin/feeds', authMiddleware, async (c) => {
  const deny = requireAdmin(c)
  if (deny) return deny

  const rows = await c.env.DB.prepare(`
    SELECT
      f.id, f.url, f.name, f.is_active, f.last_fetched_at, f.created_at,
      COUNT(r.id)                                            AS item_count,
      SUM(CASE WHEN r.ai_processed_at IS NULL THEN 1 ELSE 0 END) AS ai_pending
    FROM rss_feeds f
    LEFT JOIN rss_items r ON r.feed_id = f.id
    GROUP BY f.id
    ORDER BY f.name ASC
  `).all()

  return c.json({ feeds: rows.results })
})

// POST /api/admin/feeds/test — validate a URL (no DB write)
app.post('/api/admin/feeds/test', authMiddleware, async (c) => {
  const deny = requireAdmin(c)
  if (deny) return deny

  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
  if (typeof body !== 'object' || body === null) return c.json({ error: 'Invalid body' }, 400)
  const { url } = body as Record<string, unknown>
  if (typeof url !== 'string' || !url.startsWith('http')) return c.json({ error: 'url must be an http/https string' }, 400)

  try {
    const items = await fetchFeed(url)
    if (items.length === 0) return c.json({ error: 'Feed parsed but contained no items' }, 422)

    // Extract channel title from the raw XML — fetchFeed only returns items, so re-fetch for the title
    const xmlRes = await fetch(url, { headers: { 'User-Agent': 'Lumin-RSS/1.0' } })
    const xml = await xmlRes.text()

    const channelTitleMatch = xml.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/is)
    const feedTitle = channelTitleMatch ? channelTitleMatch[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : ''

    const newest = items[0]
    return c.json({
      ok: true,
      feed_title: feedTitle,
      item_count: items.length,
      newest_item: { title: newest.title, published_at: newest.publishedAt },
    })
  } catch (err) {
    return c.json({ error: (err as Error).message ?? 'Failed to fetch feed' }, 422)
  }
})

// POST /api/admin/feeds — add a new feed
app.post('/api/admin/feeds', authMiddleware, async (c) => {
  const deny = requireAdmin(c)
  if (deny) return deny

  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
  if (typeof body !== 'object' || body === null) return c.json({ error: 'Invalid body' }, 400)

  const { url, name } = body as Record<string, unknown>
  if (typeof url !== 'string' || !url.startsWith('http')) return c.json({ error: 'url must be an http/https string' }, 400)
  if (typeof name !== 'string' || name.trim().length === 0) return c.json({ error: 'name is required' }, 400)

  try {
    const result = await c.env.DB.prepare(
      `INSERT INTO rss_feeds (url, name) VALUES (?, ?)`
    ).bind(url.trim(), name.trim()).run()
    return c.json({ ok: true, id: result.meta.last_row_id }, 201)
  } catch (err) {
    const msg = (err as Error).message ?? ''
    if (msg.includes('UNIQUE')) return c.json({ error: 'A feed with that URL already exists' }, 409)
    throw err
  }
})

// PATCH /api/admin/feeds/:id — update name and/or is_active
app.patch('/api/admin/feeds/:id', authMiddleware, async (c) => {
  const deny = requireAdmin(c)
  if (deny) return deny

  const feedId = parseInt(c.req.param('id') ?? '', 10)
  if (!Number.isInteger(feedId) || feedId < 1) return c.json({ error: 'Invalid feed id' }, 400)

  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
  if (typeof body !== 'object' || body === null) return c.json({ error: 'Invalid body' }, 400)

  const patch = body as Record<string, unknown>
  const setClauses: string[] = []
  const bindings: (string | number)[] = []

  if ('name' in patch) {
    if (typeof patch.name !== 'string' || patch.name.trim().length === 0) return c.json({ error: 'name must be a non-empty string' }, 400)
    setClauses.push('name = ?')
    bindings.push(patch.name.trim())
  }
  if ('is_active' in patch) {
    if (patch.is_active !== true && patch.is_active !== false) return c.json({ error: 'is_active must be true or false' }, 400)
    setClauses.push('is_active = ?')
    bindings.push(patch.is_active ? 1 : 0)
  }

  if (setClauses.length === 0) return c.json({ error: 'No valid fields to update' }, 400)

  bindings.push(feedId)
  const result = await c.env.DB.prepare(
    `UPDATE rss_feeds SET ${setClauses.join(', ')} WHERE id = ?`
  ).bind(...bindings).run()

  if (result.meta.changes === 0) return c.json({ error: 'Feed not found' }, 404)
  return c.json({ ok: true, id: feedId })
})

// DELETE /api/admin/feeds/:id — delete feed + cascade rss_items
app.delete('/api/admin/feeds/:id', authMiddleware, async (c) => {
  const deny = requireAdmin(c)
  if (deny) return deny

  const feedId = parseInt(c.req.param('id') ?? '', 10)
  if (!Number.isInteger(feedId) || feedId < 1) return c.json({ error: 'Invalid feed id' }, 400)

  const result = await c.env.DB.prepare(
    `DELETE FROM rss_feeds WHERE id = ?`
  ).bind(feedId).run()

  if (result.meta.changes === 0) return c.json({ error: 'Feed not found' }, 404)
  return c.json({ ok: true, id: feedId })
})

// POST /api/admin/feeds/:id/fetch — trigger a manual ingest for one feed
app.post('/api/admin/feeds/:id/fetch', authMiddleware, async (c) => {
  const deny = requireAdmin(c)
  if (deny) return deny

  const feedId = parseInt(c.req.param('id') ?? '', 10)
  if (!Number.isInteger(feedId) || feedId < 1) return c.json({ error: 'Invalid feed id' }, 400)

  const feedRow = await c.env.DB.prepare(
    `SELECT id, url, name FROM rss_feeds WHERE id = ?`
  ).bind(feedId).first() as { id: number; url: string; name: string } | null

  if (!feedRow) return c.json({ error: 'Feed not found' }, 404)

  const now = new Date()
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()

  try {
    const items = await fetchFeed(feedRow.url)
    let inserted = 0
    for (const item of items) {
      const keywords = extractKeywords(item.title)
      const tagList = buildTagList(item.categories, keywords)
      const res = await c.env.DB.prepare(`
        INSERT OR IGNORE INTO rss_items
          (feed_id, guid, url, title, summary, tag_list, published_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(feedRow.id, item.guid, item.url, item.title, item.summary, tagList, item.publishedAt, expiresAt).run()
      if (res.meta.changes > 0) inserted++
    }
    await c.env.DB.prepare(`UPDATE rss_feeds SET last_fetched_at = ? WHERE id = ?`).bind(now.toISOString(), feedRow.id).run()
    return c.json({ ok: true, fetched: items.length, inserted, last_fetched_at: now.toISOString() })
  } catch (err) {
    return c.json({ error: (err as Error).message ?? 'Fetch failed' }, 502)
  }
})

// ─── Admin API Tokens ─────────────────────────────────────────────────────────

// GET /api/admin/tokens — list all tokens across all users with owner handle
app.get('/api/admin/tokens', authMiddleware, async (c) => {
  const deny = requireAdmin(c)
  if (deny) return deny

  const rows = await c.env.DB.prepare(`
    SELECT t.id, t.name, t.scopes, t.last_used_at, t.expires_at, t.created_at,
           u.id AS user_id, u.slug_prefix
    FROM api_tokens t
    JOIN users u ON u.id = t.user_id
    ORDER BY t.created_at DESC
  `).all()

  return c.json({ tokens: rows.results })
})

// DELETE /api/admin/tokens/:id — admin force-revoke any user's token
app.delete('/api/admin/tokens/:id', authMiddleware, async (c) => {
  const deny = requireAdmin(c)
  if (deny) return deny

  const tokenId = parseInt(c.req.param('id') ?? '', 10)
  if (!Number.isInteger(tokenId) || tokenId < 1) return c.json({ error: 'Invalid token id' }, 400)

  const result = await c.env.DB.prepare(
    `DELETE FROM api_tokens WHERE id = ?`
  ).bind(tokenId).run()

  if (result.meta.changes === 0) return c.json({ error: 'Token not found' }, 404)
  return c.json({ ok: true, id: tokenId })
})

// ─── Front-end HTML (single SPA served for all UI routes) ────────────────────
const appHeader = renderHeader({ activePage: 'app', pageTitle: 'Dashboard', searchPlaceholder: 'Search… or “since april 2023”', navTopTitle: 'Clear filters', showAdd: true, dropdownItems: 'full', showMobileFooter: false })
const exploreNavSlot = `<div class="hidden sm:flex items-center rounded-full border border-g-border bg-[#F8F9FA] p-0.5 gap-0.5 flex-shrink-0"><button id="btn-mine" onclick="setMode('personal')" class="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full transition-colors">Mine</button><button id="btn-all" onclick="setMode('community')" class="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full transition-colors">All</button></div>`
const exploreHeader = renderHeader({ activePage: 'explore', pageTitle: 'Explore', searchPlaceholder: 'Filter tags', navTopTitle: 'Top tags', showAdd: false, dropdownItems: 'compact', showMobileFooter: true, navSlot: exploreNavSlot })
const newsHeader = renderHeader({ activePage: 'news', pageTitle: 'News', searchPlaceholder: 'Filter topics', navTopTitle: 'All topics', showAdd: false, dropdownItems: 'compact', showMobileFooter: true })
app.get('/', (c) => c.html((appHtml as string).replace('%%HEADER%%', appHeader)))
app.get('/add', (c) => c.html((appHtml as string).replace('%%HEADER%%', appHeader)))
app.get('/v/:dashboardTag', (c) => c.html(stationHtml as string))
app.get('/e', (c) => c.html((exploreHtml as string).replace('%%HEADER%%', exploreHeader)))
app.get('/e/:dashboardTag', (c) => c.html((exploreHtml as string).replace('%%HEADER%%', exploreHeader)))
app.get('/n', (c) => c.html((newsHtml as string).replace('%%HEADER%%', newsHeader)))
app.get('/n/:tag', (c) => c.html((newsHtml as string).replace('%%HEADER%%', newsHeader)))
app.get('/import/pinboard', (c) => c.html(importPinboardHtml as string))
app.get('/import/browser', (c) => c.html(importBrowserHtml as string))
app.get('/admin', (c) => c.html(adminHtml as string))
app.get('/analytics', (c) => c.html(analyticsHtml as string))

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
