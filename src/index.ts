// src/index.ts — Cloudflare Worker entry point (Hono)

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { User } from './db/types.ts'
import { authMiddleware } from './middleware/authMiddleware.ts'
import authRoutes from './routes/auth.ts'
import bookmarkRoutes from './routes/bookmarks.ts'
import { getBookmarkBySlug, recordClick } from './db/bookmarks.ts'
import { getUserBySlugPrefix, getUserByTokenHash } from './db/users.ts'
import { hashToken } from './utils/auth.ts'
import { getCookie } from 'hono/cookie'
// @ts-expect-error — text module loaded by Wrangler rule
import appHtml from './client/app.html'
// @ts-expect-error — text module loaded by Wrangler rule
import stationHtml from './client/station.html'
// @ts-expect-error — text module loaded by Wrangler rule
import importPinboardHtml from './client/import-pinboard.html'

// ─── Environment bindings (declared in wrangler.toml) ─────────────────────────
export type Env = {
  DB: D1Database
  TOKEN_SECRET: string
  ENVIRONMENT: string
}

// ─── Context variables set by middleware ──────────────────────────────────────
export type Variables = {
  user: User
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

  // Optional auth via cookie
  let userId: number | undefined
  const rawToken = getCookie(c, 'd11_auth')
  if (rawToken) {
    const tokenHash = await hashToken(decodeURIComponent(rawToken))
    const user = await getUserByTokenHash(c.env.DB, tokenHash)
    userId = user?.id
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

  return c.json({ dashboardTag: rawTag, groups, authenticated: !!userId })
})

// ─── Front-end HTML (single SPA served for all UI routes) ────────────────────
app.get('/', (c) => c.html(appHtml as string))
app.get('/add', (c) => c.html(appHtml as string))
app.get('/v/:dashboardTag', (c) => c.html(stationHtml as string))
app.get('/import/pinboard', (c) => c.html(importPinboardHtml as string))

// ─── 404 catch-all ────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Not Found' }, 404))

export default app

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
