# d11.me — Bookmark + Link Shortener

A personal bookmark manager with short links, built on **Cloudflare Workers + Hono + D1**.

- Save bookmarks with a short slug: `d11.me/l/cowboys`
- One-click bookmarklet for any page
- Tag, search, archive, and paginate your bookmarks
- Bearer-token auth (token shown once on register, never stored plain)
- Public / private visibility per bookmark

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

## Architecture

```
src/
├── index.ts                 # Worker entry — Hono app, redirect handler, HTML serving
├── middleware/
│   └── authMiddleware.ts    # Bearer → SHA-256 → DB user lookup
├── routes/
│   ├── auth.ts              # POST /api/auth/register, GET /api/auth/me
│   └── bookmarks.ts         # Full CRUD, tag list, slug check, URL preview
├── db/
│   ├── types.ts             # TypeScript row/input types
│   ├── users.ts             # User queries
│   └── bookmarks.ts         # Bookmark queries (list, CRUD, click tracking)
├── utils/
│   ├── auth.ts              # hashToken, generateToken, extractBearer
│   └── preview.ts           # fetchUrlPreview — title, description, favicon
└── client/
    └── app.html             # Single-file SPA (Tailwind CDN, vanilla JS)

schema.sql                   # D1 schema — users, bookmarks, click_events
wrangler.toml                # Cloudflare configuration
```

---

## Security notes

- **Tokens are never stored in plain text.** The plain token is shown to the user exactly once on registration and then discarded. Only the SHA-256 hash is stored in D1.
- **`TOKEN_SECRET`** is a Wrangler secret (not in `[vars]`), never committed to source control.
- All `/api/bookmarks/*` routes require a valid Bearer token via `authMiddleware`.
- Public bookmarks are readable by anyone via the redirect endpoint; private bookmarks return 404 to unauthenticated callers.
