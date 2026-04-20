// src/routes/bookmarks.ts — all authenticated bookmark API routes

import { Hono } from 'hono'
import type { Env, Variables } from '../index.ts'
import {
    listBookmarks,
    getBookmark,
    createBookmark,
    updateBookmark,
    deleteBookmark,
    isSlugAvailable,
    listTags,
} from '../db/bookmarks.ts'
import { fetchUrlPreview } from '../utils/preview.ts'
import type { Bookmark, UpdateBookmarkInput } from '../db/types.ts'

const bookmarks = new Hono<{ Bindings: Env; Variables: Variables }>()

// ─── GET /api/bookmarks ───────────────────────────────────────────────────────
// Query params: sort, order, tag, search, archived, page, per_page
bookmarks.get('/', async (c) => {
    const user = c.get('user')
    const q = c.req.query()

    const { bookmarks: rows, total } = await listBookmarks(c.env.DB, {
        user_id: user.id,
        sort: (q.sort as 'created_at' | 'title' | 'hit_count' | 'last_accessed') ?? 'created_at',
        order: q.order === 'ASC' ? 'ASC' : 'DESC',
        tag: q.tag,
        search: q.search,
        include_archived: q.archived === '1',
        unread: q.unread === '1',
        page: q.page ? parseInt(q.page, 10) : 1,
        per_page: q.per_page ? Math.min(parseInt(q.per_page, 10), 100) : 25,
    })

    const page = q.page ? parseInt(q.page, 10) : 1
    const per_page = q.per_page ? Math.min(parseInt(q.per_page, 10), 100) : 25

    return c.json({
        data: rows.map(parseBookmark),
        meta: {
            total,
            page,
            per_page,
            total_pages: Math.ceil(total / per_page),
        },
    })
})

// ─── POST /api/bookmarks ──────────────────────────────────────────────────────
bookmarks.post('/', async (c) => {
    const user = c.get('user')
    const body = await c.req.json<{
        url?: string
        slug?: string
        title?: string
        short_description?: string
        favicon_url?: string
        is_public?: boolean
        tag_list?: string[]
        expires_at?: string
    }>()

    if (!body.url) return c.json({ error: 'url is required' }, 400)
    if (!body.slug) return c.json({ error: 'slug is required' }, 400)

    if (!/^[a-z0-9_-]{1,64}$/.test(body.slug)) {
        return c.json({ error: 'slug must be 1-64 lowercase alphanumeric/dash/underscore characters' }, 400)
    }

    const available = await isSlugAvailable(c.env.DB, user.id, body.slug)
    if (!available) return c.json({ error: 'slug already taken' }, 409)

    // Validate URL
    try { new URL(body.url) } catch { return c.json({ error: 'invalid url' }, 400) }

    const bookmark = await createBookmark(c.env.DB, {
        user_id: user.id,
        url: body.url,
        slug: body.slug,
        title: body.title,
        short_description: body.short_description,
        favicon_url: body.favicon_url,
        is_public: body.is_public ?? true,
        tag_list: body.tag_list ?? [],
        expires_at: body.expires_at,
    })

    return c.json({ data: parseBookmark(bookmark) }, 201)
})

// ─── GET /api/bookmarks/check-url?url=:url ───────────────────────────────────
// Returns { exists: false } or { exists: true, bookmark: {...} }
bookmarks.get('/check-url', async (c) => {
    const user = c.get('user')
    const url = c.req.query('url')
    if (!url) return c.json({ error: 'url is required' }, 400)
    try { new URL(url) } catch { return c.json({ error: 'invalid url' }, 400) }

    const row = await c.env.DB
        .prepare('SELECT * FROM bookmarks WHERE user_id = ? AND url = ? LIMIT 1')
        .bind(user.id, url)
        .first()

    if (!row) return c.json({ exists: false })
    return c.json({ exists: true, bookmark: parseBookmark(row as Parameters<typeof parseBookmark>[0]) })
})

