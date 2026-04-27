# d11.me — Lumin:Bookmark + AI Enrichment API

# Lumin 
![Vibe Coding](https://img.shields.io/badge/Vibe-Coding-blueviolet)
![Design: Human](https://img.shields.io/badge/Design-Doug%20Park-orange)
![Code: AI](https://img.shields.io/badge/Code-Claude%20Sonnet%204.6-blue)

A personal bookmark manager with AI Enrichment API, built on **Cloudflare Workers + Hono + D1**.

See the partner Gopher project for an AI powered backend that can consume Lumin's API to auto-tag and summarize bookmarks and RSS items.

- Save bookmarks with a short slug: `d11.me/l/cowboys`
- One-click bookmarklet for any page
- Tag, search, archive, and paginate your bookmarks
- Bearer-token auth (token shown once on register, never stored plain)
- Public / private visibility per bookmark
- Public API v1 with named, scoped, revocable API tokens — built for scripts, agents, and MCP servers

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [First-time setup](#first-time-setup)
  - [1 — Install dependencies](#1--install-dependencies)
  - [2 — Create the D1 database](#2--create-the-d1-database)
  - [3 — Apply the schema](#3--apply-the-schema-remote)
  - [4 — Set the TOKEN\_SECRET](#4--set-the-token_secret)
  - [5 — Enable the custom domain route](#5--enable-the-custom-domain-route)
  - [6 — Deploy](#6--deploy)
- [Local development](#local-development)
- [package.json scripts](#packagejson-scripts)
- [Account registration](#account-registration)
  - [Step 1 — Choose a handle](#step-1--choose-a-handle)
  - [Step 2 — Copy your token immediately](#step-2--copy-your-token-immediately)
  - [Step 3 — Sign In and save to browser](#step-3--paste-it-into-the-sign-in-form-to-trigger-browser-password-saving)
  - [Step 4 — The magic login link](#step-4--the-magic-login-link)
  - [Why there is no "real" user ID or password](#why-there-is-no-real-user-id-or-password)
- [How short links work](#how-short-links-work)
- [Bookmarklet](#bookmarklet)
- [User interface](#user-interface)
  - [Main dashboard](#main-dashboard)
  - [User menu](#user-menu-avatar--initials-button-top-right)
- [Bookmark Analytics](#bookmark-analytics)
  - [Summary stats](#summary-stats)
  - [Data Completeness](#data-completeness)
  - [Status Breakdown and Description Length](#status-breakdown-and-description-length)
  - [AI Summary Length](#ai-summary-length)
  - [Tags per Bookmark](#tags-per-bookmark)
  - [Click Count Distribution](#click-count-distribution)
  - [Save Velocity](#save-velocity)
  - [Top Domains](#top-domains)
- [Architecture](#architecture)
- [Public API v1](#public-api-v1)
  - [Authentication](#authentication)
  - [Scopes](#scopes)
  - [Endpoints](#endpoints)
    - [GET /api/v1/posts/updated](#get-apiv1postsupdated)
    - [GET /api/v1/posts](#get-apiv1posts)
    - [GET /api/v1/tags](#get-apiv1tags)
    - [GET /api/v1/tokens](#get-apiv1tokens)
    - [POST /api/v1/tokens](#post-apiv1tokens)
    - [DELETE /api/v1/tokens/:id](#delete-apiv1tokensid)
  - [Bun.js client example](#bunjs-client-example)
- [AI Enrichment API](#ai-enrichment-api)
  - [Setup — create a daemon token](#setup--create-a-daemon-token)
  - [Endpoints](#endpoints-1)
    - [GET /api/ai/queue](#get-apiaiqueue)
    - [PATCH /api/ai/items](#patch-apiaiitems)
  - [Daemon workflow](#daemon-workflow)
  - [Bun.js daemon example](#bunjs-daemon-example)
- [Security notes](#security-notes)

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

## Bookmark Analytics

Open the **Analytics** modal from the user menu (avatar button → **Analytics**). All data is computed server-side in a single D1 batch query and rendered client-side on Canvas — no external charting library required.

### Summary stats

Four at-a-glance tiles across the top of the modal: total bookmarks, AI enrichment percentage, average tags per bookmark, and the date of your oldest saved link.

### Data Completeness

![Data Completeness and Summary Stats](docs/images/analytics_data_completeness.png)

Five progress bars show what fraction of your bookmarks have each quality field populated:

| Field | What it measures |
|---|---|
| **Has title** | `title` is non-empty |
| **Has description** | `short_description` is non-empty |
| **Has tags** | `tag_list` contains at least one tag |
| **AI processed** | `ai_processed_at` is set (AI summary + tags have been generated) |
| **Has been clicked** | `hit_count > 0` (you have revisited the link at least once) |

Bars are colour-coded: green ≥ 80%, amber ≥ 40%, red < 40%.

### Status Breakdown and Description Length

![Status Breakdown and Description Length Distribution](docs/images/analytics_status_breakdown.png)

Three pill badges show the split between **Active Private**, **Active Public**, and **Archived** bookmarks.

Below that, a bar chart buckets every bookmark by the character length of its `short_description` note: `empty`, `1–25`, `26–50`, `51–100`, `101–200`, `201–500`, `500+`. A heavy `empty` bucket is the signal to add more notes; the sweet spot for quick-scan notes is the `51–100` range.

### AI Summary Length

![AI Summary Length Distribution](docs/images/analytics_ai_summary.png)

The same length-bucket histogram applied to `ai_summary`. Well-formed AI summaries cluster in the `101–200` and `201–500` character ranges. A spike in `empty` means those bookmarks haven't been processed by the AI daemon yet. Very short summaries (< 50 chars) indicate truncated or low-quality AI output.

### Tags per Bookmark

![Tags per Bookmark](docs/images/analytics_tag_count.png)

For active (non-archived) bookmarks, shows how many carry 0, 1, 2, 3, 4, or 5+ tags. A large `0` bar means the taxonomy isn't being applied — a prompt to run the AI daemon or tag manually.

### Click Count Distribution

![Click Count Distribution](docs/images/analytics_click_counts.png)

Buckets bookmarks by `hit_count`: `0`, `1–5`, `6–20`, `21–100`, `100+`. A collection dominated by the `0` bucket means you're saving links you never revisit — useful for deciding what to archive or prune.

### Save Velocity

![Save Velocity](docs/images/analytics_save_velocity.png)

A line chart of bookmarks added per calendar month, going back to your oldest bookmark. Useful for spotting periods of high curation activity versus gaps, and for understanding how the collection has grown over time.

### Top Domains

![Top Domains](docs/images/analytics_top_domains.png)

A horizontal bar chart of the 15 most-bookmarked domains (extracted from `url` using SQLite string ops — no external parser). Reveals concentration: if a handful of domains account for the majority of saves, the collection may be narrower in scope than it appears.

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
| `ai:process` | `GET /api/ai/queue`, `PATCH /api/ai/items` (RSS + bookmarks — legacy alias) |
| `ai:process:rss` | `GET /api/ai/queue` (RSS only), `PATCH /api/ai/items` (RSS items only) |
| `ai:process:bookmarks` | `GET /api/ai/queue` (bookmarks only), `PATCH /api/ai/items` (bookmarks only) |
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

### Bun.js client example

```js
// client.js — run with: bun client.js
const BASE = "https://d11.me/api/v1"
const headers = { "Authorization": `Bearer ${process.env.D11_API_TOKEN}` }

// Check for updates before fetching all posts
const { updated_at } = await fetch(`${BASE}/posts/updated`, { headers }).then(r => r.json())
console.log(`Last update: ${updated_at}`)

// Fetch all bookmarks tagged "link"
const { data: posts } = await fetch(
  `${BASE}/posts?tag=link&limit=1000`, { headers }
).then(r => r.json())
console.log(`Found ${posts.length} bookmarks`)

for (const post of posts) {
  console.log(`  ${post.title} — ${post.url}`)
}
```

---

## AI Enrichment API

The AI API is designed for an external daemon (e.g. a Linux host running a local LLM via Ollama) to pull unprocessed RSS items and bookmarks, enrich them with AI-generated tags and a summary, and push the results back. Both endpoints live under `/api/ai/` and require a named API token with an `ai:process` scope.

Three scopes are available:
- `ai:process` — legacy; grants access to both RSS items and bookmarks
- `ai:process:rss` — RSS items only
- `ai:process:bookmarks` — bookmarks only (subject to per-user privacy gate)

### Setup — create a daemon token

Use your session token to mint a named API token scoped to `ai:process:rss` and `ai:process:bookmarks`:

```bash
curl -s -X POST https://d11.me/api/v1/tokens \
  -H "Authorization: Bearer <your-session-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "ai-daemon", "scopes": ["ai:process:rss", "ai:process:bookmarks"]}'
```

Response (raw token shown **once** — save it immediately):

```json
{
  "token": "a3f8...64hex...chars",
  "id": 7,
  "name": "ai-daemon",
  "scopes": ["ai:process:rss", "ai:process:bookmarks"],
  "expires_at": null,
  "created_at": "2026-04-22T10:00:00Z",
  "notice": "Save this token now — it will not be shown again."
}
```

Use this token as the `Bearer` credential for all `/api/ai/*` requests.

---

### Endpoints

#### `GET /api/ai/queue`

Returns a batch of items (RSS and/or bookmarks) that have not yet been processed by AI (`ai_processed_at IS NULL`). RSS items must not be expired. Items are returned oldest-first.

**Query parameters:**

| Parameter | Type | Default | Constraints | Description |
|---|---|---|---|---|
| `source` | string | `all` | `rss`, `bookmarks`, `all` | Which source(s) to include (further limited by token scopes) |
| `limit` | integer | `20` | 1–50 | Max items to return per request |
| `offset` | integer | `0` | ≥ 0 | Pagination offset |
| `force` | boolean | `false` | `true` | Include already-processed items |

**Request:**

```bash
curl -H "Authorization: Bearer <ai-daemon-token>" \
  "https://d11.me/api/ai/queue?source=all&limit=10"
```

**Response:**

```json
{
  "items": [
    {
      "source": "rss",
      "id": 101,
      "url": "https://example.com/article",
      "title": "Some Article Title",
      "body": "Original RSS feed description text.",
      "tags": ["tech", "news"],
      "created_at": "2026-04-22T08:30:00Z",
      "context": { "feed_name": "Hacker News" }
    },
    {
      "source": "bookmark",
      "id": 42,
      "url": "https://example.com/post",
      "title": "A saved bookmark",
      "body": "User's manually written description.",
      "tags": ["reading", "tools"],
      "created_at": "2026-04-20T14:00:00Z",
      "context": { "user_id": 3 }
    }
  ],
  "count": 2,
  "total_pending": 342,
  "source_breakdown": { "rss": 290, "bookmarks": 52 }
}
```

**Field notes:**
- `source` — `"rss"` or `"bookmark"`; use this in the PATCH request to route writes correctly
- `body` — the text to summarize: `summary` for RSS items, `short_description` for bookmarks
- `tags` — normalized existing tags (colon sort-suffixes stripped, lowercased, deduplicated)
- `created_at` — `published_at` for RSS items, `created_at` for bookmarks
- `context` — RSS: `{ feed_name }`, bookmark: `{ user_id }`
- `total_pending` — total unprocessed items across both sources (respects `force`)
- `source_breakdown` — per-source pending counts
- Bookmark items are only returned if `is_public = 1` OR the bookmark owner has `ai_allow_private = 1`

---

#### `PATCH /api/ai/items`

Writes AI-generated tags and/or a summary back for a batch of items. Stamped with `ai_processed_at = now()` so items are not returned by `/api/ai/queue` again (unless `force=true`).

**Request body:** JSON array of item update objects. Maximum 50 items per request.

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `source` | string | Yes | `"rss"` or `"bookmark"` | Routes the write to the correct table |
| `id` | integer | Yes | Positive integer matching a row in the source table | Item ID from `/api/ai/queue` |
| `ai_tags` | string[] | No | Array of lowercase tag strings | AI-generated topic tags (additive alongside existing tags) |
| `ai_summary` | string | No | Max 2000 characters | Clean AI-generated summary |

Either `ai_tags` or `ai_summary` (or both) may be provided per item. Omitted fields are stored as `NULL`.

The token must hold the scope matching each item's `source`: `ai:process:rss` for RSS items, `ai:process:bookmarks` for bookmarks. The legacy `ai:process` scope covers both. If any item in the batch fails scope validation, the entire batch is rejected.

**Request:**

```bash
curl -s -X PATCH https://d11.me/api/ai/items \
  -H "Authorization: Bearer <ai-daemon-token>" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "source": "rss",
      "id": 101,
      "ai_tags": ["cloudflare", "workers", "performance"],
      "ai_summary": "Cloudflare announces a new feature for Workers that improves cold start performance by 40%."
    },
    {
      "source": "bookmark",
      "id": 42,
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
| `400` | `{ "error": "Each item must have source 'rss' or 'bookmark'" }` | `source` missing or invalid |
| `400` | `{ "error": "Each item must have a positive integer id" }` | `id` missing, not an integer, or < 1 |
| `400` | `{ "error": "ai_tags must be an array" }` | `ai_tags` present but not an array |
| `400` | `{ "error": "ai_summary must be a string" }` | `ai_summary` present but not a string |
| `400` | `{ "error": "ai_summary too long (max 2000 chars)" }` | `ai_summary` exceeds 2000 characters |
| `403` | `{ "error": "Forbidden", "hint": "..." }` | Token missing or lacks required scope |
| `403` | `{ "error": "Token lacks ai:process:rss scope" }` | RSS item in batch but token only has bookmarks scope |
| `403` | `{ "error": "Token lacks ai:process:bookmarks scope" }` | Bookmark item in batch but token only has RSS scope |

---

### Daemon workflow

The recommended polling loop:

1. `GET /api/ai/queue?source=all&limit=20` — fetch a batch of RSS items and bookmarks
2. For each item, run your LLM to generate tags and a summary
3. `PATCH /api/ai/items` — push results back in one batch request (include `source` per item)
4. Repeat until `count` in the queue response is `0`, then sleep and poll again

Once `ai_summary` or `ai_tags` are written back, the UI will immediately surface the AI output alongside the original data for any visitor who loads the page.

---

### Bun.js daemon example

```js
// daemon.js — run with: bun daemon.js
const BASE    = "https://d11.me/api/ai"
const HEADERS = {
  "Authorization": `Bearer ${process.env.D11_AI_TOKEN}`,
  "Content-Type": "application/json",
}

/** Replace with your actual LLM call. */
function processItem(item) {
  return {
    source: item.source,   // required — routes write to rss_items or bookmarks
    id: item.id,
    ai_tags: ["example", "tag"],
    ai_summary: `AI summary of: ${item.title}`,
  }
}

while (true) {
  const data = await fetch(`${BASE}/queue?source=all&limit=20`, { headers: HEADERS }).then(r => r.json())

  if (data.count === 0) {
    await Bun.sleep(60_000)
    continue
  }

  const results = data.items.map(processItem)

  const { updated } = await fetch(`${BASE}/items`, {
    method: "PATCH",
    headers: HEADERS,
    body: JSON.stringify(results),
  }).then(r => r.json())

  console.log(`Updated ${updated} items (${data.source_breakdown.rss} rss, ${data.source_breakdown.bookmarks} bookmarks pending)`)
}
```

---

## Security notes

- **Tokens are never stored in plain text.** Plain tokens (session and API) are shown exactly once and then discarded. Only SHA-256 hashes are stored in D1.
- **`TOKEN_SECRET`** is a Wrangler secret (not in `[vars]`), never committed to source control.
- All `/api/bookmarks/*` and `/api/v1/*` routes require a valid Bearer token.
- API tokens (`api_tokens` table) are separate from session tokens and can be revoked individually without affecting the browser session.
- Token management endpoints (`POST /api/v1/tokens`, `DELETE /api/v1/tokens/:id`) require the session token — an API token cannot mint or revoke other tokens.
- Public bookmarks are readable by anyone via the redirect endpoint; private bookmarks return 404 to unauthenticated callers.
- AI daemon tokens should use `ai:process:rss` and/or `ai:process:bookmarks` scopes — do not grant `*` scope to automated processes.
