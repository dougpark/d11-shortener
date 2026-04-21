# Inbound: The "Feeder"

You can subscribe to technical blogs (like the Bun.js blog or Cloudflare's blog) directly inside Lumin.

Poll: A Cloudflare Worker (Cron Trigger) pings the external RSS XML files every morning.

Filter: Your AI (Gemma 4) looks at the new titles. If it sees something about "V8 performance" or "TypeScript 6.0," it automatically bookmarks it for you.

Result: You wake up to a curated "Morning Brief" of links already summarized.


## Morning Brief sounds nice, but i hezitate to ingest full RSS feeds from anywhere
- to much junk
- current RSS readers could use a nice AI summary
- Lumin is permanant (decades), where a RSS reader is temporary
