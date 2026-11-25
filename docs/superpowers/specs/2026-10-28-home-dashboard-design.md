# Home dashboard: design

Status: brainstorm output, awaiting approval. Nothing is built.

## Intent

The Hub's Home page (`/`, `app/page.tsx`, `components/hub-home/HubHome.tsx`, `lib/home/loadHome.ts`) becomes the page you land on to be told what to do next, with as few clicks as possible. It serves Tommy and Lucas (and later anyone who logs in), and each person's Home can look different.

Why: the first idea was a "central health screen" that reports on every feature. Lucas's feedback was that Home should be intuitive: the action you need to take, served to you, with fewer clicks. Fig's refinement: "fewer clicks" does not mean zero clicks. Sometimes the action is just seeing a number ("what's our SEO position"). Sometimes it is a button that does the thing (approve a post). Sometimes it is a button that jumps to the right screen because the task is too big for a widget (email campaign management).

## Shape of the page

One page, a grid of widgets, like an iPhone home screen or Control Center.

- Every item on the page is one of three kinds:
  1. **Glance.** Shows a number or short status and nothing else to click. Must show one headline metric and a visible time frame (for example "clicks, last 7 days vs previous 7"). Never a metric without its time frame.
  2. **Inline action.** The thing can be done on the page: approve or reject a post, check off or move a Trello card.
  3. **Jump.** A button that goes straight to the relevant screen, used when the task is too big for a widget.
- Positions are stable, like an iPhone home screen. A widget stays where the user put it. A widget that needs the user shows a small badge with a count (decided); it does not move. A widget with nothing to do keeps its spot in a compact "all clear" state (proposed, see My calls) instead of disappearing.
- Each widget has size variants (for example small, medium, large). Size changes how much it shows, for example one number vs the number plus a trend line, or two Trello cards vs the whole column with paging arrows. Users change size and layout only. No colors or themes.
- Users add widgets from a catalog, remove them, resize them, and rearrange them. All of it happens in an edit mode entered with an "Edit Home" button in the page corner (decided). Edit mode shows handles to drag, resize, and remove, plus an "Add widget" picker; a Done button exits. Outside edit mode the page has no customization controls.
- The grid is slot-based (decided), not free-form: a widget occupies a slot and picks one of its size variants. The exact slot grid is the builder's call.
- Home must work well on phones as well as desktop (decided; Tommy and Lucas both use it on their phones). On a phone the slots collapse to a single column that keeps the same order, with the default order Trello, Social approvals, Outreach, SEO (Trello first, decided). Edit mode must work by touch.
- A new user sees a sensible default set. There is no separate setup survey.

## v1 widgets (decided)

v1 ships six widgets: Trello pinned column, Social approvals (slideshow), SEO position, AI spend, Social analytics, and Outreach. Networking and the system status light are a second round.

Default Home for a new user (decided): exactly three widgets on: Trello, Social approvals, and SEO position. Trello is the large box on the left; Social approvals is on the top right; SEO position is underneath it. AI spend, Social analytics, and Outreach are in the Add widget picker, off by default (Outreach because the users rarely use Outreach Hub).

Outreach widget content (my call, based on a read-only check on 2026-10-28): the worker was heartbeating, 2 campaigns were live, and 62 emails sent in the prior 7 days, but zero replies were recorded in 30 days and no inbound email was stored since 2026-09-10. It is unconfirmed whether replies truly stopped or reply tracking is not reaching the Hub tables since sends moved to the provider hand-off. So the v1 Outreach widget shows emails sent in the last 7 days vs the previous 7, plus worker and queue health, with a jump to Outreach Hub. A reply count or replies-to-answer list is deferred until the reply data path is confirmed. The builder should verify this before promising any reply feature.

## Added after the importance check

