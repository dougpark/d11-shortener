
## Admin API Tokens
- BREAD
- expire
- Rotate? 


## Admin RSS Feeds
- BREAD


---

**3. Admin RSS Feeds BREAD**

This is the most immediately useful given the work we just did. Admin can:
- List all feeds with last_fetched_at, item count
- Add new feed (insert into rss_feeds)
- Edit name / toggle is_active (pause a feed without deleting)
- Delete feed (cascade-delete its rss_items)

No code needed to seed feeds via wrangler commands anymore.

**5. Admin API Tokens BREAD**

### API Token Thoughts:
- some are global like RSS and bookmarks

- some are per user like the personal API tokens for accessing private bookmarks via the API or a CLI tool.

- scope definitions - how to select on create or do we just have a list of possbiel scopes and then assign them to tokens?

- should users be able to create their own API tokens? what scopes - read only, read/write, etc. - what UI would they use to manage them?

- global api tokens can do rss, bookmarks or all

- do we keep tokens so can reuse them or help users with their tokens?

- what does rotate really mean? do we just create a new token and delete the old one? or do we update the token value in place?

### UI

List all tokens across all users (useful for the daemon token scenario we just discussed). Revoke any token. 
- set token scope

- can a user set their own api tokens? what are valid scopes? 
- access their own bookmarks public and private
- add new personal bookmarks
- public api for public bookmarks by user or tag?



Locked in. Here's the finalized plan:

---

## Build Plan: API Token Management

### Part 1 — Admin panel: API Tokens section

New collapsible **API Tokens** section in admin.html (lazy-loaded, same pattern as Users/Feeds):

- List all tokens across all users, sorted by `created_at DESC`
- Each row:
  - Row 1: token name + `@owner` handle + scope pills + **Revoke** button
  - Row 2: last used (relative), expires, created date
- No create form — admin creates their own tokens in the dashboard like everyone else
- Needs a new backend route: `GET /api/admin/tokens` — joins `api_tokens` with `users` to include `slug_prefix`

---

### Part 2 — User dashboard: Token management drawer

