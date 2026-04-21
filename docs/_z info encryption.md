## Cloudflare's security model and encryption at rest

## No application level encryption for now
- determine when specific columns are required
- trust cloudflare worker secrets?


### What Cloudflare already does for you

D1 data is encrypted at rest at the **infrastructure layer** — AES-256 on the underlying disk, managed by Cloudflare. Data in transit is always TLS. This is the same model as AWS RDS, Google Cloud SQL, or any major cloud database. It protects against:

- Physical disk/hardware theft from a Cloudflare data center
- Some forms of infrastructure-level breach

What it does **not** protect against:
- Cloudflare employees with internal data access
- A legal subpoena or government order served to Cloudflare (US-based company — CLOUD Act applies)
- Someone who compromises your Cloudflare account (gains access to D1 console or Wrangler credentials)
- Your Worker itself — if code in the Worker is compromised, it can read everything

For public bookmarks and general link data, Cloudflare's infrastructure encryption is more than sufficient. The question gets more interesting when you add health records, private journal entries, and email bodies.

---

## The real threat model question

Before deciding whether to encrypt, you need to be honest about what you're protecting against:

| Threat | Cloudflare infra encryption | App-level encryption |
|---|---|---|
| Data center disk theft | ✅ protected | ✅ protected |
| Cloudflare insider access | ❌ not protected | ✅ protected (if key is separate) |
| Legal subpoena to Cloudflare | ❌ not protected | ✅ protected (if Cloudflare can't decrypt) |
| Your Cloudflare account takeover | ❌ not protected | ⚠️ depends on key location |
| Your Worker code compromised | ❌ not protected | ❌ not protected (Worker decrypts) |
| Someone steals your API token | ❌ not protected | ❌ not protected (API decrypts for them) |

The uncomfortable truth: **if your Worker code is the thing doing the decryption, application-level encryption primarily protects against Cloudflare itself** — employees, legal orders, and account compromise via the Cloudflare dashboard. For a personal archivist with health and journal data, that's a legitimate concern worth taking seriously.

---

## How application-level encryption would work

The only practical approach on Cloudflare Workers is **envelope encryption** with a key stored as a Worker secret:

1. You store an encryption key (32 random bytes) as a `DATA_ENCRYPTION_KEY` Wrangler secret — it lives in Cloudflare's secrets system, which is separate from D1 storage
2. The Worker uses `crypto.subtle.encrypt()` (AES-256-GCM, which is built into the Workers runtime) to encrypt sensitive fields before `INSERT`
3. The Worker decrypts on `SELECT` before returning to the client
4. The encrypted ciphertext sits in D1 as a blob; Cloudflare's D1 team sees random bytes, not "resting heart rate: 58bpm"

The key lives in Cloudflare Secrets, the ciphertext in D1 — two separate systems, which is better than both being in D1.

---

## The critical tradeoff: encryption kills search

This is the hard blocker you need to understand before committing to this path.

**You cannot run SQL `LIKE` queries, `WHERE` clauses, or FTS5 full-text search against encrypted column values.** Every search would require:
1. Decrypting every record in memory
2. Doing string matching in the Worker
3. Returning results

At 50 records this is fine. At 50,000 health records, email bodies, and journal entries, this is a Worker memory and CPU timeout problem. D1 + FTS5 is specifically what makes the universal search vision viable — application-level encryption of body text would gut that entirely.

The same problem affects the AI summary pipeline: if `email_body` is encrypted in D1, the Watchdog can't read it back to re-summarize. The Worker would have to decrypt it first, then send to Ollama.

---

## A practical tiered approach

Rather than encrypt everything or nothing, encrypt by sensitivity class:

**Never encrypt — needs to be searchable:**
- `title`, `tag_list`, `ai_summary`, `origin_type`, `source_node`, `created_at`
- These are what FTS5 indexes against; they're the search surface
- `ai_summary` is already an abstraction — it's the LLM's words, not your raw journal entry

**Encrypted at rest (column-level AES-256-GCM):**
- `body_text` on email and journal records — the actual full content
- `health_meta.value` / raw health metrics
- `metadata_json` for anything typed as sensitive
- Photo EXIF location data (`lat`, `lng`)

**Never leave the local machine — don't send to D1 at all:**
- Full email bodies above a size threshold → stored locally, only the `ai_summary` and headers go to D1
- Raw health data time series → local SQLite on the Ubuntu box; only aggregated summaries flow to Cloudflare
- Any data you're genuinely uncomfortable with Cloudflare holding regardless of encryption

This last tier is the most defensible for truly sensitive data. The Watchdog sends only the derived metadata to Lumin. The original never leaves your LAN. The archivist becomes an index of summaries, not a copy of everything.

---

## The key management problem you can't fully solve on Cloudflare

There is no way to store an encryption key that Cloudflare definitively cannot access, if your Worker is doing the decryption on Cloudflare's infrastructure. The `DATA_ENCRYPTION_KEY` as a Wrangler secret is still within Cloudflare's custody. This is the fundamental limitation of server-side encryption: the server holds the key.

The only architecturally sound way to close this gap is **client-side encryption** — data is encrypted before leaving your browser or the Ubuntu Watchdog, and the plaintext never touches Cloudflare. The tradeoff is total: no server-side search, no AI processing, no Cloudflare-side anything on that data. It becomes a transport and storage medium only.

For a personal tool with health and journal data, the most pragmatic recommendation is:
1. Accept Cloudflare's infrastructure encryption for link/web data
2. Encrypt `body_text` fields at the application layer (accepts the search tradeoff for full bodies — summaries remain searchable)
3. Keep the most sensitive raw data (continuous health metrics, complete email history) local-only and send only AI-derived summaries to D1

This gives you a defensible security posture without destroying the search capabilities that make the whole project valuable.