# Fetch Page Text: The "Phase 2" Upgrade for Gopher
- Why this is the next logical step for Lumin's AI enrichment pipeline
- How to implement it using Lumin Gofer and Gemma 4 running on the daemon AIStation


## Batch run at night
- fetch page text for all bookmarks that don't have it yet
- add to existing full_text field in D1
- run Gopher to extract better tags and summaries based on the full text
- update the bookmark records with the new tags and summaries


## Discussion

Using Gemma 4 for this is a brilliant call. Google just released the Gemma 4 family on April 2nd, and the 31B Dense and 26B MoE models are specifically designed to punch way above their weight in reasoning and classification.


1. The Scraping Strategy: "Clean over Volume"
Since you are a "Digital Archivist," you don't want to dump raw HTML into your database. You want LLM-Ready Markdown.

• The "Trafilatura" approach: For your Bun/TypeScript environment, use a library that mimics the "Readability" mode in browsers. It strips out the headers, footers, and ads, leaving just the core article text.

• The "Worker" Fetch: Since Lumin is on Cloudflare, you can use a Worker to do the initial fetch(). If the site is a SPA (Single Page App), you might eventually need a headless browser like Playwright, but for 90% of technical blogs, a simple fetch + text() + DOMParser works fine.

2. Gopher’s New "Phase 2" Role
With the full text, Gopher (on your 5060 Ti) can move beyond simple tagging:

• The "Key Quotes" Feature: Have Gopher extract the 2-3 most important sentences from the page. This is great for your blog view.

• Content-Based Tagging: Instead of tagging a site #linux because "Linux" was in the title, it can see the code snippets and tag it #kernel-module or #ebpf-performance.

• Better Summaries: The purple AI summary in your dashboard will go from "This is a link about X" to "This article explains how the 5.15 kernel handles Y with Z."

3. The "Gemma 4" Edge vs. Local

Here is the cool part about your 2026 setup:

• Local (AIStation): Run the Gemma 4 31B model. It’s a "Logic Powerhouse" that excels at building internal mental models. It’s slower, but the quality for your permanent archive is unmatched.
Engineering Note: The "Context" Tax

Gemma 4 models have a "Thinking Mode" that makes them smarter but adds latency. For your background "Phase 2" runs, this doesn't matter. But for your "Real-time" tags, you might want to specifically prompt for "Strict Output" to keep the speed up:

Vibe Prompt: [Strict Output] Analyze the following page text. Output only a JSON array of 5 tags. Do not explain your reasoning.

