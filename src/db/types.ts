// src/db/types.ts — shared row types mirroring the D1 schema

export type User = {
    id: number
    token_hash: string
    slug_prefix: string
    full_name: string | null
    email: string | null
    phone: string | null
    created_at: string
    updated_at: string
    ai_allow_private: number  // 0 = public bookmarks only, 1 = all bookmarks
}

export type Bookmark = {
    id: number
    user_id: number
    url: string
    slug: string
    title: string | null
    short_description: string | null
    full_text: string | null
    favicon_url: string | null
    is_public: number       // 0 | 1  (SQLite has no native boolean)
    is_archived: number     // 0 | 1
    tag_list: string        // JSON array string e.g. '["dev","tools"]'
    hit_count: number
    last_accessed: string | null
    expires_at: string | null
    created_at: string
    updated_at: string
    ai_tags: string | null          // JSON array string, additive — never overwrites tag_list
    ai_summary: string | null       // AI-generated summary, separate from short_description
    ai_processed_at: string | null  // NULL = not yet processed by AI
}

export type ClickEvent = {
    id: number
    bookmark_id: number
    clicked_at: string
    referrer: string | null
    user_agent: string | null
}

export type ApiToken = {
    id: number
    user_id: number
    name: string
    token_hash: string
    scopes: string        // JSON array string, e.g. '["posts:read","tags:read"]'
    last_used_at: string | null
    expires_at: string | null
    created_at: string
}

// ─── Input shapes (omit DB-managed fields) ────────────────────────────────────

export type CreateBookmarkInput = {
    user_id: number
    url: string
    slug: string
    title?: string
    short_description?: string
    favicon_url?: string
    is_public?: boolean
    tag_list?: string[]
    expires_at?: string
}

export type UpdateBookmarkInput = Partial<{
    url: string
    slug: string
    title: string
    short_description: string
    favicon_url: string
    is_public: boolean
    is_archived: boolean
    tag_list: string[]
    expires_at: string | null
}>

export type ListBookmarksOptions = {
    user_id: number
    sort?: 'created_at' | 'title' | 'hit_count' | 'last_accessed'
    order?: 'ASC' | 'DESC'
    tag?: string          // filter by a single tag (LIKE search inside JSON)
    search?: string       // FTS5 full-text search across title, description, tags, url
    since?: string        // ISO 8601 lower bound on created_at (inclusive)
    before?: string       // ISO 8601 upper bound on created_at (inclusive, end-of-day)
    include_archived?: boolean
    unread?: boolean      // only bookmarks never clicked (hit_count = 0)
    page?: number         // 1-based
    per_page?: number     // default 25
}
