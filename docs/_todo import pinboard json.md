
# pinboard json import converter

* this could be a new import.html if it would keep the main app.html clean

## provide a menu option to import pinboard json
- ask to select a pinboard json export file.

- convert the pinboard format to lumin format 

- on the client js batch calls to 100 bookmarks to manage Cloudflare worker timeout killswitch.

- always assume bad or missing data.

- converts href to url.

- converts tags space seperated string to tag_list json array.

- converts description to title.

- converts extended to short_description.

- converts shared "yes" to is_public 1.

- my sample pinboard json file is 2.6 MB with 5648 bookmarks. can a file that large be uploaded and processed by the browser?


Example pinboard json format:

[
  {
    "href": "https://www.gutenberg.org/files/2434/2434-h/2434-h.htm",
    "description": "The New AtlantisProject Gutenberg",
    "extended": "THE NEW ATLANTIS\r\n\r\nWe sailed from Peru, (where we had continued for the space of one whole year) for China and Japan, by the South Sea; taking with us victuals for twelve months; and should do.",
    "meta": "eee57bc365389ec312b544f954f4358b",
    "hash": "e5975894ff856542369b5e1048b0441c",
    "time": "2026-04-20T01:18:46Z",
    "shared": "yes",
    "toread": "no",
    "tags": "science scientific-method link"
  }]

here is a CLI migration script to base our new browser based pinboard json import feature:

1. The Migration Script (import.ts)
This script will take your pinboard_export.json, transform it to match your Lumin D1 Schema, and output a .sql file for bulk execution.
import { writeFileSync } from "node:fs";

// Configuration
const PINBOARD_EXPORT_PATH = "./pinboard_export.json";
const OUTPUT_SQL_PATH = "./migration.sql";
const USER_ID = 1; // Your user ID in Lumin

const pins = await Bun.file(PINBOARD_EXPORT_PATH).json();

function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")     // Replace spaces with -
    .replace(/[^\w-]+/g, "")   // Remove all non-word chars
    .replace(/--+/g, "-");    // Replace multiple - with single -
}

let sqlContent = `-- Lumin Migration: ${pins.length} bookmarks\n`;

for (const pin of pins) {
  const url = pin.href.replace(/'/g, "''"); // Escape single quotes for SQL
  const title = (pin.description || "Untitled").replace(/'/g, "''");
  const note = (pin.extended || "").replace(/'/g, "''");
  const createdAt = pin.time; // Pinboard uses ISO 8601, same as your schema
  
  // Convert Pinboard space-separated tags to JSON array
  const tags = JSON.stringify(pin.tags.split(" ").filter(t => t.length > 0));
  
  // Generate a slug: use Pinboard's 'hash' or slugify the title
  const slug = pin.hash.substring(0, 8); 

  sqlContent += `INSERT INTO bookmarks (user_id, url, slug, title, short_description, tag_list, created_at, updated_at) 
VALUES (${USER_ID}, '${url}', '${slug}', '${title}', '${note}', '${tags}', '${createdAt}', '${createdAt}');\n`;
}

await Bun.write(OUTPUT_SQL_PATH, sqlContent);
console.log(`✅ Generated ${OUTPUT_SQL_PATH} with ${pins.length} entries.`);

----
plan
----


Read [](file:///Users/dougpark/Projects/d11-lumin/docs/_todo%20import%20pinboard%20json.md)

## Plan: Pinboard JSON Import

### File size / browser concerns — not an issue

2.6MB / 5648 bookmarks is entirely manageable in the browser:
- `file.text()` + `JSON.parse()` on 2.6MB: < 50ms
- 5648 objects in memory: ~20–30MB of JS heap at most
- Modern browsers can handle files up to hundreds of MB via the File API

### Cloudflare Worker timeout — this IS a real concern

CF Workers paid plan: **30-second CPU limit per request**, plus D1 has its own per-batch limits.

The current `/api/bookmarks/import` route does **sequential individual `INSERT` statements in a for-loop**. For 100 items that's 100 separate async round-trips to D1 — slow but likely okay. For 5648 items in one request it would **definitely timeout**.

**The mitigation the doc already identifies is correct**: batch on the client, send 100 at a time.

However the server route should also be upgraded to use **`db.batch()`** (D1's native batch API) instead of sequential `.run()` calls — that collapses 100 round-trips into 1 D1 call, keeping each request well under the timeout.

---

### Field mapping design

| Pinboard | Lumin | Notes |
|---|---|---|
| `href` | `url` | Skip entries where href is empty (Pinboard "notes") |
| `description` | `title` | Fallback to hostname if empty |
| `extended` | `short_description` | Optional, can be blank |
| `tags` (space-separated) | `tag_list` | `"ai tools dev"` → `["ai","tools","dev"]` — watch for tags like `via:packrati.us` (colons/slashes) |
| `shared === "yes"` | `is_public = 1` | |
| `time` | `created_at` | Already ISO 8601, direct copy |
| `hash.slice(0, 8)` | `slug` | Need `-n` suffix for collision; fallback if hash is empty |
| `toread === "yes"` | *(unresolved — see below)* | |

**Open question: `toread`**. There's no dedicated field for this. Options: (a) add a `"toread"` tag automatically, (b) ignore it, (c) scope it out for v1. The unread filter (`hit_count = 0`) already covers new imports implicitly.

---

### Architecture: separate `import-pinboard.html` page

A dedicated page (not a modal) is the right call for this complexity:

- Served at `/import/pinboard`, same auth cookie pattern
- **Three phases with progress UI**:
  1. **File select + preview** — show item count, tag count, estimated batches
  2. **Processing** — progress bar: "Importing batch 12 of 57…", can be paused/cancelled
  3. **Summary** — imported X, skipped Y duplicates, Z errors with details
- Not possible to implement adequately inside a modal without it feeling cramped

---

### Server-side changes needed

1. **Upgrade `/api/bookmarks/import`** to use `db.batch()` instead of sequential inserts — this is a prerequisite, not optional
2. **No new API route needed** — the existing import endpoint handles the normalized Lumin format; the Pinboard-specific transformation is purely a client-side concern

---

### Key risks / concerns

1. **Slug collisions**: Pinboard's 8-char hash prefix could collide within a user's own set (rare) or with existing bookmarks. The `-2/-3` suffix logic already exists in the import route.
2. **Bad/missing data**: Pinboard exports sometimes have empty `href` (saved notes), blank `description`, malformed `tags`. Need defensive parsing for all fields.
3. **Special chars in tags**: Pinboard allows `via:packrati.us`-style tags. These would become invalid/ugly slugs in tag context — likely fine to import as-is, but worth a mention.
4. **Re-import / idempotency**: Running it twice is safe — URL-based dedup in the import route skips already-saved bookmarks.
5. **Progress accuracy**: With 57 batches, if any batch errors mid-way the user needs to know which batch failed, not just a final error count.
6. **No rollback**: D1 doesn't support cross-request transactions. If batch 34 of 57 fails, the first 3300 are already committed. The summary page should make this clear and re-import is idempotent so it's recoverable.

---

### Recommended batch size

**100 items per POST** as suggested in the doc. With `db.batch()`, 100 INSERTs take < 1 second including D1 round-trip, leaving enormous headroom under the 30-second limit.

---

Ready to implement when you say so. The main new artifacts are: `src/client/import-pinboard.html` (new standalone page), an upgrade to the import route to use `db.batch()`, and a new `GET /import/pinboard` HTML route in index.ts.