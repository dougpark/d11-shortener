# d11.me — Build Plan

## Step 1 — Project scaffold & config
package.json, wrangler.toml, tsconfig.json, top-level directory structure, .gitignore, Tailwind build config. No logic yet — just the skeleton that makes bun install and wrangler dev work.

## Step 2 — D1 database schema
schema.sql with the full users and bookmarks tables, all columns from requirements, indexes on slug, user_id_token, composite unique constraint on (user_id_token, slug). Includes the wrangler d1 commands to create and apply it.

## Step 3 — DB helper functions (src/db/)
src/db/bookmarks.ts and src/db/users.ts — typed query helpers for all CRUD operations (list with pagination/sort/filter, create, patch, delete, get-by-slug, increment hit_count). Pure functions that take env.DB as a parameter.

## Step 4 — Hono Worker entry point & API routes (src/index.ts)
All routes:

GET /l/:slug — redirect with OG-preview bot detection
POST /api/bookmarks — add
GET /api/bookmarks — list (sort, filter, pagination)
PATCH /api/bookmarks/:id — edit
DELETE /api/bookmarks/:id — delete
GET /api/tags — unique tag list
GET /api/preview?url= — fetch title/favicon
GET /api/check-slug?q= — availability check
POST /api/auth/login — token exchange
GET / and GET /add — serves the frontend HTML

## Step 5 — Frontend: login page + dashboard (src/client/)
Full single-page index.html served by the Worker. Login view → token auth → dashboard list view with Copy / Edit / Public-Private toggle / Delete buttons, tag sidebar, search, pagination. Gemini-Modern design.

## Step 6 — Frontend: Add/Edit bookmark modal + bookmarklet
The slide-in modal with live slug availability check (debounced), URL preview auto-fill, tag input, public/private toggle. Plus the one-line bookmarklet snippet users can drag to their browser bar (d11.me/add?url=...).

## Step 7 — Wrangler deployment instructions
README.md-style shell commands to: create D1, apply schema, set secrets, wrangler deploy. Also the wrangler.toml route entry for d11.me/l/*.

