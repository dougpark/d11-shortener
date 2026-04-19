# Public bookmarks and Explore View

Recommendation: option 1 — a dedicated /explore route. It's simpler, works for logged-out users, and is better for SEO/shareability.

## What the public view needs:

Search — yes, essential. Full-text across title, URL, description across all users
Tags — yes, but aggregate all public tags across all users (with counts), not per-user
Sort — newest first by default makes sense; also offer "most visited" (popular links surface naturally)
Attribution — show the owner's slug_prefix on each card (e.g. @fan) so users can browse a specific person's public collection
Per-user filter — clicking @fan filters to just their public bookmarks (maps to d11.me/l/fan/ effectively)


## What it does NOT need:

Edit/delete actions (read-only)
Archived filter
The sidebar bookmarklet
Unread toggle (meaningless globally)
New API needed:

GET /api/public/bookmarks — no auth, joins across all users, only is_public = 1 AND is_archived = 0. Params: search, tag, sort, page, user (slug_prefix filter).

GET /api/public/tags — aggregate tag counts across all public bookmarks.

## Conveying it in the UI:

A globe/compass icon in the top nav bar of the dashboard — subtle, next to the user avatar. Tooltip "Explore public bookmarks". On the landing page, a "Explore" nav link that works even before login.

