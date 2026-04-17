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
}

export type ClickEvent = {
    id: number
    bookmark_id: number
    clicked_at: string
    referrer: string | null
    user_agent: string | null
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
    search?: string       // full-text LIKE search across title, url, description
    include_archived?: boolean
    page?: number         // 1-based
    per_page?: number     // default 25
}
