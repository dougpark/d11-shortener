Read [](file:///Users/dougpark/Projects/d11-lumin/docs/_a%20todo%20prep%20archivest.md)

Read [](file:///Users/dougpark/Projects/d11-lumin/docs)

Read [](file:///Users/dougpark/Projects/d11-lumin/docs/_todo%20full%20text.md)

Read [](file:///Users/dougpark/Projects/d11-lumin/docs/_todo%20global%20search.md)

Read [](file:///Users/dougpark/Projects/d11-lumin/docs/_todo%20AI%20research.md)

Read [](file:///Users/dougpark/Projects/d11-lumin/docs/requirements.md#1-1), lines 1 to 60

Read [](file:///Users/dougpark/Projects/d11-lumin/docs/_todo%20AI%20summary.md)

Read [](file:///Users/dougpark/Projects/d11-lumin/docs/_todo%20read%20later.md)

Read [](file:///Users/dougpark/Projects/d11-lumin/docs/_todo%20collections.md)

Good — I have everything I need. Here is the full design analysis:

---

## Lumin Archivist: Universal Indexer Design Analysis

### What the design doc gets right

The core insight in the doc — **"link the data, don't move it"** — is the correct philosophy for this problem. Lumin should be the index card, not the filing cabinet. The raw_id + origin_type + file_path approach in the schema proposal is sound. The Watchdog/ingest pipeline concept is architecturally clean.

But there are gaps worth thinking through before writing any code.

---

### The fundamental design tension: one table vs. many

The doc proposes adding columns to the existing `bookmarks` table. This works at small scale but creates real problems:

**Single universal table (current proposal):**
- `metadata_json` as a catch-all becomes a black box — you can't filter, index, or search inside it without full JSON parsing on every row
- Every query filtering `origin_type='link'` still scans rows with health metrics, EXIF data, and email headers
- Adding a new source type means either another `ALTER TABLE` or stuffing everything into `metadata_json` forever
- SQLite FTS5 full-text search indexes *columns*, not JSON blobs — AI summaries and email bodies are effectively un-searchable with this schema

**Recommended alternative: a `records` table + typed extension tables**

```
records (universal index)
  id, user_id, origin_type, source_node, raw_id
  title, ai_summary, tag_list
  is_public, is_archived, created_at, updated_at

link_meta   (extends records where origin_type='link')
  url, slug, favicon_url, short_description, hit_count, full_text

email_meta  (extends records where origin_type='email')
  message_id, from_addr, to_addr, subject, body_text, thread_id

file_meta   (extends records where origin_type='file')
  file_path, file_hash, mime_type, file_size, last_modified

health_meta (extends records where origin_type='health')
  metric_type, value, unit, source_device, recorded_at

photo_meta  (extends records where origin_type='photo')
  file_path, lat, lng, captured_at, camera_make, exif_json
```

This lets D1's FTS5 index `records.title`, `records.ai_summary`, and `records.tag_list` across *all* types in one pass. Type-specific queries join to the extension table only when needed. Adding a new source like `calendar` or `sms` is a new table, not a schema mutation.

The tradeoff: joins. On D1 (SQLite), a join on `id` with a small extension table is fast and the query is simple. For a personal-scale system this is not a concern.

---

### The ingest API

The doc's proposal to reuse `POST /api/v1/posts` is pragmatic short-term but will become confused as the surface grows. A cleaner v1 ingest API:

```
POST /api/v1/ingest          — submit any record type (dispatcher by origin_type)
GET  /api/v1/records         — universal query across all types
GET  /api/v1/records/:id     — single record detail (includes extension joins)
PATCH /api/v1/records/:id    — update tags, summary, archive state
DELETE /api/v1/records/:id   — remove record + extension row

GET  /api/v1/nodes           — list all known source_node names + counts
GET  /api/v1/origins         — list all origin_type values + counts (for sidebar)
```

`POST /api/v1/ingest` body shape:

```json
{
  "origin_type": "email",
  "source_node": "ubuntu-ai",
  "raw_id": "msg-id-hash",
  "title": "Re: Invoice Q2",
  "ai_summary": "Bob confirmed payment received...",
  "tags": ["finance", "invoices"],
  "meta": {
    "from": "bob@example.com",
    "subject": "Re: Invoice Q2",
    "body_text": "..."
  }
}
```

The critical addition vs. the doc: **UPSERT by `(user_id, origin_type, raw_id)`** — the doc mentions this but it needs to be a hard constraint at the DB level, not just application logic, to survive retry storms from the Watchdog.

---

### The Watchdog pipeline — what the doc doesn't cover

The doc describes the happy path. The hard parts:

**1. Deduplication beyond raw_id**
Files get renamed, emails get forwarded with new Message-IDs, photos get copied. You need a content hash (`file_hash` = SHA-256 of file bytes) as a secondary dedup key, separate from the path or ID.

**2. Rate limiting the ingest endpoint**
A file watcher on an active machine can generate hundreds of events per second on a directory move. The Watchdog needs a local queue (a simple SQLite on the Ubuntu box) that batches and debounces before calling the remote API. Without this you'll hit Cloudflare's per-Worker request limits.

**3. Node registration**
`source_node` is a free-text string in the proposal. Better to treat nodes as first-class: a `nodes` table with `(id, user_id, name, last_seen_at, record_count)`. This lets you know if a node went offline, and lets the UI show "last synced 3 days ago" warnings.

**4. The privacy boundary**
Health data, private emails, and file paths will be in the same D1 database as public bookmarks. The `is_public` flag on `records` needs to be enforced at the query level — not just the UI — so that `GET /l/:prefix/:slug` never leaks a private email record via the short-link redirect mechanism that currently returns any record by slug.

---

### What APIs are necessary

Beyond the ingest routes above, these become necessary:

| API | Purpose |
|---|---|
| `GET /api/v1/records?origin=email&node=ubuntu-ai&since=...` | Filtered universal query |
| `GET /api/v1/search?q=...` | Full-text across `records` FTS5 index (title + ai_summary + tags) |
| `GET /api/v1/origins` | Return `[{type, count}]` for sidebar source filter |
| `GET /api/v1/nodes` | Return registered nodes + last_seen |
| `POST /api/v1/nodes/heartbeat` | Watchdog calls this periodically so the UI can show node health |
| `GET /api/v1/records/:id/related` | AI-suggested related records (the "Synapse" feature from your collections doc) |
| `POST /api/v1/records/:id/summary` | Trigger async re-summarize via Ollama on the Ubuntu box |

---

### UI additions

**Sidebar changes:**

The current tag-based sidebar needs a second dimension — **Sources**. Natural split:

```
[ All Sources ]
  🔗 Links          (482)
  📧 Email           (891)
  📄 Files          (1,204)
  💬 Messages         (67)
  🏃 Health           (30)
  📷 Photos         (3,412)

[ Filter by Tag ]
  ... existing tag list ...
```

Selecting a source filters the record grid to that type. Selecting a tag inside a source filters further. This two-axis filtering (source × tag) is how you navigate 10,000+ heterogeneous records without drowning.

**Adaptive cards:**

The doc's direction is right — each `origin_type` needs a distinct card template. Key differences beyond what the doc lists:

- **Health cards**: render as a small sparkline or metric display, not a URL card — there's nothing to "open"
- **Photo cards**: thumbnail from R2 or a local proxy, EXIF location as a tag chip
- **File cards**: show `source_node` prominently so you know *which machine* holds it — critical when  links only resolve locally
- **Email cards**: show sender, date, and thread context — the `title` is the subject line but `from_addr` is equally important at a glance

**Search bar evolution:**

The current search targets `title, url, short_description`. Universal search needs to index `ai_summary` and type-specific fields. The key UX question is whether to show one unified results list or grouped results by origin type. **Grouped with a "show all" toggle** tends to work better — searching "invoice" should show both email records and PDF files, but grouped so you know what you're looking at.

**The Node status strip:**

A small dismissible banner or status row in the header showing node health: `ubuntu-ai: last sync 2m ago ✓ | iphone: last sync 4h ago`. This surfaces when something stops reporting without requiring a separate admin page.

---

### What to preserve from the current design

- The tag model is strong and should remain the primary organizational layer across *all* record types — not just links. The Watchdog should always try to auto-assign tags.
- The v1 Bearer token + scopes model maps perfectly onto Watchdog authentication. Each node should get its own named API token (`scope: posts:write`) so individual nodes can be revoked without affecting others.
- The `ai_summary` field in the doc is correct — keep it distinct from `short_description`. User-written descriptions shouldn't be overwritten by LLM output on re-sync.
- The Collections concept from your todo doc (`saved search = d11.me/c/japan-itinerary`) becomes *much more powerful* in this model — a collection that spans emails + files + links about a single project is genuinely useful.

---

### The biggest risk

D1 is a SQLite-at-the-edge product designed for transactional web app data. At 3,000+ photos with EXIF, 10,000+ emails, and full-text bodies, you will hit D1's row storage limits and query performance limits. The design needs a plan for:

- **R2 for blob storage** (photo thumbnails, PDF archives, full email bodies > N kb) — already in your full-text todo doc
- **FTS5 virtual table** for search — standard SQLite but needs to be created explicitly; D1 supports it
- **Pagination discipline** — the Watchdog batch ingest must never try to do a `SELECT *` of all records for dedup; use `raw_id` UPSERT at the DB level instead

The stack can handle this. It just needs the schema to be designed for it from the start rather than retrofitted.




Good instinct on Journal — it's one of the strongest candidates. Here's a full analysis of what makes sense for version 1, organized by value vs. complexity.

---

## Evaluating sources for v1

The best v1 sources share four traits:
1. **You own the export** — no ongoing API dependency on a third party
2. **Natural title + date + optional body** — maps cleanly to the `records` schema
3. **Meaningful link-back** — even a `dayone://`, `message://`, or local file URI counts
4. **AI summary earns its keep** — the raw content is too long/dense to skim in a card

### Strong v1 candidates

**Journal** *(Day One, Obsidian, Apple Notes, Bear)*  
Your suggestion is exactly right — this is the highest-value addition after links. Day One exports to JSON with full text, timestamps, weather, location, and photos. Obsidian is just Markdown files on disk, which the Watchdog can trivially monitor. The card becomes a date-stamped entry with the first paragraph as preview — `ai_summary` shines here because journal entries are long and personal. Link-back is `dayone://view?entryId=<uuid>` or a file path.

**Calendar events** *(Apple Calendar, Google Calendar, iCal)*  
Deeply underrated for an archivist. Calendar events are perfectly structured: title, start/end, notes, attendees, location. They're the *context layer* for everything else — "what was I doing the week I saved all those Kubernetes articles?" Cross-referencing a journal entry or email with nearby calendar events adds real meaning. iCal `.ics` is a universal export format; Apple Calendar even has a live URL export. No AI summary needed — the metadata is already dense.

**Reading highlights** *(Kindle, Readwise, Instapaper, Pocket)*  
This is the most information-dense source you can ingest. A Kindle highlight is: book title, author, chapter, highlight text, your note (optional), timestamp. Readwise has a full export API and syncs highlights from every reading platform. The card would show the highlighted passage + your note + the book title. This directly complements the link archiver — you save the article, then later index your highlights from it.

**Tasks / completed reminders** *(Apple Reminders, Things, OmniFocus, Todoist)*  
Completed tasks are a factual record of what you actually did. Things and OmniFocus have JSON/CSV exports. The insight comes over time: "I completed 40 tasks tagged `home-reno` in March" is genuinely useful retrospective data. Simpler than the others — no body text, just a title + completion date + optional notes + project tag.

**Git commits** *(local repos or GitHub)*  
Developer-specific but very relevant to your stack. A commit is: message, repo, branch, files changed, timestamp. The Watchdog can tail `git log --format=json` across all repos on the Ubuntu box. Over time your commit history becomes a searchable record of what you built and when. The AI summary could synthesize "worked on auth refactor and D1 migration" from a batch of commits in a day.

---

### Second tier — useful but defer

**Voice memos / transcripts** *(Apple Voice Memos, Whisper)*  
High value, higher complexity — needs an audio transcription step before ingest. The Watchdog would call a local Whisper instance, then send the transcript as the body. Worth doing but not v1.

**Finance / receipts** *(bank CSVs, Apple Wallet, Copilot)*  
Every bank exports CSV. A transaction is: date, amount, merchant, category. Low ingest complexity, but the cards are fundamentally different from everything else — no URL, no summary needed, just structured data for filtering. Good candidate for v1.5.

**Podcast listening history** *(Overcast, Apple Podcasts, Pocket Casts)*  
Overcast has a full OPML + history export. A listening record is: episode title, show, duration listened, timestamp. Pairs well with Journal — "I was listening to Lex Friedman on the day I wrote that journal entry about AI." Lower ingest priority than reading highlights since you can't annotate podcast episodes the same way.

---

### What to avoid in v1

**Social media archives** — Twitter/X, LinkedIn, Instagram all provide data dumps, but the schemas are messy, the content is ephemeral, and you can't link back meaningfully once a post is deleted. Not worth the schema complexity.

**App usage / Screen Time** — High volume, very low signal. Knowing you spent 4 hours in VS Code on April 14 isn't actionable. Skip entirely.

**Browser history** — At odds with the intentional-saves philosophy of Lumin. Your bookmarks *are* the curated browser history. Ingesting raw history is noise at scale.

---

## The v1 source list


| Source | Key fields | Link-back | AI value |
|---|---|---|---|
| `link` | url, title, description, tags | url | medium |
| `email` | subject, from, body, thread_id | `message://` | high |
| `file` | path, hash, mime, node |  | high |
| `journal` | title, body, mood, location | `dayone://` or file path | high |
| `calendar` | title, start, end, attendees, notes | iCal UID | low |
| `highlight` | text, note, book, author, chapter | Readwise URL | medium |
| `task` | title, project, completed_at, notes | app deep link | low |
| `photo` | path, lat, lng, captured_at, EXIF |  or R2 thumb | low |
| `health` | metric, value, unit, device | Apple Health export | low |

That's a manageable v1 surface. Each maps cleanly to `records` + one extension table. The Watchdog logic for `journal`, `highlight`, and `task` is simpler than `email` or `health` — good first movers after links.

---

## The "generic envelope" escape hatch

Rather than trying to enumerate every source before v1 ships, consider a `custom` origin type that accepts any `metadata_json` payload with just `title`, `raw_id`, and `source_node` required. Any source that doesn't have a first-class extension table yet can submit as `custom`. This gives you a working ingest path for any new source immediately, with the option to graduate it to a typed extension table later when the schema stabilizes.
