# Requirements

Build a Cloudflare worker with Hono and D1 server app with an html/js/css front end
use Bun.js and Wrangler

## Goal

Create a user friendly on-line bookmark site similar to Pinboard in functionality. With the additional feature of accessing that bookmark url with a short_link user provided name. Ex. d11.me/l/cowboys which would then link to the attached full url and show that page in the users browser.

The client should have a token based authentication. 
The client should provide a list of their bookmarked url's with: copy,edit, delete, public/private buttons.

A route so that users can send their slug (short link) and have it forward to linked url.

## Domain name
d11.me

# Server

## D1 database
Store at least the following:

#### Bookmarks table
	current_date timestamp
	user_id_token
	public boolean
	tag_list  simple JSON array column in D1
	url
	short_description : user provided or ai summary
	full_text : future place to store entire cleaned up page
	slug: short link
	hit_count (Integer): Track how many times a link has been clicked.
    last_accessed (Timestamp): Useful for finding "dead" or forgotten bookmarks.
    title (Text): Separate from the description. You should ideally fetch the <title> tag from the URL automatically when adding it.
    favicon_url (Text): Storing a link to the site's favicon makes the UI list look much more professional.
    is_archived (Boolean): For items you want to keep but hide from your primary "active" list.

#### User table
	user_id token
	slug_prefix : a user defined "name" to use as a prefix for their slugs, keeps the slugs globally unique
	full_name
	email
	phone
	
## API Routes

	add (with token and url, tags, short_description)
	
	list (with token) to list all stored urls (with ability to sort on creation date, site, tag)
	
	`GET /:slug`**: The primary redirector.
    
	    _Logic:_ Look up slug → increment `hit_count` → `301` or `302` redirect.
        
	`PATCH /api/bookmark/:id`: For the "edit" functionality.
    
	`DELETE /api/bookmark/:id`: For the "delete" functionality.
    
	`GET /api/tags`: Returns a unique list of all tags you’ve used (great for a sidebar filter).
    
	`GET /api/preview?url=...`: A helper route that fetches the title and description of a URL so the "Add Bookmark" form can auto-fill.

---

## 1. Refining the "Slug" (Terminology)

"Slug" is technically correct but feels like "developer-speak." For a user-friendly UI, you might call it:

- **Short Link**
 
### Tagging Strategy

Instead of a comma-separated string in `tag_list`, consider a separate `tags` table and a mapping table if you want to perform high-performance filtering by tag in the future. However, for a personal tool, a simple **JSON array** column in D1 is often easier to manage with Bun/TypeScript.

---

## 4. Design & UX Ideas

### The "Quick Add" Bookmarklet

Pinboard’s best feature is its bookmarklet. You should create a small snippet of JavaScript that you can drag to your browser's bookmarks bar.

- When clicked, it opens `d11.me/add?url=[current_url]&title=[current_title]` in a small popup window.
    
- This makes "saving" a frictionless experience.
    

### Privacy-First Redirects

Since you have a `public` boolean:

- **Private links:** If someone visits `d11.me/l/secret-stuff` and they aren't logged in (or the link is private), return a 404. This prevents people from "brute-forcing" your short links to see what you've bookmarked.
    
- **Public links:** These redirect normally regardless of auth.
    

### The Frontend Stack

Since you're using Bun and Cloudflare, you can host the frontend directly on the same Worker using **Hono's Static Site Middleware** or by serving a single `index.html`.

- **Tailwind CSS:** Use the CDN or a simple build step to keep the "Pinboard" aesthetic—clean, text-heavy, and fast.
    
- **Lucide Icons:** Use these for the Edit/Delete/Public/Private buttons to keep the UI modern.
    

---

## 5. Technical Flow (Wrangler + D1)

Your directory structure would look something like this:

Plaintext

```
/d11-shortener

├── src/
│   ├── index.ts        # Hono app & API routes
│   └── db/             # D1 helper functions
    -client/
        - index.html
├── public/             # HTML/JS/CSS (Frontend)
├── schema.sql          # Initial D1 table definitions
├── package.json        # Bun config
└── wrangler.toml       # D1 binding & Worker config
```

### Example Redirect Logic (Hono)

TypeScript

```
app.get('/l/:slug', async (c) => {
  const slug = c.req.param('slug');
  const { results } = await c.env.DB.prepare(
    "SELECT url FROM bookmarks WHERE slug = ? LIMIT 1"
  ).bind(slug).all();

  if (results.length > 0) {
    return c.redirect(results[0].url, 302);
  }
  return c.text("Not Found", 404);
});
```



 

## 4. Architectural Considerations for Scale

With "many thousands" of bookmarks, a few things change:

- **Full-Text Search:** D1 doesn't have a native "FTS" (Full Text Search) engine yet. For thousands of bookmarks, a simple `LIKE %query%` will work.
    
