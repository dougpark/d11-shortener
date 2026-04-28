// src/routes/v1.ts — Public API v1
//
// Route groups and their auth:
//   GET  /api/v1/posts           — apiTokenMiddleware  (read bookmarks)
//   GET  /api/v1/posts/updated   — apiTokenMiddleware  (last-change timestamp)
//   GET  /api/v1/tags            — apiTokenMiddleware  (tag list with counts)
//   POST /api/v1/rss/posts       — apiTokenMiddleware  (ingest scraped RSS items, rss:ingest scope)
//   GET  /api/v1/tokens          — authMiddleware      (list my API tokens)
//   POST /api/v1/tokens          — authMiddleware      (create API token)
//   DELETE /api/v1/tokens/:id    — authMiddleware      (revoke API token)
//
// Middleware is applied in index.ts so this file contains only handlers.

import { Hono } from 'hono'
import type { Env, Variables } from '../index.ts'
import type { Bookmark } from '../db/types.ts'
import { generateToken, hashToken } from '../utils/auth.ts'
import {
    createApiToken,
    listApiTokens,
    deleteApiToken,
} from '../db/api_tokens.ts'
import { extractKeywords, buildTagList } from '../utils/rss.ts'

const v1 = new Hono<{ Bindings: Env; Variables: Variables }>()

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Shape a raw DB bookmark row into a clean v1 response object. */
function formatPost(b: Bookmark) {
    let tags: string[] = []
    try { tags = JSON.parse(b.tag_list) } catch { /* leave empty */ }
    return {
        id: b.id,
        url: b.url,
        slug: b.slug,
        title: b.title ?? null,
        description: b.short_description ?? null,
        favicon_url: b.favicon_url ?? null,
        tags,
        public: b.is_public === 1,
        unread: b.hit_count === 0,
        archived: b.is_archived === 1,
        created_at: b.created_at,
        updated_at: b.updated_at,
        ai_tags: (() => { try { return b.ai_tags ? JSON.parse(b.ai_tags) : null } catch { return null } })(),
        ai_summary: b.ai_summary ?? null,
    }
}

// ─── GET /api/v1/posts ────────────────────────────────────────────────────────
// Query params:
//   tag      — filter by tag; repeat for AND semantics: ?tag=bun&tag=tools (max 3)
//   search   — LIKE match across title, url, description
//   since    — ISO 8601 UTC; only return bookmarks created_at > since
//   limit    — default 100, max 1000
//   offset   — default 0
//   unread   — "1" to return only unread (never-clicked) bookmarks
//   archived — "1" to include archived bookmarks (excluded by default)
v1.get('/posts', async (c) => {
    const user = c.get('user')
    const q = c.req.query()

    // Multi-tag: ?tag=bun&tag=tools  (Hono: queries() returns string[])
    const rawTags = c.req.queries('tag') ?? []
    const tags = rawTags.slice(0, 3).filter(t => t.trim().length > 0)

    const search = q.search?.trim() ?? ''
    const since = q.since?.trim() ?? ''
    const limit = Math.min(parseInt(q.limit ?? '100', 10) || 100, 1000)
    const offset = Math.max(parseInt(q.offset ?? '0', 10) || 0, 0)
    const unread = q.unread === '1'
    const archived = q.archived === '1'

    // Build query dynamically
    const conditions: string[] = ['user_id = ?']
    const bindings: (string | number)[] = [user.id]

    if (!archived) conditions.push('is_archived = 0')
    if (unread) conditions.push('hit_count = 0')

    // Each tag requires its own LIKE condition (JSON array contains check)
    for (const tag of tags) {
        conditions.push('tag_list LIKE ?')
        bindings.push(`%"${tag}"%`)
    }

    if (search) {
        conditions.push('(title LIKE ? OR url LIKE ? OR short_description LIKE ?)')
        const like = `%${search}%`
        bindings.push(like, like, like)
    }

    if (since) {
        conditions.push('created_at > ?')
        bindings.push(since)
    }

    const where = conditions.join(' AND ')

    const [rowsResult, countResult] = await Promise.all([
        c.env.DB
            .prepare(
                `SELECT * FROM bookmarks WHERE ${where}
                 ORDER BY created_at DESC
                 LIMIT ? OFFSET ?`,
            )
            .bind(...bindings, limit, offset)
            .all<Bookmark>(),
        c.env.DB
            .prepare(`SELECT COUNT(*) AS cnt FROM bookmarks WHERE ${where}`)
            .bind(...bindings)
            .first<{ cnt: number }>(),
    ])

    return c.json({
        data: rowsResult.results.map(formatPost),
        meta: {
            total: countResult?.cnt ?? 0,
            limit,
            offset,
        },
    })
})