// ─── GET /api/bookmarks/export ────────────────────────────────────────────────
bookmarks.get('/export', async (c) => {
    const user = c.get('user')
    const { results } = await c.env.DB
        .prepare('SELECT * FROM bookmarks WHERE user_id = ? ORDER BY created_at ASC')
        .bind(user.id)
        .all<Bookmark>()

    const out = results.map(b => ({
        url: b.url,
        slug: b.slug,
        title: b.title ?? null,
        short_description: b.short_description ?? null,
        favicon_url: b.favicon_url ?? null,
        is_public: b.is_public === 1,
        is_archived: b.is_archived === 1,
        tag_list: (() => { try { return JSON.parse(b.tag_list) } catch { return [] } })(),
        expires_at: b.expires_at ?? null,
        created_at: b.created_at,
    }))

    const date = new Date().toISOString().split('T')[0]
    const payload = JSON.stringify({ version: 1, exported_at: new Date().toISOString(), count: out.length, bookmarks: out }, null, 2)
    return new Response(payload, {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="lumin-bookmarks-${date}.json"`,
        },
    })
})

// ─── POST /api/bookmarks/import ───────────────────────────────────────────────
// Accepts { bookmarks: [...] } — max 100 per call (client must batch).
// Returns { imported, skipped, errors[] }.
bookmarks.post('/import', async (c) => {
    const user = c.get('user')
    let body: { bookmarks?: unknown[] }
    try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON' }, 400) }
    if (!Array.isArray(body?.bookmarks)) return c.json({ error: 'bookmarks array required' }, 400)
    if (body.bookmarks.length > 100) return c.json({ error: 'max 100 bookmarks per call — batch on the client' }, 400)

    const { results: existing } = await c.env.DB
        .prepare('SELECT url, slug FROM bookmarks WHERE user_id = ?')
        .bind(user.id)
        .all<{ url: string; slug: string }>()

    const existingUrls = new Set(existing.map(r => r.url))
    const existingSlugs = new Set(existing.map(r => r.slug))

    const stmts: D1PreparedStatement[] = []
    let skipped = 0
    const errors: string[] = []

    for (const item of body.bookmarks) {
        if (typeof item !== 'object' || item === null) { errors.push('invalid item'); continue }
        const bm = item as Record<string, unknown>
        const url = typeof bm.url === 'string' ? bm.url.trim() : ''
        if (!url) { errors.push('missing url'); continue }
        try { new URL(url) } catch { errors.push(`invalid url: ${url.slice(0, 80)}`); continue }
        if (existingUrls.has(url)) { skipped++; continue }

        // Resolve slug: use provided if valid, otherwise derive from hostname
        let base = typeof bm.slug === 'string' && /^[a-z0-9_-]{1,64}$/.test(bm.slug) ? bm.slug : ''
        if (!base) {
            try { base = new URL(url).hostname.replace(/^www\./, '').replace(/[^a-z0-9]/g, '-').slice(0, 40) } catch { base = 'link' }
        }
        let slug = base, n = 2
        while (existingSlugs.has(slug)) slug = `${base.slice(0, 58)}-${n++}`

        stmts.push(
            c.env.DB
                .prepare(`INSERT INTO bookmarks (user_id, url, slug, title, short_description, favicon_url, is_public, is_archived, tag_list, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .bind(
                    user.id, url, slug,
                    typeof bm.title === 'string' ? bm.title : null,
                    typeof bm.short_description === 'string' ? bm.short_description : null,
                    typeof bm.favicon_url === 'string' ? bm.favicon_url : null,
                    bm.is_public ? 1 : 0,
                    bm.is_archived ? 1 : 0,
                    JSON.stringify(Array.isArray(bm.tag_list) ? bm.tag_list.filter(t => typeof t === 'string') : []),
                    typeof bm.expires_at === 'string' ? bm.expires_at : null,
                )
        )
        existingUrls.add(url)
        existingSlugs.add(slug)
    }

    let imported = 0
    if (stmts.length > 0) {
        try {
            await c.env.DB.batch(stmts)
            imported = stmts.length
        } catch (e) {
            errors.push(e instanceof Error ? e.message : String(e))
        }
    }

    return c.json({ imported, skipped, errors: errors.slice(0, 20) })
})

// ─── GET /api/bookmarks/:id ───────────────────────────────────────────────────
bookmarks.get('/:id', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id'), 10)
    if (isNaN(id)) return c.json({ error: 'invalid id' }, 400)

    const bookmark = await getBookmark(c.env.DB, id, user.id)
    if (!bookmark) return c.json({ error: 'Not Found' }, 404)

    return c.json({ data: parseBookmark(bookmark) })
})

