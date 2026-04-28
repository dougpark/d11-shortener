#!/usr/bin/env bun
// bookmark-api-example.js — demo of the Lumin bookmark API
//
// Usage:
//   TOKEN=your_token_here bun run docs/bookmark-api-example.js

const BASE = 'https://d11.me/api/v1'
const TOKEN = process.env.TOKEN
if (!TOKEN) { console.error('Set TOKEN env var'); process.exit(1) }

const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
const api = (path, opts = {}) =>
    fetch(`${BASE}${path}`, { headers, ...opts }).then(r => r.json())

// ─── 1. Create a single bookmark ─────────────────────────────────────────────
const created = await api('/posts', {
    method: 'POST',
    body: JSON.stringify({
        url: 'https://bun.sh',
        title: 'Bun — JavaScript runtime',
        tag_list: ['bun', 'js', 'runtime'],
        is_public: false,
    }),
})
console.log('Created:', created.data?.id, created.data?.url)
// 409 if the URL already exists for your account

// ─── 2. Fetch it back by ID ───────────────────────────────────────────────────
const id = created.data?.id
if (id) {
    const fetched = await api(`/posts/${id}`)
    console.log('Fetched by ID:', fetched.data?.title, fetched.data?.tags)
}

// ─── 3. Exact-match lookup by URL ─────────────────────────────────────────────
const byUrl = await api(`/posts?url=${encodeURIComponent('https://bun.sh')}`)
console.log('Found by URL:', byUrl.data?.slug)

// ─── 4. Patch the bookmark ────────────────────────────────────────────────────
if (id) {
    const patched = await api(`/posts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
            short_description: 'A fast JS runtime and toolkit',
            tag_list: ['bun', 'js', 'runtime', 'toolchain'],
        }),
    })
    console.log('Patched tags:', patched.data?.tags)
}

// ─── 5. Batch create ──────────────────────────────────────────────────────────
const batch = await api('/posts/batch', {
    method: 'POST',
    body: JSON.stringify({
        items: [
            { url: 'https://hono.dev', title: 'Hono — web framework', tag_list: ['hono', 'js'] },
            { url: 'https://developers.cloudflare.com/workers/', title: 'Cloudflare Workers', tag_list: ['cloudflare'] },
            { url: '' },   // invalid — skipped, not fatal
        ],
    }),
})
console.log('Batch result:', batch)
// { inserted: 2, skipped_duplicates: 0, invalid: [{ index: 2, reason: 'url is required' }] }

// ─── 6. List bookmarks (filtered) ────────────────────────────────────────────
const list = await api('/posts?tag=bun&limit=10')
console.log(`Listed ${list.meta?.total} total, got ${list.data?.length}`)

// ─── 7. Delete the created bookmark ──────────────────────────────────────────
if (id) {
    const deleted = await api(`/posts/${id}`, { method: 'DELETE' })
    console.log('Deleted:', deleted)
}
