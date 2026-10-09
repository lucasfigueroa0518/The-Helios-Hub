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
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.helios-orange-hover}"
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
- **Helios Signal Orange** (#ff5e1a): the action color. Primary buttons (with ink labels), the focus ring, the current tab indicator. Never a category, never a decoration, never a chart series.
- **Signal Orange Ink** (#b8410c) on **Signal Orange Wash** (#ffece3): the "Needs you" badge and the count of items waiting on a person.

### Secondary
- **Helios Metadata Green** (#138510) on **Green Wash** (#e7f3e7): structural metadata only in Helios brand work; inside the hub it doubles as the Carousels type hue (see Tertiary). It is never used for success or "published".

### Tertiary: content types (fixed order: Trial Reels, Explainers, Carousels, IG Stories)

Trial Reels moved to teal (decided 2026-10-08) so red stays free for Failed; Carousels green and Story purple keep the hub's existing hues, and blue is the Networking blue.
- **Reel Teal** (#14b8c4): Trial Reels.
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

### Named Rules
**The One Signal Rule.** Orange appears only where a person can act. If orange is on screen and there is nothing to click, it is wrong.

**The Mark, Not Ink Rule.** Content-type hues color marks (dots, lines, bars), never text. Every label, value and legend entry is set in Ink, Muted Ink or Subtle Ink.

**The Quiet State Rule.** A lifecycle state is an icon and a word in Muted Ink. Only Failed (Failed Ink on Failed Wash) and Needs you (Signal Orange Ink on Signal Orange Wash) get color. Published is a check icon, not green.

## 3. Typography

**Display Font:** Pragmatica Extended (with Roboto fallback), page titles only
**Body Font:** Roboto (with system sans fallback)

**Character:** One working family, Roboto, carries every label, number and sentence; Pragmatica Extended appears once per page, in the page title, as the Helios signature.

### Hierarchy
- **Page title** (700, 24px, 1.2): one per page ("Today · Thu Oct 8", "Trial Reels"). Pragmatica Extended.
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
- **Primary:** Signal Orange fill with an Ink label (5.9:1), 32px tall, 14px side padding. At most one per region.
- **Action:** Surface fill, Strong Hairline border, Ink label; hover to Hover Surface.
- **Disabled:** 55% opacity and the reason visible as text next to or under the button, never screen-reader-only.
- **Focus:** 2px outline in Signal Orange's ink step (`#b8410c`, token `--sh-focus`), 2px offset. The base orange is only ~2.9:1 on the page, under the 3:1 a focus indicator needs.
- **Pending:** label stays, a 14px spinner replaces the icon, the button ignores clicks; the result note appears inline after.

### Choice Pills
- **Style:** fully round (9999px), 28px tall, Hairline border, Muted Ink label. This is how a person *chooses* something (range, metric, mode).
- **Selected:** Ink fill, Surface label.
- Pills never perform actions, and action buttons are never pills.

### Content Type Mark (signature)
- A solid 8px dot in the type hue, a 14px Lucide icon (Trial Reels: clapperboard; Explainers: presentation; Carousels: gallery-horizontal; IG Stories: sparkles; circle-dashed is reserved for the Ready state) and the type name in Muted Ink. In dense rows the name may drop, the dot and icon never do.

### State Badge (signature)
- Pill, 2px by 8px, icon plus word. Default: Surface fill, Hairline border, Muted Ink.
- **Needs you:** Signal Orange Wash fill, Signal Orange Ink, hand icon, with time left ("2 h left").
- **Failed:** Failed Wash fill, Failed Ink, alert icon, with the reason one click away.
- States and icons: In production (loader), Ready (circle-dashed), Approved (check), Scheduled (clock), Posting (upload), Published (circle-check), Rejected (ban), Cancelled (circle-slash), Skipped (skip-forward).

### Panels
- **Corner Style:** 12px.
- **Background:** Surface on Canvas.
- **Shadow Strategy:** none at rest (see Elevation).
- **Border:** 1px Hairline.
- **Internal Padding:** 16px by 24px. Panels never nest; inside a panel, group with spacing and hairline dividers.

### Inputs and Menus
- Native selects are not used. Choices with more than five options use the Helios menu (popover list, Float shadow); five or fewer use choice pills.
- Date range: pills for 7 / 30 / 90 days and All, with Custom opening a popover.

### Navigation
- Three tabs (Content, Calendar, Analytics) as a segmented control under the hub header; the active tab is Ink-filled. Below it, breadcrumbs (Analytics › Trial Reels) in Muted Ink with the current page in Ink.
- The post drawer slides in from the right over 250ms with the Helios ease-out (cubic-bezier(0.16, 1, 0.3, 1)); with reduced motion it fades in. It closes with Escape, Back, or the backdrop.

## 6. Do's and Don'ts

### Do:
- **Do** lead every page with its answer: today's lineup on Content, the account's direction on Analytics, the month's shape on Calendar.
- **Do** keep orange to places a person can act, with an Ink label (5.9:1).
- **Do** show every content type as dot + icon + name, in the fixed order Trial Reels, Explainers, Carousels, IG Stories.
- **Do** give every number a comparison, a trend or a cost, set in tabular figures.
- **Do** state the consequence before an expensive or irreversible action (regenerate cost against the daily cap; reject releases the slot).
- **Do** show disabled reasons as visible text.
- **Do** keep text at 4.5:1 or better (WCAG AA): Muted Ink for secondary text, Subtle Ink only for captions.

### Don't:
- **Don't** build walls of equal tiles: dozens of same-weight stat boxes with no headline number and no comparison. A KPI strip has at most six numbers.
- **Don't** open a page on a filter form. Controls sit in one quiet row above the answer, never before it.
- **Don't** sprawl tabs. Three top-level places; everything else is a drill.
- **Don't** use the generic SaaS template: big hero metrics, gradient accents, an uppercase eyebrow over every section, identical card grids.
- **Don't** use colored side-stripe borders (border-left or border-right over 1px) on rows, cards or callouts.
- **Don't** color text with a content-type hue, or use green to mean "published" or "good" anywhere but a delta arrow.
- **Don't** use native selects, unicode glyphs as icons, or developer copy (SH codes, phase names, table names).
- **Don't** put shadows on panels at rest.
