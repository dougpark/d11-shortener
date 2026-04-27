Let me look at the sidebar tag rendering and `filterByTag` to understand the full context before making recommendations. 

Searched for regex `filterByTag|tag-list|active-tag|community-view-btn|tag_btn|renderTags` (`**/src/client/app.html`), 20 results

Read [](file:///Users/dougpark/Projects/d11-lumin/src/client/app.html#1534-1534), lines 1534 to 1630

Read [](file:///Users/dougpark/Projects/d11-lumin/src/client/app.html#725-725), lines 725 to 775

Good context. Now I have a clear picture of the full layout. Let me present a plan. 

Read memory

## Plan: Surface Explore from the Tag Sidebar

**TL;DR:** The current people-icon in the far-right toolbar is easy to miss and semantically disconnected from its trigger (the tag). Industry best practice (Pinboard, GitHub Topics, Reddit sidebar) puts the "see community/explore view" action *on* or *immediately adjacent to* the tag element that spawned it. Two touch-points cover both the no-tag and active-tag states.

---

**Industry patterns that apply here:**

| Source | Pattern |
|---|---|
| Pinboard / Delicious | Hover on a sidebar tag reveals a small secondary action (public view icon) inline on the row |
| GitHub Topics | Active filter badge displays "Browse all GitHub repositories tagged X →" as a contextual sub-link |
| Reddit subreddits | Sidebar has a fixed "Community → r/topic" link above the tag list |
| Notion / Linear | Each sidebar item has a ghost icon on hover (right side of the row) with secondary navigation |

The consensus is: **proximity to the tag item + visible on hover, not buried in a toolbar cluster**.

---

**Steps**

**Phase 1 — Sidebar touch-points (desktop + mobile)**

1. **`/e` landing entry** — Add a permanent "Explore ↗" link directly below the "All" button in the sidebar (desktop + mobile), linking to `/e`. Uses a compass/sparkle icon. Always visible. *This addresses the no-tag state.*

2. **Hover action on each tag row in `buildTagFilterHTML`** — Add a small external-link / compass icon that appears `opacity-0 group-hover:opacity-100` on the right of each tag button, replacing the current bare count number. On click it navigates to `/e/:tag` in a new tab. Wrap the tag `<button>` row as a `group` to trigger hover. *This is the Pinboard/Linear pattern — action is on the element that owns the context.*

**Phase 2 — Active tag badge enhancement (main content area)**

3. **Inline Explore link inside `#active-tag-badge`** — When a tag is active, the badge currently shows `#tagname ×`. Add a compact `Explore →` text link (or compass icon) inside the badge before the dismiss `×`. This is the GitHub Topics pattern — contextual, immediately visible at the top of the filtered list, right where the user's eyes already are.

4. **Remove `#community-view-btn`** from the far-right toolbar cluster (it's now redundant) — this also simplifies the toolbar.

**Phase 3 — Mobile**

5. **`mobile-active-tag-row`** already shows `#tagname` across the top when a tag is selected — add the same Explore link inline here, mirroring step 3.

6. **Mobile tag list** — same `buildTagFilterHTML` change from step 2 covers mobile automatically since both lists share the same render function.

---

**Relevant files**
- app.html — all changes here
  - `buildTagFilterHTML()` (~L1545) — tag row HTML, add hover icon
  - `filterByTag()` (~L1592) — active badge update, Explore link injection, remove `community-view-btn` logic
  - Sidebar HTML (~L679–694) — add permanent Explore entry below "All"
  - `#active-tag-badge` HTML (~L730) — extend badge with Explore link
  - `#mobile-active-tag-row` (~L878) — same for mobile
  - `#community-view-btn` (~L761) — remove

---

**Verification**
1. No tag selected → Explore entry is visible in sidebar, links to `/e`
2. Click a tag in sidebar → hover shows compass icon on the row; clicking opens `/e/:tag`
3. Tag active badge shows `#tagname [Explore →] ×` — Explore link opens `/e/:tag?community` or `/e/:tag` (your preference)
4. Mobile: active tag row shows Explore link; mobile tag list rows have same hover icon
5. `#community-view-btn` gone from toolbar — toolbar is cleaner

---

**Decisions**
- The hover-icon approach on tag rows means users discover it naturally on first hover without cluttering the default UI — consistent with Linear/Notion's "ghost action" pattern
- The Explore link from the sidebar goes to **Mine mode** (`/e/:tag`) by default since the user is in their own dashboard context; they can switch to All/Community once on the explore page
- The permanent "Explore" entry at the top of the sidebar links to the top-tags landing `/e`

**One question before I build this:** 

Analyzing your answers...

Good call — Explore is inherently about discovery. All links will go to `/e/:tag?community`. Let me update and save the full plan: 

Created memory file [](file:///Users/dougpark/Library/Application%20Support/Code/User/workspaceStorage/68ef4481403f9d106120f1b5bb6770e0/GitHub.copilot-chat/memory-tool/memories/ZTI5ZDUyZGMtYjFiMy00MDgyLWFhMzYtMWIwYzhkMWY5YmRl/plan.md)

Here's the refined plan with your input applied:

---

## Plan: Surface Explore from the Tag Sidebar

**TL;DR:** Replace the buried toolbar icon with three well-placed, contextual touch-points that follow the Pinboard/GitHub Topics/Linear "proximity to context" pattern. All Explore links default to Community mode since Explore = discovery.

**Steps**

**Phase 1 — Sidebar**

1. **Permanent "Explore" entry** below the "All" button — a compass-icon link to `/e` (the top-tags landing). Always visible, no interaction required. Covers the no-tag state and signals Explore as a first-class feature. *(Reddit subreddit sidebar / Pinboard "Network" link pattern)*

2. **Ghost action icon on each tag row** in `buildTagFilterHTML()` — a small compass icon appears `opacity-0 group-hover:opacity-100` on the right of each sidebar tag. Clicking opens `/e/:tag?community`. The tag count shifts left to make room. Covers both desktop `#tag-list` and mobile `#mobile-tag-list` automatically since they share the same render function. *(Linear/Notion ghost-action-on-hover pattern)*

**Phase 2 — Active tag badge (main content)**

3. **Inline Explore link inside `#active-tag-badge`** — the badge changes from `#tagname ×` to `#tagname · Explore ↗ ×`. A small text link (not an icon) right in the tag context strip at the top of the filtered list. Most prominent placement when a tag is actually selected. *(GitHub Topics "browse all" inline pattern)*

4. **Mobile active tag row** — same treatment: add Explore link inside `#mobile-active-tag-row` beside the existing `✕ clear` button.

**Phase 3 — Cleanup**

5. **Remove `#community-view-btn`** from the toolbar cluster and all its show/hide logic in `filterByTag()` — now redundant.

**Relevant files**
- app.html — all edits here
  - Sidebar HTML (~L679): add Explore `<a>` below "All"
  - `buildTagFilterHTML()` (~L1545): wrap rows as `group`, add hover compass icon
  - `#active-tag-badge` HTML (~L730): extend badge with Explore link
  - `filterByTag()` (~L1592): remove `community-view-btn` show/hide; update badge inject
  - `#mobile-active-tag-row` (~L878): add Explore link
  - `#community-view-btn` (~L761): delete

**Verification**
1. No tag select → Explore entry visible in sidebar → opens `/e`
2. Hover a sidebar tag → compass icon fades in → opens `/e/:tag?community`
3. Select a tag → badge shows `#tagname · Explore ↗ ×`
4. Mobile: active tag row has Explore link
5. Toolbar is clean — no `community-view-btn`

Shall I implement it?