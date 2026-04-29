# The "Collector Agent": Building an Automated Research Workflow with Lumin
Since you're already doing "Auto-tag on Add," the next logical step is to have an "Agent" that proactively finds related content for your bookmarks. This turns Lumin from a passive archive into an active research assistant that helps you discover new connections and insights.

- look for a specific tag, like #link, to trigger the research workflow
- use the bookmark's title and ai_summary as input for the research query
- have Gopher generate a search query based on the bookmark's content and tags
- hit external APIs (like YouTube, Semantic Scholar, Open Library) to find related content
- filter and rank results using Gopher's local LLM capabilities
- store related links in a new D1 table (e.g., related_links) that connects back to the original bookmark
- display these related links in the UI as "Further Reading" or "Related Content" under the bookmark details

## Why this is a "Digital Archivist" Power Move
This workflow turns Lumin into a system that doesn't just store what you've found, but proactively expands

That next step moves you from "Archiving" into "Automated Research." This turns Lumin into a system that doesn't just store what you've found, but proactively expands your knowledge graph.
Given your Bun/D1/5060 Ti stack, this is a classic "Agentic" workflow. You can have Gopher trigger a background research job whenever a bookmark gets that #link tag.
The "Deep Research" Stack
To keep your 24-hour break productive (mentally, at least), here is how you can architect those specific connections:
1. Academic & Research (The "Scholar" Layer)
Instead of scraping Google Scholar (which is a pain), use the Semantic Scholar API.
• Why: It’s free for non-commercial use and has a "Recommendations" endpoint.
• The Workflow: Gopher sends the bookmark's ai_summary to Semantic Scholar. It returns 3-5 relevant papers. You store these in a related_content table in D1.
• Result: Your bookmark for "800v EV Architecture" suddenly has a link to an IEEE paper on "Silicon Carbide Inverters."
2. Visual Context (The YouTube Layer)
Use the YouTube Data API v3 (Search endpoint).
• The Logic: Gopher extracts the top 3 ai_tags and runs a search for type=video with a relevance sort.
• The Vibe: You can even filter for specific channels you trust (like TechnoTim or Munro Live if it's EV stuff) to keep the "crap" out of your archive.
3. Books & Deep Dives (The Amazon/Open Library Layer)
The Amazon PA-API is a bit of a bureaucratic mess to get into.
• The "Linux Pro" Alternative: Use the Open Library API or Google Books API. They are much easier to hit from a Cloudflare Worker.
• The Feature: Adding a "Further Reading" section to your Lumin cards that suggests a definitive book on the topic.
The Architecture: "The Collector Agent"
Since you’re already using /docs to plan features, here is how _h-research-agent.md might look:
Step	Action	Tech
Trigger	New Bookmark Added	D1 Hook / Worker
Search	Query Generation	Gopher (Local LLM)
Fetch	Hit APIs (YT, Scholar, Books)	Cloudflare Worker
Filter	Remove duplicates/low-quality	Gopher (Local LLM)
Store	Insert into related_links	D1
Why this is "Cool Stuff"
Imagine your Lumin Explore View next month. You click on a bookmark you saved about "Bun SQLite performance."
• Beneath your notes, you see a YouTube video comparing Bun vs Node.
• You see an academic abstract on "Low-latency database indexing."
• You see a link to a book on "High Performance JavaScript."
You've built a system that learns alongside you. Since you're already doing "Auto-tag on Add," would you want these "Discovery" links to show up instantly in the UI (via the Edge Worker), or is this a "Deep Thought" task that Gopher should handle overnight while the AIStation is pinned?