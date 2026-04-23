# d11.me — Lumin:Bookmark + Link Shortener

A personal bookmark manager with short links, built on **Cloudflare Workers + Hono + D1**.

- Save bookmarks with a short slug: `d11.me/l/cowboys`
- One-click bookmarklet for any page
- Tag, search, archive, and paginate your bookmarks
- Bearer-token auth (token shown once on register, never stored plain)
- Public / private visibility per bookmark
- Public API v1 with named, scoped, revocable API tokens — built for scripts, agents, and MCP servers

---

## Prerequisites

| Tool | Version |
|------|---------|
| [Bun](https://bun.sh) | ≥ 1.1 |
| [Wrangler](https://developers.cloudflare.com/workers/wrangler/) | ≥ 3 (installed via `devDependencies`) |
| Cloudflare account | Free tier is fine |
| `d11.me` domain added to Cloudflare | Required for custom routing |

---

## First-time setup

### 1 — Install dependencies

```bash
bun install
```

### 2 — Create the D1 database

```bash
bunx wrangler d1 create d11-db
```

Copy the `database_id` from the output and paste it into `wrangler.toml`:

```toml
[[d1_databases]]
binding        = "DB"
database_name  = "d11-db"
database_id    = "PASTE_YOUR_ID_HERE"   # ← replace this line
```

### 3 — Apply the schema (remote)

```bash
bun run db:migrate:remote --remote
```

> For local dev only (no remote write needed): `bun run db:migrate:local`

### 4 — Set the TOKEN_SECRET

This secret is used to add entropy when hashing auth tokens. Choose a long random string and set it as a Wrangler secret:

```bash
bunx wrangler secret put TOKEN_SECRET
# Paste a strong random string and press Enter
```

Generate one if you need it:

```bash
openssl rand -base64 32
```

### 5 — Enable the custom domain route

In `wrangler.toml`, uncomment and fill in the routes block:

```toml
[[routes]]
pattern   = "d11.me/*"
zone_name = "d11.me"
```

> Make sure `d11.me` is proxied through Cloudflare (orange cloud) in your DNS settings.

### 6 — Deploy

```bash
bun run deploy
```

The Worker URL will be printed. Once the `[[routes]]` entry is active, all traffic to `d11.me/*` will be handled by the Worker.

---

## Local development

```bash
bun run dev
# Opens http://localhost:8787
```

The local D1 database is in `.wrangler/state/`. Run `bun run db:migrate:local` to apply the schema locally.

---

## package.json scripts

| Script | What it does |
|--------|-------------|
| `bun run dev` | `wrangler dev` — hot-reload local Worker |
| `bun run deploy` | `wrangler deploy` — push to Cloudflare |
| `bun run db:migrate:local` | Apply `schema.sql` to local D1 |
| `bun run db:migrate:remote` | Apply `schema.sql` to remote (production) D1 |
| `bun run cf-typegen` | Regenerate `worker-configuration.d.ts` from bindings |

---

## Account registration

Lumin uses **token-based authentication** — there are no passwords and no email verification. Instead, a random 64-character cryptographic token is generated at registration and becomes your permanent credential. Here is the exact flow and why each step matters.

### Step 1 — Choose a handle

On the Create Account tab, enter a **handle** (called `slug_prefix` internally). This is a short, lowercase identifier that becomes part of every short link you create:

```
handle: dp  →  short links at  d11.me/l/dp/cowboys
```

The handle is your public namespace. It does not need to be your real name — use whatever you like. It must be 2–32 characters, lowercase alphanumeric, dashes, or underscores, and it must be unique across the system.

**You can register multiple accounts** with different handles if you want separate namespaces — for example `dp-work` and `dp-personal`. Each gets its own independent token and bookmark collection.

### Step 2 — Copy your token immediately

After clicking **Create Account**, a modal appears showing your token — a 64-character hex string. This is the **only time the raw token is ever shown**. The server stores only a SHA-256 hash of it; the plain value is discarded immediately after the response is sent.

> **If you close this modal without saving the token, you are effectively locked out.** There is no "forgot token" flow, no email reset, and no recovery option. The token is your key.

Copy it to a safe place — a password manager, a secrets vault, or at minimum a secure note. The modal has a **Copy Token** button for convenience.

### Step 3 — Paste it into the Sign In form to trigger browser password saving

After copying the token, clicking **I've saved it — Sign In** closes the modal and takes you to the Sign In tab with the token pre-staged. You then **paste the token into the password field and submit the form**.

This step is intentional and important: the browser detects a username + password form submission and offers to save the credential. Accepting that offer means your browser will auto-fill the token on future visits — you never have to find it again. The "username" the browser saves is your handle; the "password" is your token.

> On Safari and some mobile browsers, the token is intentionally not auto-filled into the field on your behalf (browsers block programmatic password field writes as an anti-phishing measure). This is why the paste-and-submit step exists as a separate action rather than happening automatically.

### Step 4 — The magic login link

Once signed in, **Copy Login Link** (in the user menu) gives you a URL of the form:

```
https://d11.me/?token=<your-64-char-token>
```

Visiting this link on any device logs you in immediately — no typing, no paste. This is useful for:
- Logging into a new browser or device
- Sharing access with yourself across machines
- Scripting or automation where a browser session is needed

**Treat this link exactly like a password.** Anyone who has it has full access to your account — they can read, edit, and delete all your bookmarks and issue API tokens on your behalf. Do not paste it into chat, email it unencrypted, or commit it to a repository.

The link works because the token itself is the credential. There is no separate user ID or username required — the server hashes the token from the URL, looks it up in the database, and establishes a session cookie. The handle is a label for your short-link namespace, not an identity factor in the authentication.

### Why there is no "real" user ID or password

Traditional auth systems tie identity to an email address or username and use a password as a proof of ownership, with a server-side reset mechanism as a fallback. That fallback is the attack surface — most account takeovers happen via password reset flows, not brute force.

Lumin's model eliminates that surface entirely:

- No email → no account recovery → no reset link to intercept
- No password → no credential stuffing
- The token hash in the database is useless to an attacker without the raw value
- Revoking access is as simple as regenerating a token (future feature) or deleting the account row

The tradeoff is that **you** are responsible for keeping the token safe. For a single-user personal tool this is the right trade.

---

## How short links work

Every user registers with a **slug prefix** (e.g. `dp`). When they create a bookmark with slug `cowboys`, the short link becomes:

```
https://d11.me/l/dp/cowboys
```

A flat alias (prefix omitted) also works if the slug is globally unique:

```
https://d11.me/l/cowboys
```

Visiting either URL redirects the browser (or returns OG metadata for bots/unfurlers).

---

## Bookmarklet

Once logged in, drag the **+ d11.me** button from the left sidebar to your browser's bookmarks bar.

Clicking the bookmarklet on any page opens a pop-up with the URL and title pre-filled, ready to save.

**Manual snippet** (replace `https://d11.me` with your Worker URL during dev):

```javascript
javascript:(function(){window.open('https://d11.me/add?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title),'_blank','width=540,height=700,resizable=yes')})();
```

Create a new bookmark in your browser, paste this as the URL, and name it `+ d11.me`.

---

## User interface

The main dashboard is a single-page app served at `d11.me/`. The layout is a fixed header, a tag sidebar (desktop), and a paginated bookmark grid.

### Main dashboard

- **Search bar** — Live full-text search across title, URL, and description as you type.
- **Sort controls** — Sort by Date Added, Title, Hit Count, or Last Accessed; toggle ASC/DESC.
- **Tag sidebar** — Click any tag to filter the bookmark list. A filter-as-you-type input narrows the tag list itself when you have many tags. "All" clears the filter.
- **Show archived** — Checkbox at the bottom of the tag sidebar; archived bookmarks are hidden by default.
- **Bookmark cards** — Each card shows the title, URL, tags, and a hit counter. Click the title to open the URL. Action icons on hover: edit, copy short link, archive, delete.
- **+ New** button (header) — Opens the add-bookmark drawer with URL and title pre-filled if launched via the bookmarklet.

### User menu (avatar / initials button, top-right)

The dropdown shows your display name and slug prefix, then the following actions:

| Item | What it does |
|---|---|
| **Rename Tag** | Opens a modal to rename a tag across all bookmarks at once. Type the old tag name, then the new name. All bookmarks that carry the old tag are updated atomically. |
| **Export Bookmarks** | Downloads a complete JSON backup of your entire bookmark database — all fields, all tags, all metadata. This is a full Lumin-format export suitable for backup or migration to another instance. The file is named `lumin-bookmarks-YYYY-MM-DD.json`. |
| **Import Bookmarks** | Imports a Lumin-format JSON file (produced by Export Bookmarks). Accepts either a bare array or the `{ bookmarks: [...] }` wrapper. Duplicate URLs are skipped; a result modal shows how many were imported, skipped, and errored. Safe to re-run — already-existing URLs are never overwritten. |
| **Import from Pinboard** | Opens a dedicated import page (`/import/pinboard`) for Pinboard JSON exports. Drag-and-drop or pick the file, preview the bookmark and tag counts, then import in batches of 100 with a live progress bar. Maps Pinboard fields to Lumin fields automatically (`description`→title, `extended`→description, space-separated `tags`→tag array, etc.). |
| **Import from Browser** | Opens a dedicated import page (`/import/browser`) for Netscape HTML bookmark exports — the standard format produced by Chrome, Firefox, Edge, and Safari (`Bookmarks Manager → Export`). Folder names become tags. Safari Reading List items get a `reading-list` tag. A tag chip preview lets you verify the folder→tag mapping before committing. |
| **Copy Login Link** | Copies your magic login URL to the clipboard. This link contains your session token and can be used to log in from any browser without a password. Treat it like a password — anyone with the link has full access to your account. |
| **Sign Out** | Clears the `d11_auth` session cookie and returns to the logged-out state. Your data and token are unaffected; you can log back in via your login link. |

---

## Architecture

```
src/
├── index.ts                 # Worker entry — Hono app, redirect handler, HTML serving
├── middleware/
│   ├── authMiddleware.ts        # Bearer → SHA-256 → DB user lookup (session/UI)
│   └── apiTokenMiddleware.ts    # Named API token auth for v1 endpoints
├── routes/
│   ├── auth.ts              # POST /api/auth/register, GET /api/auth/me
│   ├── bookmarks.ts         # Full CRUD, tag list, slug check, URL preview
│   └── v1.ts                # Public API v1 — posts, tags, token management
├── db/
│   ├── types.ts             # TypeScript row/input types
│   ├── users.ts             # User queries
│   ├── bookmarks.ts         # Bookmark queries (list, CRUD, click tracking)
│   └── api_tokens.ts        # API token CRUD (create, list, revoke, touch)
├── utils/
│   ├── auth.ts              # hashToken, generateToken, extractBearer
│   └── preview.ts           # fetchUrlPreview — title, description, favicon
└── client/
    └── app.html             # Single-file SPA (Tailwind CDN, vanilla JS)

schema.sql                   # D1 schema — users, bookmarks, click_events, api_tokens
wrangler.toml                # Cloudflare configuration
```

---

## Public API v1

The v1 API is designed for programmatic access — scripts, agents, MCP servers, and future RSS feeds. All endpoints live under `/api/v1/` and use `Bearer` token authentication.

### Authentication

API tokens are separate from session tokens. Create one named token per consumer (your Python script, an n8n workflow, a Claude agent, etc.). Each token can be revoked independently without affecting the others.

**Step 1 — Create a token** (use your session Bearer token from registration):

```bash
curl -s -X POST https://d11.me/api/v1/tokens \
  -H "Authorization: Bearer <your-session-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "my python script", "scopes": ["posts:read", "tags:read"]}'
```

Response (the raw token is shown **once** — save it immediately):

```json
{
  "token": "a3f8...64hex...chars",
  "id": 1,
  "name": "my python script",
  "scopes": ["posts:read", "tags:read"],
  "expires_at": null,
  "created_at": "2026-04-20T12:00:00Z",
  "notice": "Save this token now — it will not be shown again."
}
```

**Step 2 — Use the token** on all subsequent v1 requests:

```bash
curl -H "Authorization: Bearer <api-token>" https://d11.me/api/v1/posts
```

---

### Scopes

| Scope | Grants |
|---|---|
| `posts:read` | `GET /api/v1/posts`, `GET /api/v1/posts/updated` |
| `tags:read` | `GET /api/v1/tags` |
| `posts:write` | Reserved — future write endpoints |
| `tags:write` | Reserved — future tag mutations |
| `ai:process` | `GET /api/ai/queue`, `PATCH /api/ai/items` |
| `*` | All current and future scopes |

> Scope enforcement will be added as write endpoints are introduced. Currently only reads are available.

---

### Endpoints

#### `GET /api/v1/posts/updated`

Returns the timestamp of the most recently created or updated bookmark. Use this as a polling sentinel — only fetch all posts if this has changed since your last pull.

```bash
curl -H "Authorization: Bearer <token>" https://d11.me/api/v1/posts/updated
```

```json
{ "updated_at": "2026-04-20T11:45:00Z" }
```

---

#### `GET /api/v1/posts`

Returns bookmarks with optional filtering.

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `tag` | string (repeatable) | — | Filter by tag. Repeat up to 3 times for AND logic |
| `search` | string | — | LIKE match across title, URL, and description |
| `since` | ISO 8601 datetime | — | Only return bookmarks created after this timestamp |
| `limit` | integer | 100 | Max results to return (ceiling: 1000) |
| `offset` | integer | 0 | Skip this many results (for pagination) |
| `unread` | `1` | — | Only return bookmarks never clicked |
| `archived` | `1` | — | Include archived bookmarks (excluded by default) |

**Examples:**

```bash
# All bookmarks tagged "link"
curl -H "Authorization: Bearer <token>" \
  "https://d11.me/api/v1/posts?tag=link"

# AND filter: tagged both "bun" and "tools"
curl -H "Authorization: Bearer <token>" \
  "https://d11.me/api/v1/posts?tag=bun&tag=tools"

# Unread bookmarks added in the last week
curl -H "Authorization: Bearer <token>" \
  "https://d11.me/api/v1/posts?unread=1&since=2026-04-13T00:00:00Z"

# Full-text search with pagination
curl -H "Authorization: Bearer <token>" \
  "https://d11.me/api/v1/posts?search=cloudflare&limit=20&offset=40"
```

**Response:**

```json
{
  "data": [
    {
      "id": 42,
      "url": "https://bun.sh",
      "slug": "bun",
      "title": "Bun — A fast all-in-one JavaScript runtime",
      "description": "Replaces Node, npm, and Webpack in one binary.",
      "favicon_url": "https://bun.sh/favicon.ico",
      "tags": ["bun", "tools", "javascript"],
      "public": true,
      "unread": false,
      "archived": false,
      "created_at": "2026-03-01T09:00:00Z",
      "updated_at": "2026-03-01T09:00:00Z"
    }
  ],
  "meta": {
    "total": 87,
    "limit": 100,
    "offset": 0
  }
}
```

---

#### `GET /api/v1/tags`

Returns all tags in use with their bookmark counts, ordered by count descending.

```bash
curl -H "Authorization: Bearer <token>" https://d11.me/api/v1/tags
```

```json
{
  "data": [
    { "tag": "javascript", "count": 43 },
    { "tag": "tools",      "count": 31 },
    { "tag": "bun",        "count": 12 }
  ]
}
```

---

#### `GET /api/v1/tokens`

Lists your API tokens. The raw token is never returned — only metadata.

```bash
curl -H "Authorization: Bearer <session-token>" https://d11.me/api/v1/tokens
```

```json
{
  "data": [
    {
      "id": 1,
      "name": "my python script",
      "scopes": ["posts:read", "tags:read"],
      "last_used_at": "2026-04-20T11:45:00Z",
      "expires_at": null,
      "created_at": "2026-04-20T12:00:00Z"
    }
  ]
}
```

---

#### `POST /api/v1/tokens`

Creates a new named API token. Requires your session token (not an API token — tokens cannot mint other tokens).

```bash
curl -s -X POST https://d11.me/api/v1/tokens \
  -H "Authorization: Bearer <session-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "claude agent",
    "scopes": ["posts:read", "tags:read"],
    "expires_at": "2027-01-01T00:00:00Z"
  }'
```

Body fields:

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Human label, max 100 chars |
| `scopes` | No | Array of scope strings. Defaults to `["posts:read", "tags:read"]` |
| `expires_at` | No | ISO 8601 UTC expiry. Omit for a non-expiring token |

---

#### `DELETE /api/v1/tokens/:id`

Revokes a token by its numeric ID. Scoped to your user — you cannot revoke another user's tokens.

```bash
curl -X DELETE \
  -H "Authorization: Bearer <session-token>" \
  https://d11.me/api/v1/tokens/1
```

```json
{ "deleted": true }
```

---

### Python client example

```python
import httpx
import os

BASE = "https://d11.me/api/v1"
headers = {"Authorization": f"Bearer {os.environ['D11_API_TOKEN']}"}

# Check for updates before fetching all posts
sentinel = httpx.get(f"{BASE}/posts/updated", headers=headers).json()["updated_at"]
print(f"Last update: {sentinel}")

# Fetch all bookmarks tagged "link"
r = httpx.get(f"{BASE}/posts", params={"tag": "link", "limit": 1000}, headers=headers)
posts = r.json()["data"]
print(f"Found {len(posts)} bookmarks")

for post in posts:
    print(f"  {post['title']} — {post['url']}")
```

---

## AI Enrichment API

The AI API is designed for an external daemon (e.g. a Linux host running a local LLM via Ollama) to pull unprocessed RSS items, enrich them with AI-generated tags and a summary, and push the results back. Both endpoints live under `/api/ai/` and require a named API token with the `ai:process` scope.

### Setup — create a daemon token

Use your session token to mint a named API token scoped to `ai:process`:

```bash
curl -s -X POST https://d11.me/api/v1/tokens \
  -H "Authorization: Bearer <your-session-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "ai-daemon", "scopes": ["ai:process"]}'
```

Response (raw token shown **once** — save it immediately):

```json
{
  "token": "a3f8...64hex...chars",
  "id": 7,
  "name": "ai-daemon",
  "scopes": ["ai:process"],
  "expires_at": null,
  "created_at": "2026-04-22T10:00:00Z",
  "notice": "Save this token now — it will not be shown again."
}
```

Use this token as the `Bearer` credential for all `/api/ai/*` requests.

---

### Endpoints

#### `GET /api/ai/queue`

Returns a batch of RSS items that have not yet been processed by AI (`ai_processed_at IS NULL`) and are not yet expired. Items are returned oldest-first so the daemon processes in chronological order.

**Query parameters:**

| Parameter | Type | Default | Constraints | Description |
|---|---|---|---|---|
| `limit` | integer | `20` | 1–50 | Max items to return per request |

**Request:**

```bash
curl -H "Authorization: Bearer <ai-daemon-token>" \
  "https://d11.me/api/ai/queue?limit=10"
```

**Response:**

```json
{
  "items": [
    {
      "id": 101,
      "url": "https://example.com/article",
      "title": "Some Article Title",
      "summary": "Original RSS feed description text.",
      "tag_list": "[\"tech:01\",\"news:02\"]",
      "published_at": "2026-04-22T08:30:00Z",
      "feed_name": "Hacker News"
    }
  ],
  "count": 1
}
```

**Field notes:**
- `summary` — the raw description from the RSS feed (may be HTML-stripped or empty)
- `tag_list` — JSON-encoded array of colon-suffixed tags auto-assigned during ingest (e.g. `"tech:01"` means tag `tech`, sort position `01`)
- Items with `expires_at` in the past are excluded automatically

---

#### `PATCH /api/ai/items`

Writes AI-generated tags and/or a summary back for a batch of items. Stamped with `ai_processed_at = now()` so items are not returned by `/api/ai/queue` again.

**Request body:** JSON array of item update objects. Maximum 50 items per request.

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `id` | integer | Yes | Positive integer matching an `rss_items` row | Item ID from `/api/ai/queue` |
| `ai_tags` | string[] | No | Array of lowercase tag strings | AI-generated topic tags (additive alongside existing tags) |
| `ai_summary` | string | No | Max 2000 characters | Clean AI-generated summary |

Either `ai_tags` or `ai_summary` (or both) may be provided per item. Omitted fields are stored as `NULL`.

**Request:**

```bash
curl -s -X PATCH https://d11.me/api/ai/items \
  -H "Authorization: Bearer <ai-daemon-token>" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "id": 101,
      "ai_tags": ["cloudflare", "workers", "performance"],
      "ai_summary": "Cloudflare announces a new feature for Workers that improves cold start performance by 40%."
    },
    {
      "id": 102,
      "ai_tags": ["rust", "webassembly"],
      "ai_summary": "A tutorial on compiling Rust to WASM and running it in the browser."
    }
  ]'
```

**Response:**

```json
{ "updated": 2 }
```

**Error responses:**

| Status | Body | Cause |
|---|---|---|
| `400` | `{ "error": "Body must be a non-empty array" }` | Body is not an array or is empty |
| `400` | `{ "error": "Batch too large — max 50 items" }` | Array length > 50 |
| `400` | `{ "error": "Each item must have a positive integer id" }` | `id` missing, not an integer, or < 1 |
| `400` | `{ "error": "ai_tags must be an array" }` | `ai_tags` present but not an array |
| `400` | `{ "error": "ai_summary must be a string" }` | `ai_summary` present but not a string |
| `400` | `{ "error": "ai_summary too long (max 2000 chars)" }` | `ai_summary` exceeds 2000 characters |
| `403` | `{ "error": "Forbidden", "hint": "..." }` | Token missing or lacks `ai:process` scope |

---

### Daemon workflow

The recommended polling loop:

1. `GET /api/ai/queue?limit=20` — fetch a batch
2. For each item, run your LLM to generate tags and a summary
3. `PATCH /api/ai/items` — push results back in one batch request
4. Repeat until `count` in the queue response is `0`, then sleep and poll again

Once `ai_summary` or `ai_tags` are written back, `news.html` will immediately prefer the AI output over the original feed data for any visitor who loads the page.

---

### Python daemon example

```python
import httpx, time, os, json

BASE    = "https://d11.me/api/ai"
HEADERS = {"Authorization": f"Bearer {os.environ['D11_AI_TOKEN']}"}

def process_item(item: dict) -> dict:
    """Replace with your actual LLM call."""
    return {
        "id": item["id"],
        "ai_tags": ["example", "tag"],
        "ai_summary": f"AI summary of: {item['title']}",
    }

while True:
    r = httpx.get(f"{BASE}/queue", params={"limit": 20}, headers=HEADERS, timeout=30)
    r.raise_for_status()
    data = r.json()

    if data["count"] == 0:
        time.sleep(60)
        continue

    results = [process_item(item) for item in data["items"]]

    patch = httpx.patch(f"{BASE}/items", json=results, headers=HEADERS, timeout=30)
    patch.raise_for_status()
    print(f"Updated {patch.json()['updated']} items")
```

---

## Security notes

- **Tokens are never stored in plain text.** Plain tokens (session and API) are shown exactly once and then discarded. Only SHA-256 hashes are stored in D1.
- **`TOKEN_SECRET`** is a Wrangler secret (not in `[vars]`), never committed to source control.
- All `/api/bookmarks/*` and `/api/v1/*` routes require a valid Bearer token.
- API tokens (`api_tokens` table) are separate from session tokens and can be revoked individually without affecting the browser session.
- Token management endpoints (`POST /api/v1/tokens`, `DELETE /api/v1/tokens/:id`) require the session token — an API token cannot mint or revoke other tokens.
- Public bookmarks are readable by anyone via the redirect endpoint; private bookmarks return 404 to unauthenticated callers.
- AI daemon tokens should use the `ai:process` scope only — do not grant `*` scope to automated processes.
