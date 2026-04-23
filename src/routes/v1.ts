// src/routes/v1.ts — Public API v1
//
// Route groups and their auth:
//   GET  /api/v1/posts           — apiTokenMiddleware  (read bookmarks)
//   GET  /api/v1/posts/updated   — apiTokenMiddleware  (last-change timestamp)
//   GET  /api/v1/tags            — apiTokenMiddleware  (tag list with counts)
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

    const validScopes = new Set(['posts:read', 'posts:write', 'tags:read', 'tags:write', 'ai:process', '*'])
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

export default v1
