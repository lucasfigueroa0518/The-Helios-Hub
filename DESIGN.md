---
name: Helios Social Hub
description: One place to run the Helios content machine, see what's going out, step in only where needed, learn what's working.
colors:
  helios-orange: "#ff5e1a"
  helios-orange-hover: "#e54e0f"
  helios-orange-ink: "#b8410c"
  helios-orange-soft: "#ffece3"
  helios-green: "#138510"
  helios-green-soft: "#e7f3e7"
  type-reels: "#14b8c4"
  type-explainers: "#4169e1"
  type-carousels: "#138510"
  type-stories: "#c377e0"
  failed-ink: "#b42318"
  failed-soft: "#feeae9"
  positive-ink: "#126b3a"
  canvas: "#fafafa"
  surface: "#ffffff"
  surface-sunken: "#f5f5f5"
  surface-hover: "#f0f0f0"
  hairline: "#e5e5e5"
  hairline-strong: "#d4d4d4"
  ink: "#171717"
  ink-muted: "#525252"
  ink-subtle: "#737373"
  chart-grid: "#f0f0f0"
  chart-axis: "#a3a3a3"
typography:
  page-title:
    fontFamily: "Pragmatica Extended, Roboto, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  section-title:
    fontFamily: "Roboto, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.3
  kpi-value:
    fontFamily: "Roboto, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.1
    fontFeature: "\"tnum\" 1"
  body:
    fontFamily: "Roboto, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Roboto, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
  data:
    fontFamily: "Roboto, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "\"tnum\" 1"
rounded:
  sm: "6px"
  md: "12px"
  lg: "16px"
  pill: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
components:
  button-action:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
  button-action-hover:
    backgroundColor: "{colors.surface-hover}"
  button-primary:
    backgroundColor: "{colors.helios-orange}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.helios-orange-hover}"
  segment:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "28px"
  segment-selected:
    backgroundColor: "{colors.helios-orange}"
    textColor: "{colors.surface}"
  choice-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "28px"
  choice-pill-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
  badge-needs-you:
    backgroundColor: "{colors.helios-orange-soft}"
    textColor: "{colors.helios-orange-ink}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  badge-making:
    backgroundColor: "{colors.helios-orange-soft}"
    textColor: "{colors.helios-orange-ink}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  badge-failed:
    backgroundColor: "{colors.failed-soft}"
    textColor: "{colors.failed-ink}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  badge-state:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "16px 24px"
---

# Design System: Helios Social Hub

## 1. Overview

**Creative North Star: "The Quiet Control Room"**

The Social Hub is a room the team walks into every morning to check on a machine that mostly runs itself. The room is quiet: neutral surfaces, hairline structure, numbers set plainly. Instruments light up only when something needs a person, and the one thing that needs you is the loudest thing on the screen. Calm is the default state; color, weight and motion are spent only on attention and state.

