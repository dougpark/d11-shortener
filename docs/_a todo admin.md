# Admin user

- add a new column is_admin to the user table
- wrangler sql update to handle = 'doug' and set to true


## Admin API Tokens
- BREAD
- expire
- Rotate? 

## Admin Handles/users
- BREAD
- approve additional handles/users as admins

## Admin RSS Feeds
- BREAD

## 

# V1 Goals

Read [](file:///Users/dougpark/Projects/d11-lumin/docs/_a%20todo%20admin.md)

Read [](file:///Users/dougpark/Projects/d11-lumin/src/db/users.ts)

Read [](file:///Users/dougpark/Projects/d11-lumin/src/db/types.ts#1-1), lines 1 to 60

Read [](file:///Users/dougpark/Projects/d11-lumin/src/db/api_tokens.ts#1-1), lines 1 to 50

Searched for text `is_admin`, 1 result

Here's my read of the doc and design thinking:

---

## Design Ideas

**1. Schema — `is_admin` flag**

Simple boolean column on `users`. The wrangler command to bootstrap:
```sql
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
UPDATE users SET is_admin = 1 WHERE slug_prefix = 'doug';
```
`User` type gets `is_admin: number`. Auth middleware already fetches the full user row, so `c.get('user').is_admin` is available to every route with zero extra queries.

**2. Admin guard middleware**

A thin `adminMiddleware` that checks `user.is_admin === 1` — same pattern as `authMiddleware`. Applied to an `/admin/*` route group. Clean, single enforcement point.

**3. Admin RSS Feeds BREAD**

This is the most immediately useful given the work we just did. Admin can:
- List all feeds with last_fetched_at, item count
- Add new feed (insert into rss_feeds)
- Edit name / toggle is_active (pause a feed without deleting)
- Delete feed (cascade-delete its rss_items)

No code needed to seed feeds via wrangler commands anymore.

**4. Admin Users BREAD**

List all users, see their bookmark counts, created_at. Ability to delete a user (cascade bookmarks). Probably don't need update for V1 — the main scenario is finding and removing a spam/abuse account.

**5. Admin API Tokens BREAD**

List all tokens across all users (useful for the daemon token scenario we just discussed). Revoke any token. 

---

## Concerns

**Admin UI surface — separate page or panel in app.html?**

Three options:
- **`/admin` route → `admin.html`** — cleanest, clear separation, no risk of leaking admin UI to regular users


Recommendation: separate `admin.html`. Same nav/CSS, just a different entrypoint.