// ─── GET /api/v1/posts/updated ────────────────────────────────────────────────
// Returns the timestamp of the most recently created or updated bookmark.
// Useful for polling: only call posts if this has changed since your last fetch.
v1.get('/posts/updated', async (c) => {
    const user = c.get('user')
    const row = await c.env.DB
        .prepare(
            `SELECT MAX(updated_at) AS updated_at
             FROM bookmarks
             WHERE user_id = ?`,
        )
        .bind(user.id)
        .first<{ updated_at: string | null }>()

    return c.json({ updated_at: row?.updated_at ?? null })
})

// ─── GET /api/v1/tags ─────────────────────────────────────────────────────────
// Returns all tags in use with their bookmark counts, ordered by count desc.
// Uses SQLite's json_each() to unpack the tag_list JSON array per row.
v1.get('/tags', async (c) => {
    const user = c.get('user')
    const { results } = await c.env.DB
        .prepare(
            `SELECT value AS tag, COUNT(*) AS count
             FROM bookmarks, json_each(tag_list)
             WHERE user_id = ? AND is_archived = 0
             GROUP BY value
             ORDER BY count DESC, value ASC`,
        )
        .bind(user.id)
        .all<{ tag: string; count: number }>()

    return c.json({ data: results })
})

// ─── GET /api/v1/tokens ───────────────────────────────────────────────────────
// Returns the caller's API tokens (safe fields only — no token_hash, no raw token).
v1.get('/tokens', async (c) => {
    const user = c.get('user')
    const tokens = await listApiTokens(c.env.DB, user.id)

    return c.json({
        data: tokens.map(t => ({
            id: t.id,
            name: t.name,
            scopes: (() => { try { return JSON.parse(t.scopes) } catch { return [] } })(),
            last_used_at: t.last_used_at,
            expires_at: t.expires_at,
            created_at: t.created_at,
        })),
    })
})

// ─── POST /api/v1/tokens ──────────────────────────────────────────────────────
// Creates a new named API token. The raw token is returned ONCE in the response
// and is never stored — if lost, the user must revoke and create a new one.
//
// Body: { name: string, scopes?: string[], expires_at?: string }
v1.post('/tokens', async (c) => {
    const user = c.get('user')

    let body: { name?: string; scopes?: string[]; expires_at?: string }
    try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON' }, 400) }

    const name = body.name?.trim()
    if (!name) return c.json({ error: 'name is required' }, 400)
    if (name.length > 100) return c.json({ error: 'name must be 100 characters or fewer' }, 400)

    const validScopes = new Set(['posts:read', 'posts:write', 'tags:read', 'tags:write', 'ai:process', 'ai:process:rss', 'ai:process:bookmarks', 'rss:ingest', '*'])
    const scopes: string[] = Array.isArray(body.scopes) && body.scopes.length > 0
        ? body.scopes.filter(s => validScopes.has(s))
        : ['posts:read', 'tags:read']

    if (scopes.length === 0) return c.json({ error: 'no valid scopes provided' }, 400)

    // Validate optional expiry
    if (body.expires_at !== undefined) {
        const d = new Date(body.expires_at)
        if (isNaN(d.getTime())) return c.json({ error: 'expires_at must be a valid ISO 8601 datetime' }, 400)
        if (d <= new Date()) return c.json({ error: 'expires_at must be in the future' }, 400)
    }

    // Enforce per-user token limit (admins are exempt)
    if (!user.is_admin) {
        const { count } = await c.env.DB.prepare(
            'SELECT COUNT(*) AS count FROM api_tokens WHERE user_id = ?'
        ).bind(user.id).first<{ count: number }>() ?? { count: 0 }
        if (count >= 10) return c.json({ error: 'Token limit reached — maximum 10 tokens per account. Revoke one before creating another.' }, 403)
    }

    const rawToken = generateToken()
    const tokenHash = await hashToken(rawToken)

    const created = await createApiToken(c.env.DB, {
        user_id: user.id,
        name,
        token_hash: tokenHash,
        scopes,
        expires_at: body.expires_at,
    })

    // Return the raw token ONCE — it will never be retrievable again
    return c.json({
        token: rawToken,
        id: created.id,
        name: created.name,
        scopes,
        expires_at: created.expires_at,
        created_at: created.created_at,
        notice: 'Save this token now — it will not be shown again.',
    }, 201)
})