Density is moderate and earned. A screen leads with its answer (today's lineup, the account's direction, a type's best posts), then supporting detail, then the long tail behind a click. The hierarchy is account, then content type, then post, and moving down never throws away the list you came from. Posts are recognized by their media, the way Instagram's Professional Dashboard shows them, never by an id.

This system rejects walls of equal tiles, pages that open on a filter form, many tabs of equal rank, and the generic SaaS template of hero metrics, gradient accents, an uppercase eyebrow over every section and identical card grids.

**Key Characteristics:**
- Flat, hairline-structured surfaces; elevation only for things that float.
- One primary action per region, in Helios orange; everything else is quiet.
- Content types are told apart by a solid dot, an icon and a name, never by color alone.
- Lifecycle state is an icon plus a word; only Failed and Needs you carry color.
- Numbers use tabular figures and always travel with a comparison, a trend or a cost.

## 2. Colors: The Instrument Panel Palette

Restrained neutrals carry the room; one action color, one metadata color, four content-type hues for identity, and two state colors for attention.

### Primary
- **Helios Signal Orange** (#ff5e1a): the action color. Primary buttons (with white labels), the selected pool tab, and the "where you are, what's next" marks on the pool screen (see The One Signal Rule). Never a category, never a decoration, never a chart series.
- **Signal Orange Ink** (#b8410c) on **Signal Orange Wash** (#ffece3): the "Needs you" badge, the count of items waiting on a person, and on the pool screen the Making badge and the Up next band. Signal Orange Ink is also the focus ring.

### Secondary
- **Helios Metadata Green** (#138510) on **Green Wash** (#e7f3e7): structural metadata only in Helios brand work; inside the hub it doubles as the Carousels type hue (see Tertiary). It is never used for success or "published".

### Tertiary: content types (fixed order: Text on Screen, Explainers, Carousels, IG Stories)

Text on Screen moved to teal (decided 2026-10-08) so red stays free for Failed; Carousels green and Story purple keep the hub's existing hues, and blue is the Networking blue.
- **Reel Teal** (#14b8c4): Text on Screen.
- **Explainer Royal Blue** (#4169e1): Explainer Reels (the hub's Networking blue).
- **Carousel Green** (#138510): Carousels.
- **Story Orchid** (#c377e0): IG Stories (the hub's Website Hub purple).

This order passes the categorical validator (worst adjacent colorblind separation ΔE 21.5). Reel Teal and Story Orchid sit below 3:1 against the canvas, so a type hue is only ever a mark (dot, line, bar, swatch), always beside its name.

### Neutral
- **Canvas** (#fafafa): page background.
- **Surface** (#ffffff): panels, tables, the drawer.
- **Sunken Surface** (#f5f5f5): toolbars, table headers, quiet wells.
- **Hover Surface** (#f0f0f0): row and button hover.
- **Hairline** (#e5e5e5) and **Strong Hairline** (#d4d4d4): every border and divider.
- **Ink** (#171717): primary text and selected choice pills. Never pure black.
- **Muted Ink** (#525252): secondary text (7.5:1 on canvas).
- **Subtle Ink** (#737373): tertiary text and captions only (4.5:1 on canvas; never smaller than 11px).
- **Failed Ink** (#b42318) on **Failed Wash** (#feeae9): the Failed badge and error notes.
- **Positive Ink** (#126b3a): upward deltas, as text beside an arrow, never a fill.
- **Video overlays:** a semi-transparent black (`rgba(0,0,0,0.6)`) with white text behind a video's running time, and a dark player well (#262626) behind a reel preview. Only on top of media, never as a surface.

### Named Rules
**The One Signal Rule (widened 2026-11-15).** Orange appears where a person can act, where they are and what's next, and for a moment after they act. Where you are and what's next: today's column on the board, the Up next band and its positions, pinned pins, Making badges, the drop line while dragging, and the "days of topics" runway bar. Confirming an action: a sub-second orange flash after Pin, Make it, a drop, or Undo, with a reduced-motion fallback. Everywhere else orange is still never decoration: if orange is on screen and it marks neither an action, a place, what's next, nor a just-finished action, it is wrong.

**The Mark, Not Ink Rule.** Content-type hues color marks (dots, lines, bars), never text. Every label, value and legend entry is set in Ink, Muted Ink or Subtle Ink.

**The Quiet State Rule.** A lifecycle state is an icon and a word in Muted Ink. Only Failed (Failed Ink on Failed Wash) and Needs you (Signal Orange Ink on Signal Orange Wash) get color, plus Making on the pool screen (Signal Orange Ink on Signal Orange Wash, decided 2026-11-15). Published is a check icon, not green.

**The Health and Cost Exception (2026-10-13).** On the Health tab and the Cost page only, Helios Green (#138510) is the highlight and the success color: the active toggle, "worked" night blocks, check marks, reward chips, progress fills and "under pace" states. Short uses amber ink (#a15c07) on amber wash (#fdf3e1); Failed keeps Failed Ink on Failed Wash. Carousels keep green as their type mark in charts. Every other hub screen keeps The Quiet State Rule. Rewards (streaks, new bests, fixed problems, clean-night glow) appear only for real good news; a bad morning stays calm.

## 3. Typography

**Display Font:** Pragmatica Extended (with Roboto fallback), page titles only
**Body Font:** Roboto (with system sans fallback)

**Character:** One working family, Roboto, carries every label, number and sentence; Pragmatica Extended appears once per page, in the page title, as the Helios signature.

### Hierarchy
- **Page title** (700, 24px, 1.2): one per page ("Today · Thu Oct 8", "Text on Screen"). Pragmatica Extended.
- **Section title** (600, 16px, 1.3): "Needs you", "Today's lineup", "By content type". Sentence case, Roboto.
- **KPI value** (600, 28px, 1.1, tabular figures): headline numbers in a KPI strip. Roboto, never Pragmatica.
- **Body** (400, 14px, 1.5): descriptions and notes; cap prose at 70ch. Never smaller than 12px anywhere.
- **Data** (400, 14px, tabular figures): table cells and metric lines; numbers right-aligned.
- **Label** (500, 12px, 1.4): column headers, axis labels, captions. Sentence case.

### Named Rules
**The No Eyebrow Rule.** No uppercase tracked kicker above sections. Breadcrumbs say where you are; section titles say what you're looking at.

**The Pixel Root Rule.** The app root is 13px (`app/globals.css` sets `html, body { font-size: 0.8125rem }`), so every rem token renders at 0.8125x. Social Hub type is set in px (or rem tokens re-based inside `.sh`), never raw rem; nothing renders below 12px.

**The Tabular Rule.** Every number that can sit above another number uses tabular figures and right alignment.

## 4. Elevation

Flat by default. Surfaces are separated by hairlines and by the step from Canvas to Surface, not by shadow. Shadows appear only on things that float above the page: the post drawer, menus and popovers, the compare tray, toasts.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 8px 24px -8px rgba(0,0,0,0.1)`): menus, popovers, the compare tray.
- **Overlay** (`box-shadow: 0 12px 40px -12px rgba(0,0,0,0.15)`): the post drawer and day panel.

### Named Rules
**The Flat-At-Rest Rule.** Panels at rest have no shadow. If every panel on the page has a shadow, none of them are floating.

## 5. Components

### Buttons
- **Shape:** gently rounded (6px) for actions; this is how a person *does* something.
- **Primary:** Signal Orange fill with a white label, 32px tall, 14px side padding. At most one per region. White on #ff5e1a is about 2.9:1, under the 4.5:1 text bar; Tommy accepted that trade-off to keep the orange bright and every label on orange white (decided 2026-11-15). Hover deepens to #e54e0f.
- **Action:** Surface fill, Strong Hairline border, Ink label; hover to Hover Surface.
- **Disabled:** 55% opacity and the reason visible as text next to or under the button, never screen-reader-only.
- **Focus:** 2px outline in Signal Orange's ink step (`#b8410c`, token `--sh-focus`), 2px offset. The base orange is only ~2.9:1 on the page, under the 3:1 a focus indicator needs.
- **Pending:** label stays, a 14px spinner replaces the icon, the button ignores clicks; the result note appears inline after.

### Choice Pills
- **Style:** fully round (9999px), 28px tall, Hairline border, Muted Ink label. This is how a person *chooses* something (range, metric, mode).
- **Selected:** Ink fill, Surface label.
- Pills never perform actions, and action buttons are never pills.

### Segmented Control
- **Style:** Sunken Surface track with a Hairline border, 2px inner padding, 6px corners; segments 28px tall, 14px side padding, Muted Ink label (500) with a tabular count.
- **Selected (pool tabs, decided 2026-11-15):** Signal Orange fill, white label and white count. The unselected segment stays grey.
- Hub navigation tabs keep their Ink-filled selected state (see Navigation); only the pool's Ideas | Made tabs go orange.

### Content Type Mark (signature)
- A solid 8px dot in the type hue, a 14px Lucide icon (Text on Screen: clapperboard; Explainers: presentation; Carousels: gallery-horizontal; IG Stories: sparkles; circle-dashed is reserved for the Ready state) and the type name in Muted Ink. In dense rows the name may drop, the dot and icon never do.

### State Badge (signature)
- Pill, 2px by 8px, icon plus word. Default: Surface fill, Hairline border, Muted Ink.
- **Needs you:** Signal Orange Wash fill, Signal Orange Ink, hand icon, with time left ("2 h left").
- **Failed:** Failed Wash fill, Failed Ink, alert icon, with the reason one click away.
- **Making (pool screen):** Signal Orange Wash fill, Signal Orange Ink, spinning loader icon.
- States and icons: In production (loader), Ready (circle-dashed), Approved (check), Scheduled (clock), Posting (upload), Published (circle-check), Rejected (ban), Cancelled (circle-slash), Skipped (skip-forward).

### Panels
- **Corner Style:** 12px.
- **Background:** Surface on Canvas.
- **Shadow Strategy:** none at rest (see Elevation).
- **Border:** 1px Hairline.
- **Internal Padding:** 16px by 24px. Panels never nest; inside a panel, group with spacing and hairline dividers.

### Pool screen (decided 2026-11-15)
One screen that every content type's page uses for its own pool. Its job is picking what's next. The mock at `docs/superpowers/specs/mocks/2026-11-15-pool-screen.html` is the reference; the item noun ("topics", "tips", "stories") comes from the type's settings.
- **Header:** breadcrumbs, the page title with the type dot, then one Muted Ink line ("32 topics waiting · 6 made in the last 30 days"). Under it, the runway bar: a 120px by 6px pill track in Hover Surface with a Signal Orange fill, and "Enough topics for **N days** of posts" with the number in Signal Orange Ink.
- **Next three days board:** a section title, the date range, and ‹ › icon buttons to step. Three day columns (Surface, Hairline, 12px corners). Today's column has a Signal Orange border, a 3px Signal Orange Wash ring and an orange Today chip with a white label. Each slot shows its made post (thumbnail, time, state badge) or, if nothing is made yet, the idea that will fill it (dashed thumbnail, when it gets made). An open slot is a dashed, Subtle Ink note. On a phone the columns scroll sideways and snap.
- **Ideas | Made tabs:** the segmented control above, with each count matching its list. Seed sits at the right of the same row; at the cap its reason shows as text.
- **Up next and Later bands:** the list sits in one panel. The Up next band (Signal Orange Wash, a gently pulsing orange dot) holds the first three rows, whose positions are Signal Orange Ink and whose meta line names the slot they fill ("Today 7:00 PM"). A "Later" band in Sunken Surface divides off the rest. The board and the Up next labels come from the same fill, so they always agree.
- **Idea row:** one line, left to right: grip, position, title (one line, ellipsis; pinned rows show an orange pin before it), one Muted Ink meta line (slot, source, "added 3 d ago"), state badge, number column (score, tabular, right-aligned), then Pin and Archive icon buttons and a quiet Make it button (only on Idea and Failed rows). Make it opens an inline confirm on the row that states the cost against the day's cap. Making rows lock their buttons and cannot be dragged. Hold and drag reorders; the drop line is a 2px Signal Orange line. Archive removes the row at once with a 5-second Undo toast.
- **Made row:** a 40 by 56px thumbnail in place of the grip, the title, a meta line (when it posts or posted, "made 2 d ago", "archives in 28 d"), the state badge, and a primary Review button only on Needs you rows.
- **Idea panel:** slides in from the right (440px, full-screen on a phone): full title and text, details, where the score comes from, the source, and Make it or Regenerate.
- **Post panel:** matches the app's post detail, in order: state and status line; the state's buttons (the first in orange); the playable reel or carousel pages; caption; checks and review notes; details; where the score comes from; sources; Open the full post and View on Instagram.
- **Row state words:** Idea, Making, Failed, try again, Ready, Scheduled, Needs you, Published. Each is an icon plus the word in a State Badge.
- **Raw errors never show on rows.** A Failed row says only "Failed, try again"; the error appears in the panel, under "The last try stopped."
- **Phone width:** the position and number columns fold away, titles wrap to two lines, action labels drop to icons.
- **Motion:** 150 to 250ms with the Helios ease-out; the runway fill grows in, a pin pops, a row flashes orange for under a second after Pin, Make it, a drop or Undo. Reduced motion turns every one of these off or into a fade.

### Inputs and Menus
- Native selects are not used. Choices with more than five options use the Helios menu (popover list, Float shadow); five or fewer use choice pills.
- Date range: pills for 7 / 30 / 90 days and All, with Custom opening a popover.

### Navigation
- Four tabs (Content, Calendar, Analytics, Health) as a segmented control under the hub header; the active tab is Ink-filled (the orange selected state is for the pool's Ideas | Made tabs only). Below it, breadcrumbs (Analytics › Text on Screen) in Muted Ink with the current page in Ink.
- The post drawer slides in from the right over 250ms with the Helios ease-out (cubic-bezier(0.16, 1, 0.3, 1)); with reduced motion it fades in. It closes with Escape, Back, or the backdrop.

## 6. Do's and Don'ts

### Do:
- **Do** lead every page with its answer: today's lineup on Content, the account's direction on Analytics, the month's shape on Calendar.
- **Do** keep orange to places a person can act, where they are and what's next, and the brief flash after an action; labels on orange are white.
- **Do** show every content type as dot + icon + name, in the fixed order Text on Screen, Explainers, Carousels, IG Stories.
- **Do** give every number a comparison, a trend or a cost, set in tabular figures.
- **Do** state the consequence before an expensive or irreversible action (regenerate cost against the daily cap; reject releases the slot).
- **Do** show disabled reasons as visible text.
- **Do** keep text at 4.5:1 or better (WCAG AA): Muted Ink for secondary text, Subtle Ink only for captions. The one accepted exception is white labels on Signal Orange (about 2.9:1, decided 2026-11-15).

### Don't:
- **Don't** build walls of equal tiles: dozens of same-weight stat boxes with no headline number and no comparison. A KPI strip has at most six numbers.
- **Don't** open a page on a filter form. Controls sit in one quiet row above the answer, never before it.
- **Don't** sprawl tabs. Three top-level places; everything else is a drill.
- **Don't** use the generic SaaS template: big hero metrics, gradient accents, an uppercase eyebrow over every section, identical card grids.
- **Don't** use colored side-stripe borders (border-left or border-right over 1px) on rows, cards or callouts.
- **Don't** color text with a content-type hue, or use green to mean "published" or "good" anywhere but a delta arrow.
- **Don't** use native selects, unicode glyphs as icons, or developer copy (SH codes, phase names, table names, raw worker errors on rows).
- **Don't** put shadows on panels at rest.