New **API Tokens** item in the user menu → opens a full drawer/modal (not a small dropdown, since there's a create form):

**Token list** in the drawer:
- Each token card: name + scope pills + last used + expires + **Revoke** | **Rotate** buttons
- Empty state: "No tokens yet. Create one below."

**Create token form** (bottom of drawer):
- Name text input
- Scope checkboxes:
  - ☑ Read bookmarks (`posts:read`)
  - ☑ Read tags (`tags:read`)
  - ☐ Write bookmarks (`posts:write`) — greyed out, labelled "coming soon"
  - Admins only: ☐ AI: RSS (`ai:process:rss`), ☐ AI: Bookmarks (`ai:process:bookmarks`)
- Expiry dropdown: **Never** / 30 days / 90 days / 1 year
- **Create Token** button

**After create** → one-time token modal (same style as registration token reveal): large copyable token, "Save this now — it won't be shown again", **Done** button closes and refreshes list.

**Rotate** = single button that: revokes the old token, creates a new one with same name + scopes + expiry, shows the new token in the one-time modal. No separate confirm — the modal itself is the confirmation step.

**Token limit**: backend enforces max 10 for non-admin users (`403` with a clear message if exceeded). Admin users unlimited.

---

### Backend changes needed

| Route | Notes |
|---|---|
| `GET /api/admin/tokens` | All tokens + owner handle, sorted by created DESC |
| `DELETE /api/admin/tokens/:id` | Admin force-revoke any user's token |
| `POST /api/auth/tokens/rotate/:id` | Revoke + re-create with same name/scopes/expiry, return new raw token |
| Enforce limit in `POST /api/v1/tokens` | Count existing user tokens, reject if ≥ 10 (skip for admins) |

The existing `GET/POST/DELETE /api/v1/tokens` routes already handle the user-side list/create/revoke — rotate and the admin view are the only new server work.

---
# API Tokens

Created 4 todos

Read [](file:///Users/dougpark/Projects/d11-lumin/src/routes/v1.ts#1-1), lines 1 to 80

Searched for text `DELETE /api/admin/users` (`**/src/index.ts`), 1 result

Read [](file:///Users/dougpark/Projects/d11-lumin/src/routes/v1.ts#155-155), lines 155 to 244

Read [](file:///Users/dougpark/Projects/d11-lumin/src/db/api_tokens.ts#1-1), lines 1 to 50

Read [](file:///Users/dougpark/Projects/d11-lumin/src/db/api_tokens.ts#50-50), lines 50 to 74

Now let me read the app.html user menu area to understand where to hook in the token drawer: 

Searched for text `Copy Login Link|Rename Tag|user-menu|dropdown|Sign Out|Export` (`**/src/client/app.html`), 20 results

Read [](file:///Users/dougpark/Projects/d11-lumin/src/client/app.html#825-825), lines 825 to 900

Read [](file:///Users/dougpark/Projects/d11-lumin/src/client/app.html#1015-1015), lines 1015 to 1070

Now let me look at an existing modal in app.html to match the style for the token drawer:  

Read [](file:///Users/dougpark/Projects/d11-lumin/src/client/app.html#720-720), lines 720 to 800

Now let me check where `copyLoginLink` and the `doLogout` functions are defined for insertion context:   

Searched for text `function copyLoginLink|function doLogout|function toggleUserMenu` (`**/src/client/app.html`), 3 results

Read [](file:///Users/dougpark/Projects/d11-lumin/src/client/app.html#1490-1490), lines 1490 to 1510

Now I have everything I need. Let me build all three parts: 

Starting: *Add backend token routes* (1/4)

**Step 1 — Backend: add rotate, admin routes, and enforce limit** 

Replacing 51 lines with 103 lines in [](file:///Users/dougpark/Projects/d11-lumin/src/routes/v1.ts)


```

```
Now add the admin token routes to index.ts:  

Searched for text `POST /api/admin/feeds/:id/fetch` (`**/src/index.ts`), 1 result

Read [](file:///Users/dougpark/Projects/d11-lumin/src/index.ts#960-960), lines 960 to 980

Replacing 2 lines with 36 lines in [](file:///Users/dougpark/Projects/d11-lumin/src/index.ts)


```

```


Checked [](file:///Users/dougpark/Projects/d11-lumin/src/index.ts), [](file:///Users/dougpark/Projects/d11-lumin/src/routes/v1.ts), no problems found

Starting: *Add API Tokens section to admin.html* (2/4)

**Step 2 — Admin.html: API Tokens section**  

Read [](file:///Users/dougpark/Projects/d11-lumin/src/client/admin.html#205-205), lines 205 to 230

Replacing 2 lines with 23 lines in [](file:///Users/dougpark/Projects/d11-lumin/src/client/admin.html)


```

```
Now add the lazy-load hook and JS functions for tokens:   

Replacing 2 lines with 3 lines in [](file:///Users/dougpark/Projects/d11-lumin/src/client/admin.html)


```

```
Now add the admin token JS functions before `boot()`:   

Replacing 1 lines with 73 lines in [](file:///Users/dougpark/Projects/d11-lumin/src/client/admin.html)


```

```


Starting: *Add token drawer to app.html* (3/4)

**Step 3 — app.html: token drawer + one-time reveal modal**

First the HTML — add the drawer and modal before the dashboard view, and "API Tokens" to both menus:   

Replacing 10 lines with 105 lines in [](file:///Users/dougpark/Projects/d11-lumin/src/client/app.html)


```

```
Now add the JS functions for the token drawer. Find a good insertion point:    

Read [](file:///Users/dougpark/Projects/d11-lumin/src/client/app.html#1510-1510), lines 1510 to 1548

Read [](file:///Users/dougpark/Projects/d11-lumin/src/client/app.html#1540-1540), lines 1540 to 1572

Read [](file:///Users/dougpark/Projects/d11-lumin/src/client/app.html#1615-1615), lines 1615 to 1650

Read [](file:///Users/dougpark/Projects/d11-lumin/src/client/app.html#1660-1660), lines 1660 to 1690

Now insert the token drawer JS after `openImportFile`:     

Replacing 4 lines with 152 lines in [](file:///Users/dougpark/Projects/d11-lumin/src/client/app.html)


```

```
Compacted conversationNow verify there are no obvious issues and check the current state of the token drawer HTML to make sure the element IDs match: 

Searched for text `token-drawer|reveal-token|scope-ai-group|token-create-error|token-drawer-loading|token-drawer-empty|token-drawer-error` (`**/src/client/app.html`), 20 results

IDs all match. Now also check that the `token-drawer-list` insert logic is correct — new cards were being `appendChild`'d to `listEl`, which puts them after the static divs. Let me verify the HTML structure: 

Read [](file:///Users/dougpark/Projects/d11-lumin/src/client/app.html#733-733), lines 733 to 740

Good — loading spinner is first, then cards get appended after. The static sentinel divs are hidden when cards are shown, so the visual order is fine. Deploy: 

Ran terminal command:  bun run deploy 2>&1 | tail -30

Deployed. The token drawer JS functions are now live in app.html with:

- **`openTokenDrawer()`** — shows drawer, auto-reveals AI scope checkboxes for admins, calls `loadTokenList()`
- **`closeTokenDrawer()`** — hides drawer
- **`loadTokenList()`** — `GET /api/v1/tokens`, clears `.token-card` elements, renders two-line cards with Rotate + Revoke buttons
- **`doCreateToken()`** — validates name/scopes, computes ISO expiry, `POST /api/v1/tokens`, opens reveal modal
- **`doRevokeToken(id)`** — confirm → `DELETE /api/v1/tokens/:id` → reload list
- **`doRotateToken(id)`** — `POST /api/v1/tokens/:id/rotate` → opens reveal modal → reload list
- **`showTokenReveal(rawToken)`** / **`closeTokenReveal()`** / **`copyRevealToken()`** — one-time token reveal
