# Social Hub: page briefs (`/impeccable shape`)

These are the briefs for Content, Calendar, Analytics and Post. They were written from PRODUCT.md, DESIGN.md, REVISIONS.md and MATRICES.md. Tommy handed the design calls to the agent on 2026-10-08 ("trust your decisions"), so there was no interview round. Each brief is in impeccable's compact form, plus the states and interactions it has to handle.

**Shared by all four pages**
- **Color:** restrained, per DESIGN.md "The Quiet Control Room": neutrals at rest, orange only where you can act, type hues on marks only.
- **Scene:** Tommy at a desk at 8 AM, or on a phone between meetings, checking a machine that mostly runs itself. Light theme, quiet, nothing shouting unless it needs him.
- **Reference:** Instagram's Professional Dashboard for metric names and content-first thumbnails.
- **Chrome on every page:** the hub tabs (Content · Calendar · Analytics) as links, then a breadcrumb row, then the page title (Pragmatica, 24px). No eyebrows.

---

## 1. Content (`/social`, the default)

- **Summary:** the morning check. It answers "what's going out today, and does anything need me?" in one screen, then shows how full the tank is.
- **Primary action:** approve (or reject) what needs a person, from the row itself.
- **Layout, top to bottom:**
  1. **Header.** Title "Today", date beside it ("Thu Oct 8"). One status line: `6 of 9 slots filled · 2 need you · 62 of 100 posts left today`.
  2. **Needs you** (only when non-empty). One section titled "Needs you (2)", grouped Today / Tomorrow / Later. Each row is a `LineupItem`: thumbnail 56px, type mark, name, state badge with time left, then one primary button and "More". Items older than 3 days fold into "Older (n)".
  3. **Today's lineup.** Grouped by posting window in time order ("Morning · 8:30–10:00 AM"…), with a "Now" divider between past and upcoming. Rows use the same `LineupItem`. Published rows show their metric line against the type median ("13.6K views · 2.1× typical").
  4. **Pools.** Four panels in a single row in the fixed type order (they wrap to two by two on narrow screens and stack on phones). Each panel: type mark, depth ("25 ideas · 3 ready"), next three by score as a short list, last refill. The whole panel links to `/social/content/pools/[type]`.
  5. **Libraries.** Two rows: Music pool ("50 sounds · refreshed 12:30 AM") and Photo bank ("1,240 photos · +38 this week"), each linking to its page.
- **Key states:**
  - Nothing needs you: the section disappears, and the status line says "Nothing needs you".
  - Empty day: "Nothing is scheduled today. Next post: Fri 9:00 AM." with a link to Calendar.
  - A type failed to load: a one-line note in that type's place, not a page error.
  - Flags off: no disabled button walls. The row shows its single honest link instead ("Approve in Trial Reels").
- **Interaction:**
  - Clicking a row opens the post drawer over the page.
  - The primary button does its action inline: pending, then the result note, then the data refreshes and the row moves to its new state.
  - "More" opens a menu. Destructive items confirm with their consequence.
- **Copy:** person words only. "Needs you", "Ready", "Scheduled", "Posts 9:23 AM", "Last try failed: …".

## 2. Calendar (`/social/calendar`)

- **Summary:** the month's shape. It answers "how did the month go, and where are the gaps ahead?"
- **Primary action:** open a day, then fill an open slot or move something.
- **Layout:**
  1. **Header.** Month title, with month navigation (Lucide chevrons, "Today") on the right.
  2. **Summary strip.** Published count, total for the chosen metric, best day, failures, open slots ahead. Five plain figures in one row, not tiles.
  3. **Toolbar.** Type toggles (pills with type marks) and a metric menu.
  4. **Month grid, 7 columns.**
     - **Past days:** the day's metric total as the main number, with a cell tint that runs neutral to faint ink by percentile. A row of per-type slot marks underneath (filled dot, hollow for cancelled, a small alert for failed).
     - **Future days:** quota marks per type, filled vs open. Open slots are hollow outlines, so gaps are visible.
     - **Today:** an ink ring.
     - **Needs you:** a small orange-ink count badge on the day.
  5. **Day panel.** Clicking a day opens a right-side panel (a bottom sheet on phones) with that day's lineup (`LineupItem`, all actions). Open slots appear as rows with "Schedule here".
