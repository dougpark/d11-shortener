# Design Document: Lumin Archivist Evolution

1. Objective
Expand the existing Hono/Bun/D1 stack to support multi-source metadata ingestion (Email, Local Files, iMessage, Health) while maintaining a unified tagging and search interface. The core philosophy is "Link the data, don't move it."

2. Database Schema Updates (SQLite/D1)
The bookmarks table will be treated as a "Universal Registry." The following columns must be added to support diverse data origins.
-- Migration: Add Archivist metadata columns
ALTER TABLE bookmarks ADD COLUMN origin_type TEXT DEFAULT 'link';  -- Values: 'link', 'email', 'file', 'message', 'health', 'photo'

ALTER TABLE bookmarks ADD COLUMN source_node TEXT; -- The hardware/OS identifier: 'ubuntu-ai', 'mac-pro', 'iphone-15'

ALTER TABLE bookmarks ADD COLUMN raw_id TEXT; -- Immutable external keys: Message-ID, UUID, or File Hash

ALTER TABLE bookmarks ADD COLUMN file_path TEXT; -- Local URI for 'file://' links or local backup references

ALTER TABLE bookmarks ADD COLUMN ai_summary TEXT; -- Distinct from user description; stores output from Gemma/Local LLM

ALTER TABLE bookmarks ADD COLUMN metadata_json TEXT; -- Catch-all for source-specific data (e.g., Health metrics, EXIF data)

3. API & Route Enhancements
POST /api/v1/posts (Internal/External Ingest)
Update the existing endpoint to accept the new optional fields. This allows the local Ubuntu "Watcher" services to push data.
•	Logic: If raw_id and origin_type are provided, the API should perform an UPSERT (update on conflict) to prevent duplicate entries for the same email or file.
•	Auth: Continue using Bearer token authentication (API tokens).
GET /api/v1/posts (Querying)
Update filtering logic to support origin-based discovery:
•	New Param: origin (e.g., ?origin=email).
•	New Param: node (e.g., ?node=ubuntu-ai).

4. UI/UX Updates (app.html)
A. The "Source" Filter
Add a new section in the sidebar (above or below the Tag list) to filter the feed by origin_type.
•	Icons: Use Lucide/Feather icons for visual distinction (e.g., Mail icon for emails, File icon for local docs).
B. Adaptive Cards
The bookmark grid should render cards differently based on the origin_type.
•	Email Card: Title = Subject; Link = message://<raw_id>; Display ai_summary prominently.
•	File Card: Title = Filename; Link = file://<file_path>; Show source_node to indicate which machine the file lives on.
C. Search Enhancement
Modify the client-side search to include the ai_summary and file_path fields in the filter logic.


## External 

5. Ingestion Logic (External Bun Services)
The following logic should be implemented in separate local-only Bun scripts on the Ubuntu AI box:
The "Watchdog" Protocol:
	1.	Detect: fs.watch triggers on a new file or ImapFlow triggers on exists.
	2.	Summarize: Send the content to local Ollama/Gemma endpoint.
	3.	Tag: Use a regex or LLM to suggest tags from the existing Lumin GET /api/v1/tags list.
	4.	Register: Send the JSON payload to the production d11.me/api/v1/posts endpoint.

