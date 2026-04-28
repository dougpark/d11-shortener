// src/routes/v1.ts — Public API v1
//
// Route groups and their auth:
//   GET    /api/v1/posts           — apiTokenMiddleware  (posts:read)
//   GET    /api/v1/posts/updated   — apiTokenMiddleware  (posts:read)
//   GET    /api/v1/posts/:id       — apiTokenMiddleware  (posts:read)
//   POST   /api/v1/posts           — apiTokenMiddleware  (posts:write, single bookmark)
//   POST   /api/v1/posts/batch     — apiTokenMiddleware  (posts:write, up to 50 bookmarks)
//   PATCH  /api/v1/posts/:id       — apiTokenMiddleware  (posts:write)
//   DELETE /api/v1/posts/:id       — apiTokenMiddleware  (posts:write)
//   GET    /api/v1/tags            — apiTokenMiddleware  (tags:read)
//   POST   /api/v1/rss/posts       — apiTokenMiddleware  (rss:ingest)
//   GET    /api/v1/tokens          — authMiddleware      (list my API tokens)
//   POST   /api/v1/tokens          — authMiddleware      (create API token)
//   DELETE /api/v1/tokens/:id      — authMiddleware      (revoke API token)
//
// Middleware is applied in index.ts so this file contains only handlers.

import { Hono } from 'hono'
import type { Env, Variables } from '../index.ts'
import type { Bookmark, ApiToken, UpdateBookmarkInput } from '../db/types.ts'
import { generateToken, hashToken } from '../utils/auth.ts'
import {
    createApiToken,
    listApiTokens,
    deleteApiToken,
} from '../db/api_tokens.ts'
import { extractKeywords, buildTagList } from '../utils/rss.ts'
import {
    getBookmark,
    createBookmark,
    updateBookmark,
    deleteBookmark,
    isSlugAvailable,
} from '../db/bookmarks.ts'

const v1 = new Hono<{ Bindings: Env; Variables: Variables }>()

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Check whether an API token's scopes include the required scope (or wildcard). */
function hasScope(token: ApiToken | undefined, scope: string): boolean {
    if (!token) return false
    let scopes: string[] = []
    try { scopes = JSON.parse(token.scopes) } catch { return false }
    return scopes.includes('*') || scopes.includes(scope)
}

