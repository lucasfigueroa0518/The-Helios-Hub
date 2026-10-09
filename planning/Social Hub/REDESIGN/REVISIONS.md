# Social Hub: targeted revision backlog

Built from `/impeccable critique` on 2026-10-08. The critique combined two isolated assessments: a design review (Assessment A) and the deterministic detector plus browser evidence (Assessment B). The score was **19/40 (Poor)** with **7 of 8 cognitive-load checks failing**. The snapshot is in `.impeccable/critique/`.

Context it was judged against: `PRODUCT.md`, `DESIGN.md`, and `MATRICES.md` (state and action matrices).

**How to use this file.** Every item has an ID, a priority, the fix, where it lives, and the plan step that builds it. Change the `Keep` column to **veto** or **change: …** before that step starts. Nothing here is built until its step runs. Items marked [B] were confirmed by the detector or by computed styles.

Priorities: **P0** blocks the product's purpose · **P1** major · **P2** minor · **P3** polish.

---

## G. Global: the whole hub

| ID | P | Problem | Fix | Where | Step | Keep |
|---|---|---|---|---|---|---|
| G1 | P0 | [B] The app root is 13px (`html, body { font-size: 0.8125rem }`), so every rem token renders at 81%. Body text is 10.6px, labels and badges 8.9px, chips 16.7px tall. | Social Hub type is set in px per DESIGN.md (body 14, label 12, section 16, title 24, KPI 28). Nothing goes below 12px. **Decided 2026-10-08: Social Hub only**; the rest of the Hub keeps its 13px root. | `app/globals.css:176-182`, `app/social-hub.css:1-14` | B1 | keep |
| G2 | P1 | [B] Orange carries more than ten meanings: the Trial Reels category, primary actions, the active tab, today's date, the Scheduled badge, the sorted column, rank numbers, the heatmap, compare-diff highlights and slide labels. | Apply the DESIGN.md palette. The type hues are Trial Reels teal `#14b8c4`, Explainers `#4169e1`, Carousels `#138510`, Stories `#c377e0`. Orange is only for things a person can act on. Heat and diff ramps become neutral. | `app/social-hub.css:5-8,206-210,288,473`, `hub-sections.css:23,30,36,56,89,116`, `AccountSection.tsx:73` | B1 | keep |
| G3 | P1 | [B] Contrast fails AA in nine places: white on orange 3.06:1 (active tab, today's date, every primary button), Scheduled badge 3.38:1, Failed badge 3.09:1, "Content ready" 4.18:1, neutral status 4.35:1, tile captions on #f5f5f5 4.35:1, orange summary links 3.06:1. | Primary buttons get Ink labels (5.9:1). The active tab and today's date get an Ink fill. Badges follow MATRICES.md: Needs you `#b8410c` on `#ffece3` (4.8:1), Failed `#b42318` on `#feeae9` (5.7:1), every other state Muted Ink. | `components.css:2522-2558` (hub nav), `social-hub.css:166`, `hub-sections.css:89` | B1 | keep |
| G4 | P1 | Green means Carousels, eyebrows, "Content ready", the "Current" version badge and "Published". | Green is used only as the Carousels mark and on upward delta arrows. "Published" becomes a check icon plus the word. | `social-hub.css`, `PostView.tsx:163` | B1 | keep |
| G5 | P1 | [B] Developer copy in the UI: SH-05/09/10/18/19/53/59, "Phase 2", "P2-M4", `db/social_hub_schema.sql`, META_API_CHECK, "pipeline rows", "Every pipeline", "Vertical", "descriptive numbers", "No content id.", "Same as Force on /reels", raw status enums. 83 `title` tooltips read "Turned off until Phase 2". | Rewrite everything in plain language with full type names. Disabled reasons use the MATRICES.md wording. | `HouseScreen.tsx:37,69,88,117,167,209,255`, `CompareTab.tsx:72,120`, `Controls.tsx:41,73`, `ProfileTab.tsx:18-27`, `MediaPreview.tsx:50`, `AnalyticsScreen.tsx:42-43`, `house.ts:142-212`, `ActionBar.tsx:43-46,65` | B2–B5 (`/impeccable clarify`) | keep |
| G6 | P2 | [B] Side-stripe borders: Content House rows (3px), day timeline cards (4px, rounded), compare header (3px top). | Remove them. Rows lead with a Content Type Mark (dot, icon, name) and a thumbnail. | `hub-sections.css:28,77`, `social-hub.css:340` | B2–B4 | keep |
| G7 | P2 | [B] An uppercase tracked eyebrow sits on every page ("SOCIAL HUB · CALENDAR") and every post section. Control labels, table headers and weekday names are uppercase too. | Breadcrumbs replace the eyebrows. Section titles and labels are sentence case (DESIGN.md No Eyebrow Rule). | `PageHead.tsx:7`, `social-hub.css:46-53,108-114,252-259,404-411`, `hub-sections.css:18` | B1 | keep |
| G8 | P2 | Every panel has a shadow at rest, and timeline cards lift on hover. | Panels are flat with a hairline border. Shadows go only on floating things: the drawer, menus and the compare tray. | `social-hub.css:69,348` | B1 | keep |
| G9 | P2 | [B] Unicode glyphs are used as icons (‹ › ↗ !). There are no type icons and no state icons. | Use Lucide: chevrons, `ExternalLink`, plus the type and state icons in DESIGN.md and MATRICES.md. | `CalendarScreen.tsx:29-37`, `PostScreen.tsx:14`, `ActionBar.tsx:43`, `PostView.tsx:74`, `CalendarMonth.tsx:59` | B1 | keep |
| G10 | P1 | Drill-downs are inconsistent: a post opens as a drawer from Calendar but as a full page everywhere else. Back always goes to Calendar, and the Calendar tab lights up on post pages. | One drawer over every list, using an intercepting route. Breadcrumbs and the back link follow `from`, and the active tab is derived from where you came from. | `PostRow.tsx:23`, `PostsTable.tsx:69`, `TopPerformers.tsx:19`, `CompareTab.tsx:56`, `PostScreen.tsx:14`, `HubTabs.tsx:18` | B1 | keep |
| G11 | P1 | [B] Three native selects and three GET forms do full page reloads, reset scroll to 0 and leave empty params (`f.format=&f.slot=`). The pager also jumps to the top. | `HubForm` / `useHubParams` call `router.replace` with `scroll:false` and drop empty params. The pager uses `scroll={false}`. | `AutoSubmitForm.tsx:16`, `Controls.tsx:24-75`, `PostsTable.tsx:43-47`, `CompareTab.tsx:84-91`, `HouseScreen.tsx:216-227`, `ContentTab.tsx:40-42` | B1 | keep |
| G12 | P1 | Disabled reasons are screen-reader-only. The "flag off" reason hides the real reason, and impossible actions are still shown (Hard regenerate on a posted Story set). | Reasons are visible text. An action that can never apply in the current state isn't rendered (MATRICES.md §2). | `ActionBar.tsx:41-69`, `house.ts:149-215` | A1 + B2 | keep |
| G13 | P2 | Dates mix formats on one screen: ISO `2026-09-10`, "Oct 8, 9:00 AM ET", "generated Oct 8, 7:00 AM". | One format everywhere: "Oct 8 · 9:23 AM", with relative time inside 48 hours ("in 2 h", "yesterday"). | `PostsTable.tsx:73`, `TopPerformers.tsx:20`, `HouseScreen`, `PostView` | B1 helper | keep |
| G14 | P2 | Trial Reels titles are stored in ALL CAPS, so chips and rows read identically ("MICROSOFT SAYS AI AGENTS…" ×3). | Display titles in sentence case, and tell duplicates apart by date and slot. | display helper in `lib/social-hub/views` | B1 | keep |
| G15 | P2 | Focus is inconsistent: default rings on cards, nav and checkboxes. After the drawer closes, focus lands on `<body>`. | One 2px orange focus ring everywhere. Focus returns to the element that opened the drawer. | `social-hub.css:168-171`, `PostDrawer.tsx:22-27` | B1 | keep |
| G16 | P2 | Touch targets are too small: chips 16.7px, checkboxes 13px (WCAG 2.5.8 asks for 24px). | Make targets at least 24px, and 32px for row actions. | `social-hub.css:292-306` | B1 | keep |
| G17 | P2 | The top tabs are `<button role=tab>` with no tab panels, so cmd-click can't open a new tab. | Make them links with `aria-current="page"`. | `components/hub-shell/SegmentedNav.tsx:91-104` | B1 | keep |
| G18 | P3 | Loading is a text card. Errors show raw `error.message`, and `LoadError` has no retry. | Use skeletons that match each layout, plain-language errors, and a Retry button. | `(hub)/loading.tsx` (removed by B1), `error.tsx`, `LoadError.tsx` | B1 | keep |

## C. Content (`/social`, the new default; replaces Content House and the old landing Calendar)

| ID | P | Problem | Fix | Where | Step | Keep |
|---|---|---|---|---|---|---|
| C1 | P0 | Today-first is inverted. `/social` opens on the month, "Today" is sub-tab 2 of the third top tab, and "needs you" is never a count. | Content is the default page. Its top line is "Today · Thu Oct 8" plus one status line: "6 of 9 slots filled · 2 need you · 62 of 100 posts left today". | `app/social/(hub)/page.tsx`, `HubTabs.tsx:12-18` | B2 | keep |
| C2 | P0 | "Needs approval" is a flat 28-item list spanning 12 days, with August carousels mixed in and no count. | **Needs you**, grouped Today / Tomorrow / Later, soonest first, with time left. Items older than 3 days fold into "Older (n)". | `house.ts:41-51`, `HouseScreen.tsx:150-175` | B2 | keep |
| C3 | P1 | Each row offers 4–6 actions, two of them primary. There are 54 disabled orange buttons. | One primary per item, per MATRICES.md (Approve when it needs you). Everything else goes in "More". Actions are live only once their flag is on; until then the row shows one honest link ("Approve in Trial Reels ↗"). | `ActionBar.tsx`, `house.ts:149-215` | B2 | keep |
| C4 | P1 | Rows have no media. A post is recognized by an ALL-CAPS title. | Every lineup row shows a 56px thumbnail: the first slide, the reel poster, or the first story frame. | `PostRow.tsx`, `MediaPreview.tsx` | B2 | keep |
| C5 | P1 | Today's lineup doesn't exist. The day timeline (`CalendarDay`) is the closest thing. | Build the lineup from `views/today.ts`, grouped by posting window, with a "now" divider. Published items show their metric against the type's median. In-production items show up too. | new `LineupItem`, `views/today.ts` | A3 + B2 | keep |
| C6 | P1 | Ideas is a flat 43-row table sorted alphabetically by type id, with scores on different scales sharing one column. | **Pools** shows one panel per type in the fixed order: depth, ready count, the next three, last refill. Each opens `/social/content/pools/[type]`, which shows that type's own score columns. | `HouseScreen.tsx:177-214`, `house.ts:85-89` | A3 + B2 | keep |
| C7 | P1 | The music and photo libraries aren't reachable from the hub. | A **Libraries** row links to Music pool (`/social/content/library/music`) and Photo bank (`/social/content/library/photos`), each with a fullness line. | new routes | B2, Phase C | keep |
| C8 | P2 | The quota card competes with the title, contradicts itself ("62 of 100 left" vs "11 media published… pipeline rows"), and uses jargon. | Fold it into the header status line. Its detail lives in a tooltip-free popover. | `HouseScreen.tsx:112-121` | B2 | keep |
| C9 | P2 | The read-only banner repeats on every tab with phase jargon. | Remove it. Disabled state is explained per item (G12). | `HouseScreen.tsx:68-70` | B2 | keep |
| C10 | P2 | Carousel "Regenerate ↗" goes to a read-only Ideas table. | Becomes a real action once A1's carousel rerun exists. Until then, link to the carousel's own page with plain text. | `house.ts:212` | A1 | keep |
| C11 | P2 | "Review slides, checks and sources" is offered only for carousels, and its orange summary text is 3.06:1. | Review happens in the drawer, the same for every type. | `HouseScreen.tsx:161-169` | B5 | keep |
| C12 | P2 | "Slot passed" shows only on On deck. Calendar and Today still say "Scheduled". | One state model everywhere (MATRICES.md S7/S13). | `house.ts` | B2 | keep |
| C13 | P2 | All content: "Newest 100 shown" with no pagination, sorted furthest-future first. | Removed. Browsing lives in Analytics' type pages (sortable and paged), and upcoming content lives on Calendar. | `HouseScreen.tsx:82-99` | B2/B4 | keep |
| C14 | P3 | Sources and Types are analysis inside the operating floor, with a 20-option native select. | Types becomes the Analytics by-type table, and Sources becomes a section on Analytics type pages. | `HouseScreen.tsx:216-279` | B4 | keep |

## K. Calendar (`/social/calendar`)

| ID | P | Problem | Fix | Where | Step | Keep |
|---|---|---|---|---|---|---|
| K1 | P1 | A needs-approval chip looks identical to a scheduled one, and mobile dots carry no state. | Days carry a "needs you" count badge and a failed mark. Phone days get a ring when something needs you. | `CalendarMonth.tsx:50-76`, `social-hub.css:311` | B3 | keep |
| K2 | P1 | Cells are walls of truncated titles (70 chips per month). | Past days show the day's metric total (tinted by percentile) plus per-type slot marks. Future days show quota per type, filled vs open. Titles move to the day panel. | `CalendarMonth.tsx`, `calendar.ts` | A3 + B3 | keep |
| K3 | P1 | `CHIPS_PER_DAY=3` shows the earliest three posts, so urgent ones hide behind "+N more". | No chips (K2). The day panel sorts urgent items first. | `lib/social-hub/calendar.ts:12` | B3 | keep |
| K4 | P1 | Clicking a day navigates away. The drawer from Calendar has no actions. | Clicking a day opens a side panel with that day's lineup (`LineupItem`) and every action, including "Schedule here" on open slots and Reschedule. | `CalendarScreen.tsx`, `CalendarDay.tsx` | A1 + B3 | keep |
| K5 | P2 | A header stack of eyebrow, a subtitle that never changes, and a legend shown on every visit. | Breadcrumb, a month summary strip (published, metric total, best day, failures, open slots ahead), and a toolbar. No legend, because every mark carries its icon. | `CalendarScreen.tsx:43-50` | B3 | keep |
| K6 | P2 | The day card repeats its title as its description, and its metric line has no comparison. | Show one title, plus the metric against the type's median. | `CalendarDay.tsx:27-29` | B3 | keep |
| K7 | P2 | Month view has no "Today" jump, and prev/next drop the other params. | Add a "Today" button. Navigation keeps the type toggles and the metric. | `CalendarScreen.tsx:28-38` | B3 | keep |
| K8 | P3 | The heatmap uses the orange ramp, and its hours aren't in ET. | Neutral ramp, converted to ET. | `AccountSection.tsx:64,73` | B4 | keep |

## A. Analytics (`/social/analytics` → `[type]` → post)

| ID | P | Problem | Fix | Where | Step | Keep |
|---|---|---|---|---|---|---|
| A1 | P1 | [B] The page opens on a filter card: on a phone it takes 416px, and the first number appears at 660px. With one type selected there are 13 native selects. | One quiet toolbar row: range pills, a custom range in a popover, a metric menu. Type is chosen by drilling, not by pills. Each type's own filters sit in a "Filters (n)" popover with chips and Clear. | `Controls.tsx:24-75` | B4 | keep |
| A2 | P1 | [B] 33 equal tiles with no headline, no comparison, and dead tiles. Content is grouped by format instead of type. | Overview: 4–5 KPIs with change vs the prior period, one trend line per type, then a **By content type** table (posts, median, sparkline, shares per post, cost per post, Δ) whose rows drill in. | `ContentTab.tsx:18-30`, `StatTiles.tsx` | B4 | keep |
| A3 | P1 | Tab order Profile / Content / Compare, with the middle tab as default. The title "Every pipeline". No type level, no breadcrumbs. | Real routes `/social/analytics` → `/social/analytics/[type]`, with the breadcrumb "Analytics › Trial Reels". Compare becomes a tray, not a tab. Profile folds into the overview. | `AnalyticsScreen.tsx:18-22,42-47` | B1 + B4 | keep |
| A4 | P1 | All 25 posts-table thumbnails are blank colour squares. Dates are ISO. "Compare selected" is always enabled with no count. Checkboxes are 13px. | Real thumbnails, the G13 date format, a sticky compare tray ("3 selected · Compare", enabled at 2–6), and 24px targets. Columns are sortable. | `PostsTable.tsx:18-23,43-47,73` | B4 | keep |
| A5 | P2 | "Total watch time" is labeled "average". | Fix the label logic. | `StatTiles.tsx:12` | B4 | keep |
| A6 | P2 | Profile shows two contradictory Views figures (account 297.2K vs posts 683.0K). Its empty state is schema jargon. | Label both scopes clearly ("Account views, all content" vs "Views on our pipeline posts"). The empty state reads "Account numbers appear after the first nightly sweep." | `ProfileTab.tsx`, `AccountSection.tsx` | B4 | keep |
| A7 | P2 | Compare is empty by default. It highlights 23 of 31 rows, "Slot" and "Posting slot" are duplicate rows, and columns have no thumbnails. | Reached only from the tray. Highlight the best value per row, merge the duplicate rows, and add thumbnails. | `CompareTab.tsx`, `analytics.ts:205-223` | B4 | keep |
| A8 | P2 | Top performers use orange Pragmatica rank numerals and ISO dates, with no thumbnails. | Muted rank, thumbnail, G13 date. Each opens in the drawer. | `TopPerformers.tsx`, `hub-sections.css:36` | B4 | keep |
| A9 | P3 | Group vs group duplicates Content House "Types", and group rows aren't drill links. | The by-type table replaces it. Factor groups on a type page link to the filtered table. | `CompareTab.tsx:77-122` | B4 | keep |

## P. Post (drawer over any list; full page on direct visit)

| ID | P | Problem | Fix | Where | Step | Keep |
|---|---|---|---|---|---|---|
| P1 | P1 | No actions in the drawer or on the page. Approval sits third in the side column. | The header carries state plus the actions from MATRICES.md (fill `PostView`'s `actions` slot). | `PostView.tsx:43,85-124`, `CalendarScreen.tsx:63-65`, `PostScreen.tsx:17` | B5 | keep |
| P2 | P1 | Before a post goes out, the drawer shows 9–14 "—" tiles and 13–15 mostly empty detail fields. | Show "Not posted yet. Numbers appear about 48 h after posting." Hide empty fields. After posting: four key metrics plus cost efficiency, with the rest under "All metrics". | `PostView.tsx:85-110,137-153` | B5 | keep |
| P3 | P2 | For reels, "Video not available here" takes half a phone screen. Slide labels are orange uppercase. Phase copy. | Show the poster frame with a play affordance, or a compact placeholder. Slide labels in Muted Ink sentence case. | `MediaPreview.tsx:13,50`, `social-hub.css:473` | B5 | keep |
| P4 | P2 | Contradictory times ("Scheduled for Oct 9, 7:11 AM ET · Morning · 9:00–10:00 AM"). | Show one time plus its window name, and say so when it's outside the window. | `PostView.tsx:60-77` | B5 | keep |
| P5 | P2 | On a phone, Close sits top-left out of thumb reach, and "Open as a page" is faint. | Close at top-right, plus a bottom sheet handle on phones. "Open as a page" becomes a clear secondary link. | `PostDrawer.tsx:44-45` | B1 + B5 | keep |
| P6 | P2 | The chart has a single line and no benchmark, and its pills duplicate the tiles. | Add the type's median line for the same days-since-post, and a metric menu instead of pills. | `MetricChart.tsx:50-60` | B5 | keep |
| P7 | P3 | The "Current, the one that posts" badge uses the green ready style even when the item isn't scheduled. | Neutral "Current version" badge, and the "posts" wording only when it's scheduled. | `PostView.tsx:155-168` | B5 | keep |
| P8 | P3 | "Open in Trial Reels" leaves the hub with no warning. | Use the `ExternalLink` icon and the text "Opens Trial Reels". | `PostView.tsx:74` | B5 | keep |

## Power-user items (deferred until the redesign settles)

| ID | P | Item | Keep |
|---|---|---|---|
| X1 | P2 | Keyboard: `j`/`k` to move through Needs you, `a` to approve, `r` to reject, `/` to filter (`Esc` closing the drawer is in B1 regardless). | **deferred** (2026-10-08) |
| X2 | P2 | Bulk approve: select several items under Needs you and approve them together. | **deferred** (2026-10-08) |

## R2. Second critique (2026-10-08, 28/40, up from 19): fixed in round R3

| # | Sev | Problem | Done | Where |
|---|---|---|---|---|
| R2-1 | P1 | The orange "28 need you" counted Later and Older items, plus Carousels nobody can approve while hub approval is off. | The header counts only what you can act on now (due today or tomorrow, or made and waiting), plus a quiet "N can't be approved here yet". Rows with no path get the quiet **Approval off** state (MATRICES S3b) and sort last. The calendar's ✋ counts use the same rule. | `views/offer.ts`, `views/state.ts`, `ContentScreen.tsx`, `views/calendar.ts` |
| R2-2 | P1 | "Schedule something here" opened onto a switched-off button. | While scheduling is off, the slot says how many are ready and links to the pool. | `CalendarScreen.tsx` `ReadyFor` |
| R2-3 | P1 | "Scheduled · Slot passed at 11:59 AM". | New **Late** state (MATRICES S7b), Failed tone: "Was due 11:59 AM and hasn't posted yet". | `views/state.ts`, `ui/marks.tsx` |
| R2-4 | P1 | An open slot listed beside a post already in that window. | Windows come from the post's time; the recorded slot id is only a fallback. Today's closed windows aren't offered. | `views/plan.ts`, `views/calendar.ts` |
| R2-5 | P1 | Pool "#1 · Rank 3"; State and Added columns identical on every row. | The # column is gone; uniform columns fold into one sentence above the table. | `PoolScreen.tsx` |
| R2-6 | P1 | Two versions of one topic looked identical. | Ready items say when they were made; lines never repeat the row's clock time; mid-sentence day words are lowercase. | `views/state.ts`, `views/format.ts` `whenInline` |
| R2-7 | P1 | Phone tables scrolled sideways inside 356px; ranked column off-screen. | Under 720px every table stacks: lead cell, then labelled values ("13.6K views · 299 shares · $3.56 cost"). Names wrap to two lines. | `app/social-hub.css` `.sh-table--stack`, tables in Posts/Overview/Type/Pool/Music |
| R2-8 | P1 | Charts were hover-only. | Pointer events (tap pins a day); the trend chart steps with arrow keys and has an HTML key on phones; leader lines tie end labels to their lines. | `TrendChart.tsx`, `MetricChart.tsx` |
| R2-9 | P1 | 21px links and 30px buttons on touch. | Coarse pointers get 44px buttons, 40px pills, padded name links. | `app/social-hub.css` |
| R2-10 | P2 | Calendar: rings everywhere, heat looked like out-of-month, legend incomplete, no comparison. | Open rings only today and tomorrow; out-of-month days are plain and faded; swatch legend for every mark and the shading; the summary compares with the same days last month. | `views/calendar.ts`, `CalendarScreen.tsx`, `hub-calendar.css` |
| R2-11 | P2 | "What's working" read "about typical" everywhere, with no way to read the bar. | One-sentence verdict, a signed % against the median, a median tick on each bar, a plain gloss for factor names whose meaning is settled. | `views/analytics.ts` `workingVerdict`, `views/factor-gloss.ts`, `TypeScreen.tsx` |
| R2-12 | P2 | Focus ring ~2.9:1. | `--sh-focus` `#b8410c` (7.7:1). DESIGN.md updated. | `app/social-hub.css` |
| R2-13 | P2 | Month grid announced as a grid, with no arrow keys and about 35 tab stops. | One tab stop, plus arrow, Home and End keys. | `calendar/MonthGrid.tsx` |
| R2-14 | P3 | Small items. | Previous/next day in the day sheet; a past day's total and "best day" in its sheet; stale pools flagged ("No refill in 49 days"); the post page no longer repeats one failure; Compare keeps a single pick; duplicate thumbnail tab stops removed; notes capped at 70ch; opaque sticky toolbar; slide strip fade; KPI arrows no longer shrink to dots. | various |

## R3. Third critique (2026-10-08, 28/40; R2 items closed, deeper findings): fixed in round R4

| # | Sev | Problem | Done | Where |
|---|---|---|---|---|
| R3-1 | P1 | From "All types", clicking a Calendar type hid it. | A click from All shows only that type; after that, clicks add and remove. | `calendar/CalendarControls.tsx` |
| R3-2 | P1 | Needs-you counts disagreed (Oct 9 badge 3 vs 2 rows in its sheet; "Made tomorrow"). | A day counts only content placed on it, which is what its sheet lists. No future made times. Header: "N need you · N later · N can't be approved here yet". | `views/calendar.ts`, `views/state.ts`, `ContentScreen.tsx` |
| R3-3 | P1 | Red states dead-ended. | Late rows link to "Check it in [type]"; the drawer reads "Was due …". Stale pools carry the alarm onto their own page, with where to look. | `views/actions.ts`, `PostView.tsx`, `PoolScreen.tsx`, `views/pools.ts` `poolStale` |
| R3-4 | P2 | Approval-off rows and a 4-line note pushed today down the phone. | They fold into one collapsed "Can't be approved here yet" group that carries the explanation; the note is gone. | `ContentScreen.tsx` |
| R3-5 | P2 | Pipeline vocabulary and a wrong gloss. | "Judge score (0–3)", "Idea judge: …", raw status and row-constant details dropped, ISO dates shortened, an Explainers Origin gloss, verdicts phrased "Posts in “X” beat the median by N%". | `adapters/carousels.ts`, `adapters/explainers.ts`, `factors.ts`, `views/factor-gloss.ts`, `views/analytics.ts`, `PoolScreen.tsx` |
| R3-6 | P2 | Detector: out-of-month text at 2.1:1, photo credits cut off on phones, swatch radius off scale, prose over 75ch. | Only the marks fade; credits wrap; swatch square; `p.sh-subtle` at 75ch. The CLI detector is now clean (`[]`). | `hub-calendar.css`, `hub-content.css`, `app/social-hub.css` |
| R3-7 | P3 | Small items. | Plain error pages with Retry and the raw reason tucked away; hub bar opaque; tabs and compare picks sized for touch; open rings 2px; a lone fifth KPI spans the row; one exit per type in the drawer; drawer quiet button aligned; compare "best" by weight, not a rule; custom range in short dates; orphan type mark and off-axis caption removed. | various |