// ─── POST /api/v1/tokens/:id/rotate ───────────────────────────────────────────
// Revokes an existing token and mints a new one with the same name, scopes, and
// expiry. The new raw token is returned once. Scoped to the authenticated user.
v1.post('/tokens/:id/rotate', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id'), 10)
    if (isNaN(id)) return c.json({ error: 'invalid token id' }, 400)

    // Load the existing token to copy its fields
    const existing = await c.env.DB.prepare(
        'SELECT * FROM api_tokens WHERE id = ? AND user_id = ?'
    ).bind(id, user.id).first<{ id: number; name: string; scopes: string; expires_at: string | null }>()

    if (!existing) return c.json({ error: 'token not found' }, 404)

    // Delete the old token
    await deleteApiToken(c.env.DB, id, user.id)

    // Create a replacement with the same fields
    let scopes: string[] = ['posts:read', 'tags:read']
    try { scopes = JSON.parse(existing.scopes) } catch { /* use default */ }

    const rawToken = generateToken()
    const tokenHash = await hashToken(rawToken)

    const created = await createApiToken(c.env.DB, {
        user_id: user.id,
        name: existing.name,
        token_hash: tokenHash,
        scopes,
        expires_at: existing.expires_at ?? undefined,
    })

    return c.json({
        token: rawToken,
        id: created.id,
        name: created.name,
        scopes,
        expires_at: created.expires_at,
        created_at: created.created_at,
        notice: 'Save this token now — it will not be shown again.',
    }, 201)
})

// ─── DELETE /api/v1/tokens/:id ────────────────────────────────────────────────
// Revokes an API token. Scoped to the authenticated user.
v1.delete('/tokens/:id', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id'), 10)
    if (isNaN(id)) return c.json({ error: 'invalid token id' }, 400)

    const deleted = await deleteApiToken(c.env.DB, id, user.id)
    if (!deleted) return c.json({ error: 'token not found' }, 404)

    return c.json({ deleted: true })
})

