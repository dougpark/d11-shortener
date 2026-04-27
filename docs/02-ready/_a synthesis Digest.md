# Synthesis Digest

## consider this in the context of:
- existing ai enrichment process.
- the full text fetch process that we are planning to implement.

## Goals
- for batch processing by the daemon Gopher running a local llm
- add a new column to the D1 table - ai_synthesis
- new column ai_synthesis_at to track proccessing date
- once full_text is available run this through a new prompt and get a 1-2 paragraph synthesis of the content
- show in the UI on the bookmarks cards and on the explore page public cards.

## Sequence of operations
1. bookmark is created with url and title
2. ai enrichment process runs and fills in ai_summary, ai_tags, and other enrichment data
3. full text fetch process runs and fills in full_text
4. synthesis digest process runs and fills in ai_synthesis
- confirms that these should be seperate api's so that different prompts can be used for the enrichment and the synthesis digest, and so that they can run independently of each other. for example, if we want to update the synthesis digest prompt in the future, we can just re-run the synthesis digest process without having to re-run the enrichment process.