// ─── PATCH /api/bookmarks/:id ─────────────────────────────────────────────────
bookmarks.patch('/:id', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id'), 10)
    if (isNaN(id)) return c.json({ error: 'invalid id' }, 400)

    const body = await c.req.json<UpdateBookmarkInput & { url?: string }>()

    // If slug is changing, validate and check availability
    if (body.slug !== undefined) {
        if (!/^[a-z0-9_-]{1,64}$/.test(body.slug)) {
            return c.json({ error: 'invalid slug format' }, 400)
        }
        const existing = await getBookmark(c.env.DB, id, user.id)
        if (!existing) return c.json({ error: 'Not Found' }, 404)
        if (body.slug !== existing.slug) {
            const available = await isSlugAvailable(c.env.DB, user.id, body.slug)
            if (!available) return c.json({ error: 'slug already taken' }, 409)
        }
    }

    if (body.url !== undefined) {
        try { new URL(body.url) } catch { return c.json({ error: 'invalid url' }, 400) }
    }

    const updated = await updateBookmark(c.env.DB, id, user.id, body)
    if (!updated) return c.json({ error: 'Not Found' }, 404)

    return c.json({ data: parseBookmark(updated) })
})

// ─── DELETE /api/bookmarks/:id ────────────────────────────────────────────────
bookmarks.delete('/:id', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id'), 10)
    if (isNaN(id)) return c.json({ error: 'invalid id' }, 400)

    const deleted = await deleteBookmark(c.env.DB, id, user.id)
    if (!deleted) return c.json({ error: 'Not Found' }, 404)

    return c.json({ message: 'deleted' })
})

// ─── GET /api/tags ────────────────────────────────────────────────────────────
bookmarks.get('/tags/all', async (c) => {
    const user = c.get('user')
    const tags = await listTags(c.env.DB, user.id)
    return c.json({ data: tags })
})

// ─── POST /api/bookmarks/tags/rename ─────────────────────────────────────────
// Body: { from: string, to: string }
// Replaces tag "from" with "to" across all bookmarks for the user.
// If "to" already exists on a bookmark it is deduplicated (merge).
bookmarks.post('/tags/rename', async (c) => {
    const user = c.get('user')
    const body = await c.req.json<{ from?: string; to?: string }>()
    const fromTag = (body.from ?? '').trim()
    const toTag = (body.to ?? '').trim()

    if (!fromTag) return c.json({ error: '"from" tag is required' }, 400)
    if (!toTag) return c.json({ error: '"to" tag is required' }, 400)
    if (fromTag === toTag) return c.json({ error: '"from" and "to" tags must differ' }, 400)

    // Fetch bookmarks containing the from-tag using parameterised LIKE
    const likePattern = `%"${fromTag}"%`
    const result = await c.env.DB
        .prepare(`SELECT id, tag_list FROM bookmarks WHERE user_id = ? AND tag_list LIKE ?`)
        .bind(user.id, likePattern)
        .all<{ id: number; tag_list: string }>()

    let updated = 0
    for (const row of result.results) {
        let tags: string[] = []
        try { tags = JSON.parse(row.tag_list) } catch { continue }
        if (!tags.includes(fromTag)) continue

        // Replace fromTag with toTag, deduplicating in case toTag already present
        const newTags = [...new Set(tags.map(t => t === fromTag ? toTag : t))]
        await c.env.DB
            .prepare(`UPDATE bookmarks SET tag_list = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ? AND user_id = ?`)
            .bind(JSON.stringify(newTags), row.id, user.id)
            .run()
        updated++
    }

    return c.json({ updated, from: fromTag, to: toTag })
})

// ─── GET /api/bookmarks/check-slug?q=:slug ───────────────────────────────────
bookmarks.get('/check-slug/availability', async (c) => {
    const user = c.get('user')
    const q = c.req.query('q')
    if (!q) return c.json({ error: 'q is required' }, 400)

    const available = await isSlugAvailable(c.env.DB, user.id, q)
    return c.json({ slug: q, available })
})

// ─── GET /api/preview?url=:url ────────────────────────────────────────────────
bookmarks.get('/preview/fetch', async (c) => {
    const url = c.req.query('url')
    if (!url) return c.json({ error: 'url is required' }, 400)

    try { new URL(url) } catch { return c.json({ error: 'invalid url' }, 400) }

    const preview = await fetchUrlPreview(url)
    return c.json({ data: preview })
})

// ─── Helper: parse SQLite integers → JS booleans and tag_list → array ─────────
function parseBookmark(b: Awaited<ReturnType<typeof getBookmark>>) {
    if (!b) return null
    return {
        ...b,
        is_public: b.is_public === 1,
        is_archived: b.is_archived === 1,
        tag_list: (() => { try { return JSON.parse(b.tag_list) } catch { return [] } })(),
    }
}

export default bookmarks