// ─── POST /api/v1/rss/posts ───────────────────────────────────────────────────
// Ingest a batch of scraped RSS/web items from an external client (e.g. Gopher).
//
// Body: {
//   source:     string   — URL of the scrape source (e.g. "https://pinboard.in/popular")
//   scraped_at: string   — ISO 8601 UTC timestamp of the scrape run
//   items: [
//     {
//       url:          string   — required
//       title:        string   — required
//       summary:      string?  — optional plain-text description (maps to rss_items.summary)
//       published_at: string?  — optional ISO 8601 pubDate (maps to rss_items.published_at)
//       guid:         string?  — optional dedup key; falls back to url
//     }
//   ]
// }
//
// Max 50 items per call. Duplicates (by guid/url) are silently ignored.
// Requires a token with the rss:ingest scope.
v1.post('/rss/posts', async (c) => {
    const apiToken = c.get('apiToken')
    if (!apiToken) return c.json({ error: 'Forbidden', hint: 'Named API token with rss:ingest scope required' }, 403)

    // Scope check
    let tokenScopes: string[] = []
    try { tokenScopes = JSON.parse(apiToken.scopes) } catch { /* leave empty */ }
    if (!tokenScopes.includes('rss:ingest') && !tokenScopes.includes('*')) {
        return c.json({ error: 'Forbidden', hint: 'Token missing rss:ingest scope' }, 403)
    }

    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
    if (typeof body !== 'object' || body === null) return c.json({ error: 'Body must be an object' }, 400)

    const { source, scraped_at, items } = body as Record<string, unknown>

    if (typeof source !== 'string' || !source.trim()) return c.json({ error: 'source is required' }, 400)
    try { new URL(source) } catch { return c.json({ error: 'source must be a valid URL' }, 400) }

    if (typeof scraped_at !== 'string') return c.json({ error: 'scraped_at is required' }, 400)
    const scrapedDate = new Date(scraped_at)
    if (isNaN(scrapedDate.getTime())) return c.json({ error: 'scraped_at must be a valid ISO 8601 datetime' }, 400)

    if (!Array.isArray(items) || items.length === 0) return c.json({ error: 'items must be a non-empty array' }, 400)
    if (items.length > 50) return c.json({ error: 'Batch too large — max 50 items' }, 400)

    // Validate each item — invalid items are skipped (not fatal), valid ones proceed
    type InboundItem = { url: string; title: string; summary: string | null; published_at: string | null; guid: string }
    const validItems: InboundItem[] = []
    const invalidItems: { index: number; reason: string }[] = []

    for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (typeof item !== 'object' || item === null) { invalidItems.push({ index: i, reason: 'not an object' }); continue }
        const { url, title, summary, published_at, guid } = item as Record<string, unknown>

        if (typeof url !== 'string' || !url.trim()) { invalidItems.push({ index: i, reason: 'url is required' }); continue }
        try { new URL(url) } catch { invalidItems.push({ index: i, reason: `invalid url: ${url}` }); continue }
        if (typeof title !== 'string' || !title.trim()) { invalidItems.push({ index: i, reason: 'title is required' }); continue }

        const pub = published_at !== undefined && published_at !== null && typeof published_at === 'string'
            ? published_at.trim() : null
        if (pub && isNaN(new Date(pub).getTime())) { invalidItems.push({ index: i, reason: 'published_at is not a valid date' }); continue }

        validItems.push({
            url: url.trim(),
            title: title.trim(),
            summary: (typeof summary === 'string' ? summary.trim() : null) || null,
            published_at: pub || null,
            guid: (typeof guid === 'string' && guid.trim()) ? guid.trim() : url.trim(),
        })
    }

    if (validItems.length === 0) return c.json({ error: 'No valid items in batch', invalid: invalidItems }, 400)

    // Auto-upsert rss_feeds row for this source URL
    await c.env.DB.prepare(
        `INSERT OR IGNORE INTO rss_feeds (url, name) VALUES (?, ?)`
    ).bind(source, source).run()

    const feedRow = await c.env.DB.prepare(
        `SELECT id FROM rss_feeds WHERE url = ? LIMIT 1`
    ).bind(source).first<{ id: number }>()

    if (!feedRow) return c.json({ error: 'Failed to resolve feed record' }, 500)

    // expires_at = scraped_at + 30 days
    const expiresAt = new Date(scrapedDate.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()

    // Build and run batch inserts — guid is the dedup key
    const stmts = validItems.map(item => {
        const keywords = extractKeywords(item.title)
        const tagList = buildTagList([], keywords)
        return c.env.DB.prepare(
            `INSERT OR IGNORE INTO rss_items
               (feed_id, guid, url, title, summary, tag_list, published_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(feedRow.id, item.guid, item.url, item.title, item.summary, tagList, item.published_at, expiresAt)
    })

    const results = await c.env.DB.batch(stmts)
    const inserted = results.reduce((sum, r) => sum + (r.meta.changes ?? 0), 0)

    return c.json({
        ok: true,
        source,
        scraped_at,
        received: items.length,
        inserted,
        skipped: validItems.length - inserted,
        invalid: invalidItems.length > 0 ? invalidItems : undefined,
    })
})

export default v1
