// src/db/bookmarks.ts — D1 helper functions for the bookmarks table

import type { Bookmark, CreateBookmarkInput, UpdateBookmarkInput, ListBookmarksOptions } from './types.ts'

// ─── Read ─────────────────────────────────────────────────────────────────────

/** Paginated list of bookmarks for a user with optional sort/filter. */
export async function listBookmarks(
    db: D1Database,
    opts: ListBookmarksOptions,
): Promise<{ bookmarks: Bookmark[]; total: number }> {
    const {
        user_id,
        sort = 'created_at',
        order = 'DESC',
        tag,
        search,
        include_archived = false,
        page = 1,
        per_page = 25,
    } = opts

    // Allowlist sort columns to prevent injection
    const safeSort = (['created_at', 'title', 'hit_count', 'last_accessed'] as const).includes(sort)
        ? sort
        : 'created_at'
    const safeOrder = order === 'ASC' ? 'ASC' : 'DESC'

    const conditions: string[] = ['user_id = ?']
    const bindings: (string | number)[] = [user_id]

    if (!include_archived) {
        conditions.push('is_archived = 0')
    }

    if (tag) {
        // JSON array contains the tag value (simple LIKE match)
        conditions.push(`tag_list LIKE ?`)
        bindings.push(`%"${tag}"%`)
    }

    if (search) {
        conditions.push(`(title LIKE ? OR url LIKE ? OR short_description LIKE ?)`)
        const like = `%${search}%`
        bindings.push(like, like, like)
    }

    const where = conditions.join(' AND ')
    const offset = (page - 1) * per_page

    const [rowsResult, countResult] = await Promise.all([
        db
            .prepare(
                `SELECT * FROM bookmarks WHERE ${where}
         ORDER BY ${safeSort} ${safeOrder}
         LIMIT ? OFFSET ?`,
            )
            .bind(...bindings, per_page, offset)
            .all<Bookmark>(),
        db
            .prepare(`SELECT COUNT(*) AS cnt FROM bookmarks WHERE ${where}`)
            .bind(...bindings)
            .first<{ cnt: number }>(),
    ])

    return {
        bookmarks: rowsResult.results,
        total: countResult?.cnt ?? 0,
    }
}

/** Get a single bookmark by id, scoped to a user. */
export async function getBookmark(
    db: D1Database,
    id: number,
    userId: number,
): Promise<Bookmark | null> {
    const result = await db
        .prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ? LIMIT 1')
        .bind(id, userId)
        .first<Bookmark>()
    return result ?? null
}

/** Resolve a short link slug to its bookmark (public or owned by userId). */
export async function getBookmarkBySlug(
    db: D1Database,
    slug: string,
    requestingUserId?: number,
): Promise<Bookmark | null> {
    // Return public bookmarks to anyone, or any bookmark to its owner
    const result = await db
        .prepare(
            `SELECT * FROM bookmarks
       WHERE slug = ?
         AND (is_public = 1 OR user_id = ?)
         AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
       LIMIT 1`,
        )
        .bind(slug, requestingUserId ?? -1)
        .first<Bookmark>()
    return result ?? null
}

/** Check whether a slug is already taken for a given user. */
export async function isSlugAvailable(
    db: D1Database,
    userId: number,
    slug: string,
): Promise<boolean> {
    const row = await db
        .prepare('SELECT id FROM bookmarks WHERE user_id = ? AND slug = ? LIMIT 1')
        .bind(userId, slug)
        .first<{ id: number }>()
    return row === null
}

/** Return the distinct set of tags used by a user. */
export async function listTags(db: D1Database, userId: number): Promise<string[]> {
    const rows = await db
        .prepare('SELECT tag_list FROM bookmarks WHERE user_id = ? AND tag_list != ?')
        .bind(userId, '[]')
        .all<{ tag_list: string }>()

    const tagSet = new Set<string>()
    for (const row of rows.results) {
        try {
            const tags: string[] = JSON.parse(row.tag_list)
            tags.forEach((t) => tagSet.add(t))
        } catch {
            // malformed JSON — skip
        }
    }
    return Array.from(tagSet).sort()
}

// ─── Write ────────────────────────────────────────────────────────────────────

/** Insert a new bookmark. Returns the created row. */
export async function createBookmark(
    db: D1Database,
    input: CreateBookmarkInput,
): Promise<Bookmark> {
    const {
        user_id,
        url,
        slug,
        title = null,
        short_description = null,
        favicon_url = null,
        is_public = false,
        tag_list = [],
        expires_at = null,
    } = input

    const result = await db
        .prepare(
            `INSERT INTO bookmarks
         (user_id, url, slug, title, short_description, favicon_url,
          is_public, tag_list, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
        )
        .bind(
            user_id,
            url,
            slug,
            title,
            short_description,
            favicon_url,
            is_public ? 1 : 0,
            JSON.stringify(tag_list),
            expires_at,
        )
        .first<Bookmark>()

    if (!result) throw new Error('Failed to create bookmark')
    return result
}

/** Partially update a bookmark. Returns the updated row. */
export async function updateBookmark(
    db: D1Database,
    id: number,
    userId: number,
    input: UpdateBookmarkInput,
): Promise<Bookmark | null> {
    const map: Record<string, unknown> = {}

    if (input.url !== undefined) map.url = input.url
    if (input.slug !== undefined) map.slug = input.slug
    if (input.title !== undefined) map.title = input.title
    if (input.short_description !== undefined) map.short_description = input.short_description
    if (input.favicon_url !== undefined) map.favicon_url = input.favicon_url
    if (input.is_public !== undefined) map.is_public = input.is_public ? 1 : 0
    if (input.is_archived !== undefined) map.is_archived = input.is_archived ? 1 : 0
    if (input.tag_list !== undefined) map.tag_list = JSON.stringify(input.tag_list)
    if ('expires_at' in input) map.expires_at = input.expires_at ?? null

    const fields = Object.keys(map)
    if (fields.length === 0) return getBookmark(db, id, userId)

    const setClauses = fields.map((f) => `${f} = ?`).join(', ')
    const values = fields.map((f) => map[f] as string | number | null)

    const result = await db
        .prepare(
            `UPDATE bookmarks
       SET ${setClauses}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ? AND user_id = ?
       RETURNING *`,
        )
        .bind(...values, id, userId)
        .first<Bookmark>()

    return result ?? null
}

/** Delete a bookmark. Returns true if a row was deleted. */
export async function deleteBookmark(
    db: D1Database,
    id: number,
    userId: number,
): Promise<boolean> {
    const result = await db
        .prepare('DELETE FROM bookmarks WHERE id = ? AND user_id = ?')
        .bind(id, userId)
        .run()
    return (result.meta.changes ?? 0) > 0
}

// ─── Analytics ────────────────────────────────────────────────────────────────

/** Increment hit_count, update last_accessed, and log a click event. */
export async function recordClick(
    db: D1Database,
    bookmarkId: number,
    referrer: string | null,
    userAgent: string | null,
): Promise<void> {
    await db.batch([
        db
            .prepare(
                `UPDATE bookmarks
         SET hit_count = hit_count + 1,
             last_accessed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE id = ?`,
            )
            .bind(bookmarkId),
        db
            .prepare(
                `INSERT INTO click_events (bookmark_id, referrer, user_agent)
         VALUES (?, ?, ?)`,
            )
            .bind(bookmarkId, referrer, userAgent),
    ])
}
