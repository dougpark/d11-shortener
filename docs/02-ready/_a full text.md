# Full Text

## consider this in the context of:
- existing ai enrichment process.
- the synthesis digest process that we are planning to implement.

## Questions
- full_text used for ai_synthesis should be clean text

- full_text used for showing in the UI should preserve some level of formatting, such as paragraphs and headings. we can consider storing both a clean version of the full text for the ai synthesis process, and a formatted version of the full text for showing in the UI. this would allow us to have the best of both worlds, with clean text for the ai synthesis process and formatted text for the UI.

- im not sure that the readability libraries can output both a clean version of the full text and a formatted version of the full text. we may need to run the full text through the readability library twice, once to get the clean text for the ai synthesis process, and once to get the formatted text for showing in the UI. or we can consider using a different library that can output both a clean version of the full text and a formatted version of the full text in one pass.

## Goals
- for items that have a url but no full_text, create a process so that the local daemon can fetch the bookmark informtion, and they will then fetch the full and call a new api to update the bookmark with the full text. This will allow us to have the full text available for the synthesis digest and for showing in the UI when users click to see the full text of an article.

- the local daemon will initiate the fetch for a list of bookmarks that have a url but no full_text, and then for each one it will fetch the full text and call the api to update the bookmark with the full text. This allows us to have the full text available for the synthesis digest and for showing in the UI when users click to see the full text of an article. (similar to the current ai enrichment process)

- what are resonable limits for the length of the full text that we support? do we want to truncate it at a certain point to avoid storing excessively long articles? or do we want to store the full text regardless of length?

- we can also consider adding a new column to the D1 table to track the status of the full text fetch, such as full_text_status with values like "pending", "fetched", "failed" etc. this would allow us to track the progress of the full text fetch and handle any errors that may occur during the process.


## Sequence of operations
1. bookmark is created with url and title
2. ai enrichment process runs and fills in ai_summary, ai_tags, and other enrichment data
3. full text fetch process runs and fills in full_text
4. synthesis digest process runs and fills in ai_synthesis, updates ai_tags if necessary, and updates ai_synthesis_at with the current date and time
- confirms that these should be seperate api's so that different prompts can be used for the enrichment and the synthesis digest, and so that they can run independently of each other. for example, if we want to update the synthesis digest prompt in the future, we can just re-run the synthesis digest process without having to re-run the enrichment process.



## Design Ideas

This design document signals that Lumin is moving from a metadata manager to a true Knowledge Engine. By fetching and storing the full text, you’re essentially creating a "local-first" version of Pocket or Instapaper, but with the added power of your 5060 Ti's "Scholar" brain.
Here are my technical suggestions for your Full Text goals:
1. The "Dual-Text" Strategy
Storing two versions is definitely the "Best of Both Worlds" approach.
• Version A: Formatted HTML (for the UI): Use a library like @mozilla/readability. It specifically identifies the "content" and returns a cleaned-up HTML string that preserves <h1>, <ul>, and <p> tags.
• Version B: Clean Markdown (for AI/Search): Instead of running the scraper twice, just take the HTML output from Version A and pass it through a light library like turndown. This converts the HTML into clean, LLM-ready Markdown.
Why Markdown for AI? LLMs (including your local Gemma 4) perform significantly better on Markdown than raw text. It preserves the hierarchy (what’s a header vs. what’s body text) without the "noise" of HTML tags that waste tokens.
2. Handling Length & Limits
Since you're using Cloudflare D1, you have a 10GB limit per database.
• The "Vibe" Limit: I recommend a 50,000 character limit (~8,000–10,000 words). This covers 99% of technical deep-dives and long-form articles while protecting your database from accidentally scraping an entire Wikipedia category or a 400-page PDF.
• Storage Tactic: Store the formatted_html in a separate content table in D1, linked by bookmark_id. This keeps your main bookmarks table (used for the Explore view) lean and fast.
3. The Sequence of Operations (The "Waterfall")
Your logic for separate APIs is spot on. It prevents "Chain Failure" (e.g., a scraper failing doesn't stop the AI from tagging based on the title).

Step	Operation	API/Process	Goal
1	Create	POST /bookmark	Instant URL/Title save.
2	Scout	POST /enrich	Edge AI: Immediate tags/summaries for the UI.
3	Fetch	Local Daemon	Fetch HTML → Extract HTML/MD → POST /content.
4	Scholar	POST /synthesis	Local AI: Deep reasoning based on the full Markdown.

4. Implementation Suggestions
• full_text_status: Adding this to D1 is crucial. I'd use an Enum: [pending, processing, completed, error, too_large].
• The Daemon's "Politeness": Since you're running this locally, you can use Playwright (running in a Docker container on your Linux box) for the "failed" fetches. If a standard fetch() gets blocked by a bot-wall, Playwright can render the JS and grab the content like a real human.
A "Material 3 Expressive" Touch for the UI
When you implement the "View Full Text" button in Lumin, use the Shape Morphing design we discussed.
Instead of a new page loading, the "Full Text" icon should expand and morph into the reading surface. This creates an emotional connection by showing the user that the content "lived" inside the bookmark card all along.