/** Generate a short random slug (6 chars). */
function randomSlug(): string {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 6)
}
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
// Requires posts:read scope.
// Query params:
//   url      — exact URL match (returns first hit or 404)
//   tag      — filter by tag; repeat for AND semantics: ?tag=bun&tag=tools (max 3)
//   search   — LIKE match across title, url, description
//   since    — ISO 8601 UTC; only return bookmarks created_at > since
//   limit    — default 100, max 1000
//   offset   — default 0
//   unread   — "1" to return only unread (never-clicked) bookmarks
//   archived — "1" to include archived bookmarks (excluded by default)
v1.get('/posts', async (c) => {
    const apiToken = c.get('apiToken')
    if (!hasScope(apiToken, 'posts:read')) return c.json({ error: 'Forbidden', hint: 'Token missing posts:read scope' }, 403)
    const user = c.get('user')
    const q = c.req.query()

    // Exact URL lookup shortcut
    if (q.url) {
        let urlVal: string
        try { urlVal = new URL(q.url).toString() } catch { return c.json({ error: 'invalid url' }, 400) }
        const row = await c.env.DB
            .prepare('SELECT * FROM bookmarks WHERE user_id = ? AND url = ? LIMIT 1')
            .bind(user.id, urlVal)
            .first<Bookmark>()
        if (!row) return c.json({ error: 'not found' }, 404)
        return c.json({ data: formatPost(row) })
    }

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
// Requires posts:read scope.
v1.get('/posts/updated', async (c) => {
    const apiToken = c.get('apiToken')
    if (!hasScope(apiToken, 'posts:read')) return c.json({ error: 'Forbidden', hint: 'Token missing posts:read scope' }, 403)
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
// Requires tags:read scope.
v1.get('/tags', async (c) => {
    const apiToken = c.get('apiToken')
    if (!hasScope(apiToken, 'tags:read')) return c.json({ error: 'Forbidden', hint: 'Token missing tags:read scope' }, 403)
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

// ─── GET /api/v1/posts/:id ────────────────────────────────────────────────────
// Fetch a single bookmark by ID. Requires posts:read scope.
v1.get('/posts/:id', async (c) => {
    const apiToken = c.get('apiToken')
    if (!hasScope(apiToken, 'posts:read')) return c.json({ error: 'Forbidden', hint: 'Token missing posts:read scope' }, 403)
    const user = c.get('user')
    const id = parseInt(c.req.param('id'), 10)
    if (isNaN(id)) return c.json({ error: 'invalid id' }, 400)

    const row = await getBookmark(c.env.DB, id, user.id)
    if (!row) return c.json({ error: 'not found' }, 404)
    return c.json({ data: formatPost(row) })
})

// ─── POST /api/v1/posts ───────────────────────────────────────────────────────
// Create a single bookmark. Requires posts:write scope.
// slug is auto-generated if omitted (5 retries before giving up).
// Returns 409 if the URL already exists for this user.
v1.post('/posts', async (c) => {
    const apiToken = c.get('apiToken')
    if (!hasScope(apiToken, 'posts:write')) return c.json({ error: 'Forbidden', hint: 'Token missing posts:write scope' }, 403)
    const user = c.get('user')

    let body: Record<string, unknown>
    try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }

    const url = typeof body.url === 'string' ? body.url.trim() : ''
    if (!url) return c.json({ error: 'url is required' }, 400)
    try { new URL(url) } catch { return c.json({ error: 'invalid url' }, 400) }

    // Duplicate URL check
    const existing = await c.env.DB
        .prepare('SELECT id FROM bookmarks WHERE user_id = ? AND url = ? LIMIT 1')
        .bind(user.id, url)
        .first<{ id: number }>()
    if (existing) return c.json({ error: 'url already exists', id: existing.id }, 409)

    // Resolve slug: use provided if valid, otherwise auto-generate (up to 5 attempts)
    let slug: string
    if (typeof body.slug === 'string' && /^[a-z0-9_-]{1,64}$/.test(body.slug.trim())) {
        slug = body.slug.trim()
        if (!(await isSlugAvailable(c.env.DB, user.id, slug)))
            return c.json({ error: 'slug already taken' }, 409)
    } else {
        slug = ''
        for (let attempt = 0; attempt < 5; attempt++) {
            const candidate = randomSlug()
            if (await isSlugAvailable(c.env.DB, user.id, candidate)) { slug = candidate; break }
        }
        if (!slug) return c.json({ error: 'Could not generate a unique slug — try again' }, 500)
    }

    const tag_list = Array.isArray(body.tag_list)
        ? (body.tag_list as unknown[]).filter(t => typeof t === 'string') as string[]
        : []

    const bookmark = await createBookmark(c.env.DB, {
        user_id: user.id,
        url,
        slug,
        title: typeof body.title === 'string' ? body.title.trim() || undefined : undefined,
        short_description: typeof body.short_description === 'string' ? body.short_description.trim() || undefined : undefined,
        favicon_url: typeof body.favicon_url === 'string' ? body.favicon_url.trim() || undefined : undefined,
        is_public: typeof body.is_public === 'boolean' ? body.is_public : false,
        tag_list,
        expires_at: typeof body.expires_at === 'string' ? body.expires_at : undefined,
        ai_summary: typeof body.ai_summary === 'string' ? body.ai_summary : undefined,
        ai_tags: Array.isArray(body.ai_tags) ? body.ai_tags.filter(t => typeof t === 'string') as string[] : undefined,
    })

    return c.json({ data: formatPost(bookmark) }, 201)
})

// ─── POST /api/v1/posts/batch ─────────────────────────────────────────────────
// Bulk create up to 50 bookmarks. Requires posts:write scope.
// Invalid items are skipped (not fatal). Duplicate URLs are skipped silently.
// Returns { inserted, skipped_duplicates, invalid[] }.
v1.post('/posts/batch', async (c) => {
    const apiToken = c.get('apiToken')
    if (!hasScope(apiToken, 'posts:write')) return c.json({ error: 'Forbidden', hint: 'Token missing posts:write scope' }, 403)
    const user = c.get('user')

    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
    if (typeof body !== 'object' || body === null) return c.json({ error: 'Body must be an object' }, 400)
    const { items } = body as Record<string, unknown>
    if (!Array.isArray(items) || items.length === 0) return c.json({ error: 'items must be a non-empty array' }, 400)
    if (items.length > 50) return c.json({ error: 'Batch too large — max 50 items' }, 400)

    // Load existing URLs + slugs for this user (dedup + slug collision avoidance)
    const { results: existing } = await c.env.DB
        .prepare('SELECT url, slug FROM bookmarks WHERE user_id = ?')
        .bind(user.id)
        .all<{ url: string; slug: string }>()
    const existingUrls = new Set(existing.map(r => r.url))
    const existingSlugs = new Set(existing.map(r => r.slug))

    type ValidItem = { url: string; slug: string; title: string | null; short_description: string | null; favicon_url: string | null; is_public: number; tag_list: string; expires_at: string | null; ai_summary: string | null; ai_tags: string | null }
    const validItems: ValidItem[] = []
    const invalid: { index: number; reason: string }[] = []
    let skipped_duplicates = 0

    for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (typeof item !== 'object' || item === null) { invalid.push({ index: i, reason: 'not an object' }); continue }
        const b = item as Record<string, unknown>

        const url = typeof b.url === 'string' ? b.url.trim() : ''
        if (!url) { invalid.push({ index: i, reason: 'url is required' }); continue }
        try { new URL(url) } catch { invalid.push({ index: i, reason: `invalid url: ${url.slice(0, 80)}` }); continue }

        if (existingUrls.has(url)) { skipped_duplicates++; continue }

        // Resolve slug
        let slug = typeof b.slug === 'string' && /^[a-z0-9_-]{1,64}$/.test(b.slug.trim()) ? b.slug.trim() : ''
        if (!slug || existingSlugs.has(slug)) {
            slug = ''
            for (let attempt = 0; attempt < 5; attempt++) {
                const candidate = randomSlug()
                if (!existingSlugs.has(candidate)) { slug = candidate; break }
            }
            if (!slug) { invalid.push({ index: i, reason: 'could not generate unique slug' }); continue }
        }

        const tag_list = Array.isArray(b.tag_list)
            ? JSON.stringify((b.tag_list as unknown[]).filter(t => typeof t === 'string'))
            : '[]'

        validItems.push({
            url,
            slug,
            title: typeof b.title === 'string' ? b.title.trim() || null : null,
            short_description: typeof b.short_description === 'string' ? b.short_description.trim() || null : null,
            favicon_url: typeof b.favicon_url === 'string' ? b.favicon_url.trim() || null : null,
            is_public: b.is_public === true ? 1 : 0,
            tag_list,
            expires_at: typeof b.expires_at === 'string' ? b.expires_at : null,
            ai_summary: typeof b.ai_summary === 'string' ? b.ai_summary : null,
            ai_tags: Array.isArray(b.ai_tags) ? JSON.stringify(b.ai_tags.filter(t => typeof t === 'string')) : null,
        })
        existingUrls.add(url)
        existingSlugs.add(slug)
    }

    if (validItems.length === 0) return c.json({ error: 'No valid items in batch', invalid }, 400)

    const now = new Date().toISOString()
    const stmts = validItems.map(item =>
        c.env.DB.prepare(
            `INSERT INTO bookmarks (user_id, url, slug, title, short_description, favicon_url, is_public, tag_list, expires_at, ai_summary, ai_tags, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(user.id, item.url, item.slug, item.title, item.short_description, item.favicon_url, item.is_public, item.tag_list, item.expires_at, item.ai_summary, item.ai_tags, now, now)
    )

    await c.env.DB.batch(stmts)

    return c.json({
        inserted: validItems.length,
        skipped_duplicates,
        invalid: invalid.length > 0 ? invalid : undefined,
    }, 201)
})

// ─── PATCH /api/v1/posts/:id ──────────────────────────────────────────────────
// Update any subset of fields on a bookmark. Requires posts:write scope.
v1.patch('/posts/:id', async (c) => {
    const apiToken = c.get('apiToken')
    if (!hasScope(apiToken, 'posts:write')) return c.json({ error: 'Forbidden', hint: 'Token missing posts:write scope' }, 403)
    const user = c.get('user')
    const id = parseInt(c.req.param('id'), 10)
    if (isNaN(id)) return c.json({ error: 'invalid id' }, 400)

    const row = await getBookmark(c.env.DB, id, user.id)
    if (!row) return c.json({ error: 'not found' }, 404)

    let body: Record<string, unknown>
    try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }

    // Validate optional fields before writing
    if ('url' in body) {
        if (typeof body.url !== 'string') return c.json({ error: 'url must be a string' }, 400)
        try { new URL(body.url) } catch { return c.json({ error: 'invalid url' }, 400) }
    }
    if ('slug' in body && (typeof body.slug !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(body.slug)))
        return c.json({ error: 'slug must be 1-64 lowercase alphanumeric/dash/underscore characters' }, 400)
    if ('slug' in body && typeof body.slug === 'string' && body.slug !== row.slug) {
        if (!(await isSlugAvailable(c.env.DB, user.id, body.slug)))
            return c.json({ error: 'slug already taken' }, 409)
    }

    const patch: UpdateBookmarkInput = {}
    if ('url' in body) patch.url = body.url as string
    if ('slug' in body) patch.slug = body.slug as string
    if ('title' in body) patch.title = typeof body.title === 'string' ? body.title : ''
    if ('short_description' in body) patch.short_description = typeof body.short_description === 'string' ? body.short_description : ''
    if ('favicon_url' in body) patch.favicon_url = typeof body.favicon_url === 'string' ? body.favicon_url : ''
    if ('is_public' in body) patch.is_public = Boolean(body.is_public)
    if ('is_archived' in body) patch.is_archived = Boolean(body.is_archived)
    if ('tag_list' in body && Array.isArray(body.tag_list))
        patch.tag_list = (body.tag_list as unknown[]).filter(t => typeof t === 'string') as string[]
    if ('expires_at' in body) patch.expires_at = typeof body.expires_at === 'string' ? body.expires_at : null
    if ('ai_summary' in body) patch.ai_summary = typeof body.ai_summary === 'string' ? body.ai_summary : null
    if ('ai_tags' in body && Array.isArray(body.ai_tags))
        patch.ai_tags = (body.ai_tags as unknown[]).filter(t => typeof t === 'string') as string[]

    if (Object.keys(patch).length === 0) return c.json({ error: 'No patchable fields provided' }, 400)

    const updated = await updateBookmark(c.env.DB, id, user.id, patch)
    if (!updated) return c.json({ error: 'not found' }, 404)
    return c.json({ data: formatPost(updated) })
})

// ─── DELETE /api/v1/posts/:id ─────────────────────────────────────────────────
// Hard-delete a bookmark. Requires posts:write scope.
v1.delete('/posts/:id', async (c) => {
    const apiToken = c.get('apiToken')
    if (!hasScope(apiToken, 'posts:write')) return c.json({ error: 'Forbidden', hint: 'Token missing posts:write scope' }, 403)
    const user = c.get('user')
    const id = parseInt(c.req.param('id'), 10)
    if (isNaN(id)) return c.json({ error: 'invalid id' }, 400)

    const deleted = await deleteBookmark(c.env.DB, id, user.id)
    if (!deleted) return c.json({ error: 'not found' }, 404)
    return c.json({ deleted: true, id })
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
