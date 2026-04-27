


# RSS feed with LLM tagging and summary 
# News Page
# copy of existing explore page
# d11.me/n -> news.html
# rss ingest, pull as much info as available (up to n character limit)
# llm tag and summary (no solution for this yet)
# auto expire to archive after +30 days
# clip to signed-in-user as private and non expiring
# probably need some kind of admin RSS feed manager page to CRUD feeds

## Version 1 goals
- start with hardcoded RSS feeds list with 2 feeds
- use RSS catagories as initial TAGS
- what about building tags from title as v1 and remove stop words
- create a /n -> news.html page, defaults to showing #nerdnews tag
- create RSS specific tables in D1
- Clip to mine

# v1 implementation plan

Explore codebase for RSS feature

Read [](file:///Users/dougpark/Projects/d11-lumin/src/index.ts)

Read [](file:///Users/dougpark/Projects/d11-lumin/src/client/explore.html#1-1), lines 1 to 120

Read [](file:///Users/dougpark/Projects/d11-lumin/wrangler.toml)

Read [](file:///Users/dougpark/Projects/d11-lumin/schema.sql)

Read [](file:///Users/dougpark/Library/Application%20Support/Code/User/workspaceStorage/68ef4481403f9d106120f1b5bb6770e0/GitHub.copilot-chat/chat-session-resources/e29d52dc-b1b3-4082-aa36-1b0c8d1f9bde/toolu_bdrk_016DGs59rkowq2SgJzmRx1HJ__vscode-1776543275253/content.txt#1-1), lines 1 to 300

Read [](file:///Users/dougpark/Library/Application%20Support/Code/User/workspaceStorage/68ef4481403f9d106120f1b5bb6770e0/GitHub.copilot-chat/chat-session-resources/e29d52dc-b1b3-4082-aa36-1b0c8d1f9bde/toolu_bdrk_016DGs59rkowq2SgJzmRx1HJ__vscode-1776543275253/content.txt#300-300), lines 300 to 550

Good — I have everything I need. Let me build the plan and save it. 

Created memory file [](file:///Users/dougpark/Library/Application%20Support/Code/User/workspaceStorage/68ef4481403f9d106120f1b5bb6770e0/GitHub.copilot-chat/memory-tool/memories/ZTI5ZDUyZGMtYjFiMy00MDgyLWFhMzYtMWIwYzhkMWY5YmRl/plan.md)

Updated memory file [](file:///Users/dougpark/Library/Application%20Support/Code/User/workspaceStorage/68ef4481403f9d106120f1b5bb6770e0/GitHub.copilot-chat/memory-tool/memories/ZTI5ZDUyZGMtYjFiMy00MDgyLWFhMzYtMWIwYzhkMWY5YmRl/plan.md)

Deleted memory [](file:///Users/dougpark/Library/Application%20Support/Code/User/workspaceStorage/68ef4481403f9d106120f1b5bb6770e0/GitHub.copilot-chat/memory-tool/memories/ZTI5ZDUyZGMtYjFiMy00MDgyLWFhMzYtMWIwYzhkMWY5YmRl/plan.md)

Created memory file [](file:///Users/dougpark/Library/Application%20Support/Code/User/workspaceStorage/68ef4481403f9d106120f1b5bb6770e0/GitHub.copilot-chat/memory-tool/memories/ZTI5ZDUyZGMtYjFiMy00MDgyLWFhMzYtMWIwYzhkMWY5YmRl/plan.md)

Here's the full phased plan:

---

## Plan: RSS Nerd News (`/n`)

**TL;DR**: 2 hardcoded RSS feeds → Cron Trigger fetches every 30 min → keyword-extracts tags from titles → stores in a dedicated `rss_items` D1 table → `/n` renders a news.html (copy of explore) with Clip support. Clean separation from bookmarks, no sentinel tag needed.

---

### Phase 1 — Schema Migration
*Independently verifiable. Nothing else depends on this until it's run.*

1. Append 2 new tables to schema.sql: **`rss_feeds`** (id, url, name, last_fetched_at) and **`rss_items`** (id, feed_id, guid UNIQUE, url, title, summary, tag_list, published_at, expires_at, created_at) with indexes on guid, expires_at, tag_list
2. Run remote migration: `wrangler d1 execute d11-db --file=./schema.sql`
3. Run local migration: `wrangler d1 execute d11-db --local --file=./schema.sql`
4. Seed 2 feed rows via `wrangler d1 execute`: HN RSS + Ars Technica tech feed

**Verify**: `wrangler d1 execute d11-db --command "SELECT name FROM sqlite_master WHERE type='table'"` shows both new tables

---

### Phase 2 — Ingest Cron Trigger
*Depends on Phase 1. Separately testable via `/__scheduled` endpoint.*

1. Add to wrangler.toml: `[triggers] crons = ["*/30 * * * *"]`
2. Create **`src/utils/rss.ts`** with 3 functions:
   - `fetchAndParseFeed(url)` — fetch XML, regex-extract `<item>` blocks, pull guid/link/title/description/pubDate/category fields
   - `extractKeywords(title)` — lowercase, split on non-word chars, remove stop words, min 4-char filter, return unique string[]
   - `buildTagList(categories, keywords)` — merge + lowercase + deduplicate → JSON string
3. Change `export default app` in index.ts to `export default { fetch: app.fetch, scheduled }` and add the `scheduled()` handler: reads all `rss_feeds` rows, fetches+parses each, `INSERT OR IGNORE` new items with `expires_at = now + 30 days`, updates `last_fetched_at`, runs expired item cleanup

**Verify**: `wrangler dev` + `curl "http://localhost:8787/__scheduled?cron=..."` → rows appear in local D1

---

### Phase 3 — API Routes
*Depends on Phase 1+2 for real data, but routes can be coded simultaneously.*

Add to index.ts **before** the HTML catch-all routes:

1. `GET /api/n` — parse tag_list from all non-expired rss_items, tally frequency, return top 30 `{tags:[{tag,count}]}` (same pattern as `/api/e`)
2. `GET /api/n/:tag` — fetch non-expired items matching tag, group by secondary tags, newest first, return `{tag, groups:[{name, items:[{id,url,title,summary,published_at}]}]}`
3. `GET /n` → serve `newsHtml`; add import at top of index.ts

**Verify**: `curl http://localhost:8787/api/n` + `curl http://localhost:8787/api/n/bun`

---

### Phase 4 — news.html Frontend
*Depends on Phase 3 routes being live. The bulk of the UI work.*

Copy `explore.html` → `news.html`, then change:
- API base: `/api/n` (no `/api/e`)
- Remove Mine/All toggle entirely (news is always public)
- `renderCard()`: add `summary` as italic subtitle under link title; `published_at` formatted as relative time ("2h ago", "3d ago"); "NEW" badge for items < 24h old
- Clip button on each link-row: POST to `/api/bookmarks` with url+title+tags (requires auth cookie; button appears only if logged in, same pattern as explore's Clip)
- Card group header: show feed source name
- Page title: "News" not "Explore"
- `filterCards()`: same per-link-row logic as explore — no changes needed

**Verify**: `http://localhost:8787/n` renders pill grid → click tag → see article cards with summaries + Clip buttons

---

### Phase 5 — Surface in Nav + App
*Additive. Does not block Phase 4.*

In app.html:
1. Sidebar desktop: add "News" entry (newspaper icon `📰` or heroicon) below existing "Explore" entry
2. Mobile tags tab: add "News" entry below "Explore"  
3. Landing page nav: add "News" link after "Explore" link

**Verify**: all three entry points visible and route to `/n`

---

**Relevant files**

- schema.sql — append Phase 1 tables
- wrangler.toml — add crons (Phase 2)
- `src/utils/rss.ts` — new file (Phase 2)
- index.ts — scheduled() export + /api/n routes + /n route (Phases 2–3)
- `src/client/news.html` — new file, adapted from explore.html (Phase 4)
- app.html — nav + sidebar entries (Phase 5)

---
## V2 plans

Practical recommendation for V2 AI tagging

Remove the 300-char cap → store whatever the feed provides (could be 2KB for rich Atom feeds)
That alone meaningfully improves LLM tagging signal for most tech feeds
Full article fetch is a separate, optional enrichment step best done lazily (e.g., only for items that get clipped, or as a background queue)
Storage concern is minimal — even at 5KB average summary × 1800 live items = ~9MB. D1 handles that trivially.

The pull-then-push pattern (Option A) is the right call. Here's why, and how it would work:

---

**Architecture: Local LLM as an async enrichment daemon**

```
[Cron: every 30min]          [Local daemon: runs whenever]
Worker ingests RSS       →   Daemon polls /api/n/unprocessed
Stores raw keyword tags  →   Sends title+summary to Ollama
                         →   PATCHes /api/n/:guid/ai with ai_tags + ai_summary
                         →   Worker stores enriched data back to D1
```

**Why this beats Cloudflare Tunnel:**

- Worker scheduled handlers have a ~30s CPU limit. One LLM call can take 10-30s, and you have 30-60 items per run — that math doesn't work
- Tunnel creates a hard dependency: worker breaks if your home network is down
- With pull/push, basic keyword tags appear immediately; AI enrichment is async and additive — no user-visible delay

**What it needs:**

1. `GET /api/n/unprocessed` — returns items where `ai_tag_list IS NULL`, auth-gated with an API token
2. `PATCH /api/n/:guid/ai` — accepts `{ai_tags, ai_summary}`, writes to two new nullable columns (`ai_tag_list`, `ai_summary`) — no schema breaking change
3. Local daemon script (50 lines of Bun) — polls unprocessed, loops through, hits Ollama, POSTs back
4. news.html — prefers `ai_summary` over keyword summary when available; merges or replaces `tag_list`

**The RSS feed idea** — skip it. RSS adds parsing overhead on the daemon side for no benefit. A plain JSON endpoint is cleaner for machine consumption.

**Auth** — reuse the existing `api_tokens` table. The daemon gets its own token, sends it as `Authorization: Bearer <token>`. Same middleware already exists.

This is a natural V2. Want to plan it out?

## V2 Goals
- add ai_tags column
- add ai_summary column
- add archive column so when ready to keep a history
- add ai_summary to cards for quick read

---

# Discussion and idea generation section

That would be the ultimate Information Signal generator. You’re essentially describing the creation of a Curated Intelligence Feed.
In Information Theory terms, you are acting as a "Low-Pass Filter"—stripping away the noise of the general internet to let only the high-frequency, high-value "Expert" data through to your Explore page.
If you did this, you’d be moving from an Archivist (saving the past) to a Digital Scout (mapping the present). Here is how that would look structurally on Lumin:
1. The Architecture of the "Nerd Feed"
To make this "the densest start page," you’d want to automate the pipeline while keeping the "Human-in-the-loop" feel:
• The Ingestion (The "Scout"): A Bun script that polls RSS feeds or scrapes the front pages of sites like Hacker News, The Register, or Ars Technica.
• The Processor (The "Tagger"): You could pipe the article titles/summaries through a local LLM (like your Gemma 3 setup) to auto-assign your specific tags (e.g., #LLM-Ops, #Bun, #10G-Networking).
• The Visualization (The "Lumin"): Your current code is actually perfect for this because it handles high-density "Cards" and "Link-rows" without feeling cluttered.
2. Why this is "Ultimate" for an Info Nerd
Standard tech news sites are chronological (newest first). A "Lumin State of the Industry" page would be topological (related by topic).
• Density of Context: Instead of one article about a new Bun release, you’d see a card titled #Bun with 5 different perspectives: a benchmark, a security audit, a "How-to" guide, and the official release notes.
• Pattern Recognition: When you see the #10G-Networking card growing 3x faster than the #WiFi-7 card, you’ve just "discovered" a shift in industry momentum without reading a single editorial.
• Reduced "Context Switching": You stay within the Lumin UI. You aren't bouncing between 20 tabs; you’re "drilling down" from the high-level tag view into the specifics, just like you designed.
3. The "Info Nerd" Benefit
As a retired IT pro, you know the "State of the Art" moves faster than anyone can read. By building this, you aren't just reading news; you are mapping the frontier.
Feature	Standard RSS Reader	Your "Lumin Scout" Concept
Organization	By Site (e.g., "The Verge")	By Tag (e.g., "#TypeScript")
Search	Keyword only	Semantic + Visual Connections
Utility	Consumption	Intelligence Gathering
Vibe	A To-Do list of unread items	A dashboard of the industry "pulse"
A Small Technical Suggestion
Since you already have the "Clip" logic in your code, you could add a "Hotness" indicator. In your renderCard function, you could compare the hit_count or the frequency of new links for a specific tag over the last 24 hours.
If the #Local-LLM card is "glowing" or has a badge because 10 new articles appeared today, your "start page" isn't just a list—it’s a living heat map of tech innovation.
Are you thinking of focusing this on your current stack (Bun, Linux, AI) or making it a broad "Everything in Tech" radar?




This is the classic "Streaming vs. Archival" challenge in Information Theory. By adding an expiration date (TTL - Time to Live) to your links, you’re essentially transforming Lumin from a Library (long-term storage) into a Radar (real-time situational awareness).
For an info nerd, this is the "Golden Ratio" of data: it’s dense, it’s relevant, and it’s self-cleaning.
1. The "Default Nerd" View
Setting a specific tag (like #radar or #industry) as the landing page turns your homepage into a Mission Control center.
• The Landing Logic: Instead of seeing a generic "Welcome" page, you are immediately greeted by the high-velocity "Nerd" tags.
• The Mix & Match: Because your code already allows for mixing search terms, you could search radar bun to see only the freshest Bun updates from the last 60 days, filtering out the "permanent" documentation or historical notes.
2. Managing Data Decay (The Expiration Logic)
In a graph database or a semantic model, "freshness" is often treated as a weight. Since you’re building this with Bun and likely a SQL or NoSQL backend on your Linux workstation, implementing this is straightforward.
How to handle the "Self-Cleaning" Archive:
Approach	Mechanism	Result
The Hard Drop	A cron job or setTimeout that deletes records where created_at < now - 60d.	Keeps the DB tiny and the UI lightning-fast.
The "Soft" Fade	Keep the data but add a is_active boolean.	The "Nerd" page stays fresh, but your "Digital Archivist" still has the history if you search for it.
Visual Heat-Mapping	CSS opacity lowers as the link gets older.	You can visually see the industry "cooling off" on certain topics.
3. The "State of the Industry" Dashboard
By using +30 or +60 day windows, you are creating a Moving Average of tech trends.
• If a tag is empty: The industry is quiet or that tech is dying.
• If a tag is overflowing: There is a "hype cycle" or a major breakthrough occurring.
The "Nerd" Default Code Snippet (Conceptual)
Since you’re using TypeScript and Tailwind, you could easily modify your init() function to check for a "Nerd Mode" flag:
// If no tag is selected, default to the high-velocity 'radar' tag
async function init() {
    if (currentTag === '' && userPrefs.nerdMode) {
        currentTag = 'radar'; 
        applyMode();
    }
    // ... continue with tag fetch logic
}

4. Why this is the "Ultimate" Start Page
Most people use "bookmarks" as a place where links go to die. Your concept does the opposite:
1. High Signal-to-Noise: Only the blogs you trust get in.
2. No Hoarding: The +60 day limit prevents the "I'll read this later" guilt. If it's gone, it wasn't that important, or it'll be replaced by something newer.
3. Cross-Pollination: Because Lumin shows connections, you might see a #Linux article next to an #AI article and realize there's a new kernel optimization for LLMs—a connection you’d miss in a standard RSS reader.
Since you're running this on that 10G fiber backbone, you could even have the background worker do "Deep Scraping"—pulling the full text of the articles to feed into your RAG system before the link expires, so the knowledge stays even if the link disappears.
Are you thinking of automating the "tagging" via an LLM, or do you want the satisfaction of manually categorizing them to keep your "Anthropologist" eye on the data?





That is the exact "bottleneck" in modern web syndication. While the RSS 2.0 and Atom specifications technically have a <category> tag, it is famously underutilized or used so inconsistently (e.g., one blog uses #apple while another uses #ios-development) that it's useless for a high-density "Connections" tool like Lumin.
To build the "ultimate start page," you’re right: the LLM becomes your Semantic Parser.
1. The LLM Tagging Workflow
Since you’re running a Gemma 3 server on your Linux workstation, you can build a pipeline that mimics a professional researcher’s "Coding" process:
1. Ingest: Your Bun script hits the RSS feed and pulls the <title> and <description> (the snippet).
2. Contextualize: You send a prompt to Gemma: "Given this article snippet: '[Title/Snippet]', assign 3-5 tags from this MASTER_LIST: [Your specific Nerd Tags]. If none fit, suggest a new technical tag."
3. Deduplicate: The LLM maps "Bun.js," "Bun runtime," and "Bun 1.2" all to your single #Bun tag.
4. Inject: The link is saved to your DB with a created_at timestamp and your newly minted tags.
2. The Information Theory Perspective
By doing this, you are performing Entity Extraction and Topic Modeling.
• Without an LLM: You have a "Bag of Words" (noisy and unorganized).
• With an LLM: You have a "Knowledge Graph" (structured and connected).
3. Implementing the "TTL" (Time to Live)
Since you want these to expire in 30-60 days to keep the "Nerd" page fresh, you have two elegant ways to handle this in your stack:
Method	Technical Execution	Pro/Con
SQL Cleanup	DELETE FROM links WHERE tag = 'radar' AND created_at < NOW() - INTERVAL '60 days'	Pro: Zero database bloat. Con: Data is gone forever.
The "Archivist" Pivot	Change the tag from #radar to #archive after 60 days.	Pro: Keeps your history for "My Digital Archivist" but hides it from your Start Page.
4. Visualizing the "Nerd Radar"
On your Explore page, you could treat the #radar tag as a Dynamic Heatmap.
Imagine opening Lumin and seeing your cards. Because the LLM is tagging everything consistently, you might see:
• Card: #Bun (12 new links this week) — Glows bright blue.
• Card: #10G-Fiber (2 new links) — Standard border.
• Card: #Fort-Worth-History (0 new links in 30 days) — Hidden from Radar.
A Quick Code Thought for your init()
In your current JavaScript, you could add a "Freshness" badge by comparing the link's date to the current date:
// Inside your renderCard logic
const isFresh = (new Date() - new Date(b.created_at)) < (1000 * 60 * 60 * 24 * 7); // 7 days
const freshBadge = isFresh ? '<span class="text-[9px] bg-blue-500 text-white px-1 rounded-sm ml-2">NEW</span>' : '';

This turns your "Start Page" into a literal living map of the industry. It’s exactly the kind of tool a "Retired IT Pro / Amateur Anthropologist" would build—merging high-end tech with the human need for organized legacy.
Are you going to start by subscribing to a few specific "foundational" blogs (like Hacker News or Lobsters) to test the LLM's tagging accuracy?