- **Key states:**
  - Future month: no totals, only plan marks.
  - No data: "No posts this month yet."
  - Phone: the grid becomes an agenda list of days with their marks.
- **Interaction:**
  - Prev/next keep the type toggles and metric.
  - The day panel is URL-driven (`?day=`), deep-linkable, and closes with Escape or Back.

## 3. Analytics (`/social/analytics` → `/social/analytics/[type]` → post)

- **Summary:** learning. It answers "what's working?", first for the whole account, then per type, then per post.
- **Primary action:** drill into a type, then a post. Compare posts from the tray.
- **Layout (overview):**
  1. **Header.** Title "Analytics", with the range shown as a quiet label.
  2. **Toolbar row.** Range pills (7d / 30d / 90d / All, plus "Custom…" in a popover) and a metric menu.
  3. **KPI strip.** Up to 5 figures: views, reach, shares, cost per 1K views, plus follows when account data exists. Each shows its value, change vs the prior period with an arrow, and a tiny sparkline. The selected metric is emphasized.
  4. **Trend.** One panel with one line per type, in type hues, direct-labeled at the line ends. Hover shows a crosshair and tooltip.
  5. **By content type.** A table with type mark, posts, median metric, sparkline, shares per post, cost per post and change. Each row links to the type page.
  6. **Top posts.** Five rows with thumbnails, opening in the drawer.
  7. **Audience.** Only when account data exists.
- **Layout (type page, breadcrumb "Analytics › Trial Reels"):**
  1. Toolbar plus "Filters (n)", a popover with chips.
  2. KPIs native to the format (4–6), with "All metrics" behind a disclosure.
  3. "What's working": a factor menu plus the group table (count, median, change vs the type median, "thin" flag). Rows filter the posts table.
  4. Posts table: sortable headers, thumbnails, checkboxes feeding the compare tray.
  5. Sources: the top sources by use, with their mean metric.
- **Compare:** a sticky bottom tray ("3 selected · Compare · Clear") opens `/social/analytics/compare?ids=`. Columns have thumbnails, and the best value in each row is marked.
- **Key states:** empty range ("No posts in the last 7 days"), a blank metric ("—", with the reason on hover-free text below the table), and a type with fewer than 3 posts (the "thin" note).
- **Interaction:** every control updates the URL with `router.replace` and no scroll jump. Content dims while pending.

## 4. Post (drawer over any list; full page on a direct visit)

- **Summary:** one piece of content, its state, and what to do about it.
- **Primary action:** the matrix's primary action for its state (Approve, Schedule…, Try again).
- **Layout:**
  1. **Bar.** Breadcrumb from `from` on the left; Close (an X with a label) on the right.
  2. **Header.** Type mark, state badge, name, time ("Posts Thu 9:23 AM · Morning window"), then the action row: one primary, a secondary, "More".
  3. **Media.** Slides as a horizontal strip, the reel poster, or story frames. A compact placeholder when there's nothing to show.
  4. **Numbers.** Before posting: "Not posted yet. Numbers appear about 48 h after posting." After posting: 4 key metrics for the format, each with "vs typical", plus cost and views per $. "All metrics" is behind a disclosure.
  5. **Over time.** A line for the selected metric, with the type median as a dashed reference.
  6. **Collapsed sections:** Tries (when any), Versions, Details (empty fields hidden), Sources.
- **Key states:** not found ("This post isn't in the hub any more."), a last try that failed (note under the header), and rejected (badge, plus "Undo reject" when allowed).
- **Interaction:**
  - Opening the drawer keeps the list behind it.
  - Escape, Back or the backdrop close it, and focus returns to the row.
  - "Open as a page" gives the full page with the same breadcrumb.

## Recommended references during build
impeccable `layout.md`, `interaction-design.md`, `typeset.md`, `colorize.md`; Emil Kowalski `emil-design-eng` for the drawer and panel motion (250ms, Helios ease-out, reduced-motion fade); the dataviz skill for the KPI sparklines and trend chart.