The user named AI spend, SEO of the site, and social analytics as the most important things to track. SEO is already a v1 widget. Two more widgets follow, both following the one-card-anatomy rule. The rule for picking each headline: choose the number that would change what the team does this week (the user's decision was to let Claude pick using that rule; these headlines are my calls and are expected to be revisited in the two-week review). Both widgets are v1 catalog widgets and are off by default (decided): they sit in the Add widget picker.

- **AI spend (my call).** Headline: AI spend this week vs last week, with month to date shown beside it, and a link to the Social Hub cost screen for the breakdown by content type. Data exists: `components/social-hub/cost/CostScreen.tsx`, `lib/social-hub/cost.ts` (spend by content type, waste, cost per post) and `outreach.anthropic_cost_report_days`. The builder should confirm which source gives a whole-Hub total, since the Social cost screen covers Social only. Small size: the number, the comparison, and the time frame. Large size: adds spend by content type.
- **Social analytics (my call).** Headline: account reach this week vs last week, because reach is the number content choices move. Data exists in `social_hub.account_insights_daily`, `social_hub.media_insights` (per post), `social_hub.online_followers_daily`, and `social_hub.account_demographics_daily`, shown today on the Social Hub analytics page. Small size: reach, the comparison, and the time frame. Large size: adds net follower change and the best post of the week. Links to the Social Hub analytics page.

The builder should confirm what each of these tables actually holds before promising a metric.

## Widget details

- **Trello column.** One tall vertical list of cards with deadlines. Arrow buttons at the bottom page through the columns the user has pinned. A Trello column gets an "add to home page" action that pins it. Cards assigned to the viewer are marked. Inline actions: check off, move.
- **Social Hub widget (decided: a trimmed version of the Social Hub "Today" controller; the full Today page has too many actions for Home).** Shows a summary line ("X to approve, first by [time]"), the content itself (the post cards that need a person), and exactly three actions on each: Approve, Regenerate, Archive (decided). It also has one jump button into the Social Hub. It does not carry the Settings switches (Live, nightly run) or Run now, which stay inside the Social Hub. All three actions already exist on the Social Hub card and are built by `actionMenu` in `lib/social-hub/views/actions.ts`: Approve ("Approve slot" or "Approve and schedule" in some states; ranked primary for a post that needs a person), Archive (labeled "Archive", confirms with "Archive this post?", a danger action, ranked secondary next to Reject), and Regenerate (labeled "Regenerate", or "Rebuild post" for AI Events; ranked under "More", confirms with "Make a new version?"). Home reuses `actionMenu` and its confirmations as they are and does not remap or reimplement them. The menu can also report that approving is turned off for a content type, or that a type is reviewed on its own page (reels, explainers, stories); in those cases the widget shows the card's own "Review in [type]" link instead of dead buttons. Regenerate makes live model calls, so it must keep whatever confirmation and cost behavior the Social Hub card already has; a human click is the approval and Home never triggers it on its own. Reuse the existing approval components and logic from `components/social-hub/content/ContentScreen.tsx` instead of reimplementing them. Nothing posts without human approval, which is existing Social Hub policy and is unchanged here.- **Outreach.** Shown only when it needs a human (a reply to answer, a stuck send), plus an optional glance such as replies this week vs last. Jump to Outreach Hub for anything larger.
- **SEO position (v1, decided).** Shows heliosgroup.ai only, no site picker. Data already exists: the Google Search Console warehouse (`db/seo_schema.sql`, `seo.daily_totals`, synced daily by the `seo.gsc_daily_sync` worker job), read through `lib/seo/repository.ts` `getSummary` as `app/api/seo/summary` does. Headline is average position, labeled with real dates (for example "Oct 19 to 25, vs Oct 12 to 18"), with a better/worse arrow against the previous period (lower position number is better). Search Console data lags a couple of days, so the label says the latest week available. Small size: number and arrow. Large size: adds a trend line and biggest movers. Links to SEO Performance (`/seo`).
- **Networking.** An upcoming event, only when close enough to act on, or days until the next event.
- **System status light.** One indicator for "something is failing right now" (worker down, sync broken). Invisible when healthy.

## Sizes (decided)

Every widget has two sizes, small and large. On a phone every widget is full width and size only changes height.

- Trello: small is the next 3 cards of the current column with the paging arrows; large is a box that fits about 15 lines, with the card list scrolling up and down inside it (decided; the user does not want one super long Trello widget). The builder should make sure scrolling inside the box does not trap page scrolling on touch.
- Social (decided: a slideshow, one piece at a time): the widget shows one piece of content at a time and the user pages through the pieces with previous/next arrows and a position label like "2 of 5", the same paging pattern as the Trello widget. Each piece shows its own Approve, Regenerate, Archive. Small is the "X to approve" line plus a compact view of the current piece; large is a bigger view of the current piece (a better look at the content before approving). It is not one long list of every post. The 15-line scroll cap was for Trello only. The slideshow holds only posts that need a person (decided). When none do, the widget stays in place in its quiet state and shows the next scheduled post (decided).
- SEO: small is average position, the better/worse arrow, and the dated time frame; large adds a trend line and the biggest movers.
- Outreach: small is emails sent in the last 7 days and a health dot; large adds the previous-week comparison and queue status.

## Consistency and trust (decided, from dashboard-design research)

- **One card anatomy.** Every widget header follows the same shape: name, the number or content, the change or comparison, and the time frame. The SEO widget already works this way; Trello, Social, and Outreach follow it.
- **Freshness stamp.** Every widget shows when its data was last updated (for example "updated 2h ago"), and stale data looks stale. This matters because Search Console data lags a couple of days and the Outreach reply data path is unconfirmed.
- **Round numbers.** Numbers are rounded; the SEO average position shows as a whole number with a better/worse arrow instead of one or more decimals.
- **Post-launch review.** After roughly two weeks of real use, check which widgets get used and which are ignored, and revise the catalog and defaults.

## Goals

- Land on Home and know the next thing to do, without hunting through the sidebar.
- Common actions are doable on Home.
- Each person can shape their own Home.
- Every number has a visible time frame.

## Non-goals (for now)

- **Client Dashboards.** Dropped from this page for now. (Client Dashboards is a project-progress feature fed by GitHub, and Home currently has a "My Client Dashboards" carousel; that carousel is removed or left unchanged by the builder's call below, but no new Client Dashboards widget is designed.)
- A separate "health and analytics" page. Parked for later. This is one page.
- Colors, themes, or any visual restyling per user.
- A first-run setup survey.
- Drag-and-drop polish and free-form resizing beyond named size variants are not required in v1 if they slow the work down (builder's call).

## Anti-goals

- A page that mostly reports numbers nobody acts on.
- A metric shown without its time frame.
- Widgets that each show a pile of numbers instead of the one that matters.
- Any widget that triggers paid API calls on page load or by itself. Home is a lookup surface. This follows the project's hard rules (see `CLAUDE.md`): no sweeping the database to enrich, and no live Claude or `web_search` calls from Home.

## Constraints

- Existing stack: Next.js on Vercel, Supabase Postgres, authorization in app code (not RLS), per the repo's `CLAUDE.md`.
- Per-person layout means per-user storage of which widgets are on, their order and size, and widget settings (for example which Trello columns are pinned).
- Home must work for a logged-in user; logged-out users keep the existing login form.
- Data for widgets should come from what the Hub already stores or already fetches (for example `loadHome` already loads project data). Which metrics are actually available (SEO position especially) has not been verified and is the first thing a builder checks.
- Inline actions on Home must use the same authorization and approval rules as the full feature screens.

## Decided by the user

- Home only, one page, not two screens.
- Customizable by the user: add, remove, rearrange, size. Not colors.
- Items are glance / inline action / jump, per Fig.
- Trello is a pinned-column widget with arrow paging.
- Client Dashboards is out for now.
- Time frame on every metric, one metric per widget, per Lucas.

## My calls (not yet confirmed by the user)

- No separate setup survey; the widget picker is the setup and settings screen.
- New users get a default widget set.
- Cards assigned to the viewer are marked inside a pinned column; the column shows all its cards.
- Widgets keep their position and show a compact "all clear" state when there is nothing to do (replaces my earlier "widgets hide" idea, which conflicts with stable positions).
- The first-catalog widget list above and the leading metric for each glance widget.
- Size variants are a small fixed set per widget, not free resizing.

## Answers from the builder review

From the code (verified 2026-10-28):
- **Trello is Hub-native, not an external API.** It lives in the `boards` schema of the same Postgres (`db/trello_schema.sql`), with auth through `outreach.users` and access through workspace membership (`boards.workspace_members`) and per-board membership (`boards.board_members`). So the Trello widget reads and writes the Hub's own tables: data is live, there are no external rate limits, and a user can only pin columns on boards they can already open in `/trello`. "Move" and "check off" reuse the existing actions in `app/trello/actions/`. The builder confirms how card assignment is stored, since "cards assigned to the viewer" needs it.
- **"Needs a person" for Social** is the Social Hub's own state `needs_you` (`lib/social-hub/views/state.ts`, offered through `lib/social-hub/views/offer.ts`), which is what `ContentScreen` counts for "X to approve". The slideshow, the badge count, the summary line, and the quiet state all use that one definition; Home does not invent its own.

My calls (not yet confirmed by the user):
- **Who sees what.** Every logged-in user sees every v1 widget, the same access the full feature screens give, and Trello pins are limited to boards the user can already open. Server actions reuse the existing authorization, per the repo's app-code authz rule. The users today are Tommy and Lucas.
- **Regenerate confirmation.** Regenerate keeps the Social card's existing confirmation. In the widget it is an inline confirm step, not a modal, and shows the cost estimate if the Social card does.
- **Launch.** Tommy and Lucas both get the new default three-widget Home on launch. The "My Client Dashboards" carousel is removed from Home, since Client Dashboards is out of this page for now; the Client Dashboards feature itself is untouched.
- **Layout storage.** One layout per user, shared across devices: an ordered list of widgets with sizes. Desktop places them in slots from that list; phone shows the same order in one column. Editing on a phone changes the same layout.

"Archive" on a Social post is not open: it is the existing Archive action on the Social Hub card (see the Social Hub widget above).

## Left to the builder

- Data model and storage details for layouts and pins.
- The widget registry and rendering approach.
- Layout grid and responsive behavior.
- Which first-catalog widgets ship in v1 and in what order, depending on which data and inline actions are feasible.
- What happens to the current "My Client Dashboards" carousel on Home.
