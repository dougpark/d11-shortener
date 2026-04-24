# modify RSS AI Enrichment to support Bookmarks
- add ai_summary and ai_tags columns to bookmarks table
- modify ai enrichment process to also update bookmarks with ai_summary and ai_tags
- add a new "source" to the API so the system can route the results to the correct table (rss_items vs bookmarks)
- update API routes to return ai_summary and ai_tags for bookmarks
- update client to display ai_summary and +original tags + ai_tags for bookmarks
- Original tags are important to keep around for bookmarks, since users may have manually added them and want to keep them even if AI tags are added/removed. For RSS items, we can just replace the tags with the AI-generated ones since they are not user-managed.
- on the client the ai_summary should be displayed as an optional "AI Summary" section below the user-generated summary. The ai_tags should be displayed alongside the original tags, but visually distinguished (e.g. different color or "AI:" prefix) to indicate they are AI-generated.
- update the Readme and API documentation to reflect the new AI enrichment features for bookmarks.