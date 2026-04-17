// src/index.ts — Cloudflare Worker entry point (Hono)

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { User } from './db/types.ts'
import { authMiddleware } from './middleware/authMiddleware.ts'
import authRoutes from './routes/auth.ts'
import bookmarkRoutes from './routes/bookmarks.ts'
import { getBookmarkBySlug, recordClick } from './db/bookmarks.ts'
import { getUserBySlugPrefix } from './db/users.ts'
// @ts-expect-error — text module loaded by Wrangler rule
import appHtml from './client/app.html'

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

  const bookmark = await getBookmarkBySlug(c.env.DB, slug)
  if (!bookmark) return c.notFound()
  if (bookmark.user_id !== user.id) return c.notFound()
  if (!bookmark.is_public) return c.notFound()

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
app.get('/api/preview', authMiddleware, async (c) => {
  const url = c.req.query('url')
  return c.redirect(`/api/bookmarks/preview/fetch${url ? `?url=${encodeURIComponent(url)}` : ''}`)
})

// ─── Front-end HTML (single SPA served for all UI routes) ────────────────────
app.get('/', (c) => c.html(appHtml as string))
app.get('/add', (c) => c.html(appHtml as string))

// ─── 404 catch-all ────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Not Found' }, 404))

export default app

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
