# Add bookmark api
- batch sizes similar to ai enrichment plan
- authorize with scope and token by user
- include new columns in the news item card:
    - title
    - ai_summary
    - ai_synthesis (new)
    - ai_synthesis_at (new)
    - ai_tags
    - full_text_at (new)
    - plus all other columns that are currently in the bookmarks table

- what are other featues needed for a general purpose bookmark api?

# Get bookmarks api
- batch sizes similar to ai enrichment plan
- authorize with scope and token by user
- include all bookmark details, including title, url, tags, and any ai enrichment data
- what are other featues needed for a general purpose bookmark api?

# Get bookmrks by tag api
- batch sizes similar to ai enrichment plan
- authorize with scope and token by user
- filter bookmarks by tag(s)
- include all bookmark details, including title, url, tags, and any ai enrichment data
- what are other featues needed for a general purpose bookmark api?

## Pre-Planning

Read [](file:///Users/dougpark/Projects/d11-lumin/docs/_a%20add%20bookmarks%20api.md)

Read [](file:///Users/dougpark/Projects/d11-lumin/docs/z_todo%20api.md)

Read [](file:///Users/dougpark/Projects/d11-lumin/src/middleware/apiTokenMiddleware.ts)

Read [](file:///Users/dougpark/Projects/d11-lumin/src/routes/v1.ts#1-1), lines 1 to 150

Read [](file:///Users/dougpark/Projects/d11-lumin/src/routes/v1.ts#150-150), lines 150 to 296

Here's an analysis based on the doc and the existing v1.ts implementation.

---

## What the doc describes vs. what exists

The doc is a wishlist sketch. The **GET side is already fully built**:
- `GET /api/v1/posts` — with tag filtering, search, pagination, `since`, unread/archived flags
- `GET /api/v1/posts/updated` — polling timestamp
- `GET /api/v1/tags` — tag list with counts
- Full token management (create, list, rotate, revoke) with named scopes

The `posts:write` scope is already defined — but **no write routes exist yet**.

---

## Pros of the described approach

1. **Bearer token + named scopes** — standard REST auth, principle of least privilege. The `posts:read` / `posts:write` split is clean.
2. **Token rotation built in** — already has `POST /api/v1/tokens/:id/rotate`, so key rotation is easy.
3. **Session token fallback** — dev-friendly; no separate token needed in testing.
4. **GET /posts is rich** — multi-tag AND filtering, full-text search, `since` for sync polling, unread/archived flags, pagination up to 1000. Solid for integrations.
5. **AI enrichment fields exposed** — `ai_summary`, `ai_tags` in the response shape means consumers get enriched data automatically.
6. **Token limit + expiry** — 10-token cap per user, optional `expires_at` — good hygiene.

---

## Cons / Gaps

1. **No write route yet** — `POST /api/v1/posts` is the entire point of the doc but doesn't exist. The scope exists, the route doesn't.
2. **No single-item fetch** — `GET /api/v1/posts/:id` is missing; you can't retrieve one bookmark by ID.
3. **No update or delete** — can't `PATCH /api/v1/posts/:id` (retag, archive, edit title) or `DELETE /api/v1/posts/:id`.
4. **Tag filtering uses JSON LIKE** — `%"bun"%` will match the substring in `"bunker"`. Works but fragile; `json_each()` (already used in `/tags`) would be more correct.
5. **No scope enforcement on existing routes** — the middleware authenticates the token but doesn't check whether the token's scopes actually include `posts:read`. Scopes are stored but not validated on requests.
6. **No duplicate URL handling** — the doc doesn't address what happens if a URL already exists for that user (conflict? update? silently ignore?).
7. **No bulk ingest** — the doc references "batch sizes similar to AI enrichment" but a single-POST-per-URL design doesn't support array payloads, which matters for MCP or import flows.
8. **New schema columns not yet present** — the doc references `ai_synthesis`, `ai_synthesis_at`, `full_text_at` as new columns, which aren't in `formatPost` yet.

---

## What's needed to complete a v1 bookmark API

| Endpoint | Purpose | Scope needed |
|---|---|---|
| `POST /api/v1/posts` | Add one bookmark (URL required, title/tags optional) | `posts:write` |
| `GET /api/v1/posts/:id` | Fetch single bookmark by ID | `posts:read` |
| `PATCH /api/v1/posts/:id` | Update title, tags, description, archived, public | `posts:write` |
| `DELETE /api/v1/posts/:id` | Remove a bookmark | `posts:write` |
| `GET /api/v1/posts?url=` | Lookup by URL (dedup check) | `posts:read` |
| Scope validation in middleware | Actually enforce `posts:read` / `posts:write` on each route | — |
| Conflict policy on `POST` | Define 200-update vs. 409-error when URL already exists | — |
| `POST /api/v1/posts` with array body | Optional bulk ingest for MCP / import flows | `posts:write` |

Rate limiting per token is a further consideration, but that's a Cloudflare-layer concern rather than an application change.