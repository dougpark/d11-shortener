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
import type { UpdateBookmarkInput } from '../db/types.ts'

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