- **Pagination:** Your `list` API route **must** use `LIMIT` and `OFFSET`. Loading 5,000 bookmarks into a single HTML table will tank your browser's performance. Use "Infinite Scroll" or standard pagination.
    
- **Slug Collisions:** When auto-generating slugs for thousands of imported bookmarks, ensure your generator has enough entropy (e.g., a 6-character base62 string) to avoid collisions.
    


## 1. The "Path-Namespace" Approach (Recommended)

This is the most common way to handle multiple users. You give each user a short prefix or "handle."

- **Structure:** `d11.me/u/[slug_prefix]/[slug]`
    
- **Example:** `d11.me/u/stephen/git` and `d11.me/u/papa/git`
    
- **Why it works:** The slug only needs to be unique **per user**.
    
- **D1 Implementation:** Your primary key for lookups becomes a composite of `slug_prefix` + `slug`.
    
---

## Technical Implementation: The "Unique Constraint"

Regardless of which UI path you choose, your **D1 Schema** needs to enforce this at the database level to prevent race conditions.

Option A: Per-User Uniqueness (Namespace)


## UI/UX Solution: The "Availability Check"

To make the customization feel "smart" for the user:

1. **Live Validation:** As they type their slug in the Bun/Hono frontend, hit a small `/api/check-slug?q=myslug`endpoint.
    
2. **Visual Feedback:** Show a green checkmark if available, or a red "Taken" message.
    
3. **Suggestions:** If "cowboys" is taken, your API could suggest "cowboys26" or "cowboys-tx" based on availability.
    
Since you are going for a flat structure on a domain as short as `d11.me`, the focus should be on speed and utility. Because you are building this on Cloudflare Workers and D1, you have access to edge computing features that traditional shorteners struggle with.

Here are the essential and "pro" features typically found in high-end URL shorteners, categorized by how you might implement them in your Bun/Hono stack:

### 1. Advanced Redirection Logic
    
- **Expiration Dates:** Set a "TTL" (Time to Live) for a link. After a certain date, the slug becomes available again or redirects to a "Link Expired" page. Great for temporary shares.
    

### 2. Analytics & Tracking (The "Data" Side)

Since you are a data-driven developer, this is where you can have the most fun with D1:

- **Referrer Tracking:** Record where the click came from (Twitter, an email, or a direct hit).
    
- **Click Heatmaps:** Track clicks over time (hourly/daily) to see when your links are most active.
    
- **QR Code Generation:** Every time a slug is created, have your frontend generate a matching QR code. This is a staple for modern shorteners.
    


### 4. Integration Features

- **Browser Extension / Bookmarklet:** As mentioned before, a one-click way to grab the current tab and generate a `d11.me` link.
    
- **API for Automation:** Since you use Bun and TypeScript, you can easily write a CLI tool or a Raycast/Alfred macro that takes a URL from your clipboard and returns a shortened `d11.me` link instantly.
    
- **Open Graph (OG) Previews:** When you share `d11.me/cowboys` on Discord or Slack, the Worker can serve specific meta tags so the "preview card" shows the title and description you saved in D1, rather than just a raw link.
    

### 5. Management Features 

- **Mass Edit/Tags:** The ability to select 50 bookmarks and add the tag `#research` to all of them at once.
    


### Implementation Tip for "Flat" Availability

To make the "as they type" availability check feel instantaneous:

1. In your Hono app, create a `GET /api/check/:slug` route.
    
2. Use a **Debounce** function in your JavaScript (wait 300ms after the user stops typing) before hitting the API.
    
3. In D1, ensure you have an **Index** on the `slug` column. This makes the "check" a sub-millisecond operation even with 10,000+ bookmarks.
    

## 1. Open Graph (OG) Previews

When you paste a link into Discord, Slack, or iMessage, the app "unfurls" it to show a nice card with an image, title, and description. Usually, a shortener just redirects the bot, and the bot has to follow the redirect to find the metadata.

By handling OG tags yourself, you control exactly how your shared links look.

### How it works in a Worker

Instead of a blind `302` redirect, your Worker checks the `User-Agent` header. If it’s a bot (like `Twitterbot` or `Slackbot`), you serve a tiny HTML page with meta tags. If it’s a human, you send the redirect.

**The Logic:**

1. **Request comes in:** `d11.me/l/cowboys`
    
2. **Check User-Agent:** Is it a crawler?
    
3. **If Bot:** Fetch the `title`, `short_description`, and perhaps a `thumbnail_url` from your D1 database.
    
4. **Serve HTML:**
    
    HTML
    
    ```
    <meta property="og:title" content="Dallas Cowboys Schedule">
    <meta property="og:description" content="My filtered view of the upcoming season.">
    <meta property="og:image" content="https://d11.me/assets/cowboys-thumb.jpg">
    <meta name="twitter:card" content="summary_large_image">
    ```
    
5. **If Human:** Proceed with the standard `302` redirect to the destination.
    

