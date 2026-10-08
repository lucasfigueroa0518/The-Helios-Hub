---
version: helios-explainer-v1
name: Helios — Explainer Reel frame
description: >
  Helios Marketing's design system at the scale of a 9:16 explainer reel frame (1080×1920).
  White canvas, off-black ink, one orange focal element per frame, green eyebrows. Pragmatica
  Extended Bold carries every headline and figure; Roboto carries body, labels, and captions.
  Visuals are built from geometric primitives, a fixed set of Lucide icons, diagrams, UI-like
  elements, and simple HTML/CSS illustrations of everyday objects and scenes. No photos, stock
  footage, or complex hand-drawn art.
unit: the frame — 1080×1920 (9:16) primary; cqw = px ÷ 1080 × 100
principle: one idea per frame · orange marks the one thing to look at · the picture explains

colors:
  canvas: "#FFFFFF"
  canvas-alt: "#FAFAFA"
  ink: "#171717"
  text-secondary: "#525252"
  text-tertiary: "#737373"
  line: "#E5E5E5"
  line-strong: "#D4D4D4"
  orange: "#FF5E1A"
  orange-soft: "#FF8A4F"
  orange-hot: "#E63946"
  green: "#138510"
  night: "#171717"
  on-night: "#FFFFFF"

typography:
  # — display ramp (Pragmatica Extended, Bold only; hierarchy from size, case, and color) —
  display:      { fontFamily: "Pragmatica Extended", cqw: 10.4, weight: 700, lineHeight: 0.95, tracking: "-0.03em", upper: true, color: "ink" }
  h1:           { fontFamily: "Pragmatica Extended", cqw: 8.1, weight: 700, lineHeight: 1.0, tracking: "-0.02em", color: "ink" }
  h2:           { fontFamily: "Pragmatica Extended", cqw: 6.3, weight: 700, lineHeight: 1.05, tracking: "-0.02em", color: "ink" }
  h3:           { fontFamily: "Pragmatica Extended", cqw: 4.8, weight: 700, lineHeight: 1.1, tracking: "-0.02em", color: "ink" }
  stat-figure:  { fontFamily: "Pragmatica Extended", cqw: 13.0, weight: 700, lineHeight: 0.9, tracking: "-0.03em", color: "orange" }
  node-label:   { fontFamily: "Pragmatica Extended", cqw: 3.7, weight: 700, lineHeight: 1.1, tracking: "-0.01em", color: "ink" }
  # — reading ramp (Roboto) —
  body:         { fontFamily: "Roboto", cqw: 4.1, weight: 300, lineHeight: 1.35, color: "text-secondary" }
  body-strong:  { fontFamily: "Roboto", cqw: 4.1, weight: 500, lineHeight: 1.35, color: "ink" }
  eyebrow:      { fontFamily: "Roboto", cqw: 2.8, weight: 700, tracking: "0.18em", upper: true, color: "green" }
  micro:        { fontFamily: "Roboto", cqw: 2.2, weight: 500, tracking: "0.12em", upper: true, color: "text-tertiary" }
  caption:      { fontFamily: "Roboto", cqw: 5.2, weight: 500, lineHeight: 1.15, color: "ink" }

spacing:
  # 130px each side on a 1080-wide frame. Clears Instagram's right-hand
  # like/comment/share column (~119px) and matches it on the left so the
  # picture stays centered.
  pad-x: "12cqw"
  # Content starts under the caption band. 250px Instagram header + 320px captions.
  pad-top: "570px"
  gap-lg: "7cqw"
  gap-md: "4.5cqw"
  gap-sm: "2.2cqw"
  # Organic Reels on a 1080×1920 frame, measured in the Instagram app.
  # Top 250px: status bar and the semi-transparent "Reels" header. Empty.
  # Next 320px (y 250–570): burned-in caption pill, nothing else.
  # Bottom 320px (y 1600–1920): username, post caption, and audio. Empty.
  ig-header: "250px"
  caption-band-top: "250px"
  caption-band-height: "320px"
  ig-bottom: "320px"
  caption-keepout: "y 250px–570px, and the bottom 320px"

components:
  focal-mark:
    color: "{colors.orange}"
    description: "The ONE element per frame the viewer must look at: a node, a number, a word, an arrow, an object in the analogy. Orange fill, orange stroke, or orange text. Exactly one per frame; never two."
  card:
    backgroundColor: "{colors.canvas}"
    border: "0.1cqw solid {colors.line}"
    rounded: "1.5cqw"
    shadow: "0 2.2cqw 5.5cqw -1.9cqw rgba(0,0,0,0.18)"
    description: "16px-radius card (scaled). The default container for a component, a UI panel, or a labeled box in a diagram."
  pill:
    rounded: "9999px"
    padding: "1.3cqw 3cqw"
    typography: "{typography.micro} or {typography.body-strong}"
    description: "Fully rounded tag, status chip, or token. Outline in {colors.line-strong}, or orange fill when it is the focal mark."
  node:
    shape: "circle or 1.5cqw-radius rounded square, 14–22cqw across"
    border: "0.37cqw solid {colors.ink}"
    typography: "{typography.node-label} beneath"
    description: "A system component in a diagram (client, server, database, agent). Holds one approved Lucide icon at ~45% of its size."
  connector:
    stroke: "0.37cqw {colors.line-strong}, round caps"
    description: "Line or arrow between nodes. A travelling dot (1.8cqw circle) moves along it to show a request, message, or data flow. The active path may be orange when it is the focal mark."
  icon:
    stroke: "2px at 24px viewBox, scaled; color currentColor"
    description: "Only the approved Lucide icons in assets/icons/ (see Approved Entities). Inline the SVG markup from the file. Never draw another icon family, never use emoji or unicode glyphs as icons."
  scene-object:
    description: "Simple HTML/CSS illustration of a recognizable everyday object or scene for the analogy beat (a waiter, a mailbox, a kitchen pass, a library shelf, a receipt). Built from rectangles, circles, rounded shapes, and lines in the palette, flat fills, 0.37cqw ink outlines optional. Readable at a glance, labeled with a micro or node-label tag. No photos, no texture, no gradients except the logo."
  data-table:
    border: "0.1cqw solid {colors.line}"
    rounded: "1.5cqw"
    typography: "header {typography.micro}; cells {typography.body-strong} at 3.7cqw"
    description: "A tiny table for worked examples: at most 4 rows × 3 columns. The highlighted cell or row is the focal mark."
  night-ground:
    backgroundColor: "{colors.night}"
    description: "The beat-5 (technical catch) ground for rhythm. Text flips to {colors.on-night}; orange stays the focal mark; eyebrow stays green."
  logo-plate:
    asset: "assets/Helios-logo.png"
    description: "Frame 7 only. The whole logo fully on canvas, unobscured, centered in the content area (below the caption band, above Instagram's bottom chrome), with clear space at least the height of the H on every side. Never cropped, overlapped, or replaced by a gradient orb."
---

# Helios — Explainer Reel frame

## Overview

Helios explainer reels look like the Helios website and deck moving: **white canvas, off-black ink,
generous space, and one orange thing to look at.** Every frame teaches one idea. The picture does
the explaining; narration and captions carry the words. Typography is Pragmatica Extended Bold for
headlines and figures, Roboto for body, labels, and captions. Restraint is the brand: no new accent
colors, no texture, no emoji, no exclamation marks.

What the frames show: diagrams of real systems (nodes, connectors, travelling dots), tiny tables
and numbers for the worked example, UI-like panels (a request, a response, a terminal line), and
**simple HTML/CSS illustrations of everyday objects and scenes** for the analogy beat. The analogy
should be one of the most engaging visual moments of the reel: a recognizable scene, clear labels,
meaningful motion, and moments that can carry a sound effect.

## The Frame

### Frame Craft Bar

- **One focal mark** — exactly one orange element per frame. If two things compete, one goes ink.
- **Squint** — the focal element or the headline dominates at 3× or more its nearest neighbor.
- **Silence** — 40–50% of the content area stays empty. A phone screen crowds fast.
- **The picture explains** — a viewer with the sound off should still follow the mechanism.
- **Reference** — the Helios website hero and pitch deck; failure looks like a busy infographic or a stock-slide template.

- **Canvas:** 1080×1920 (9:16). Every size is authored in `cqw` against the frame container (`px ÷ 1080 × 100`).
- **Safe area:** `pad-x` 12cqw (130px) on both sides. Picture, headlines, and the logo live between y=570px and y=1600px.
  - **y 0–250:** Instagram's Reels header. Semi-transparent "Reels" title, camera icon, and the phone status bar. Nothing of ours goes here.
  - **y 250–570:** the burned-in caption band. The caption skin centers the pill here, under that header and above the picture. Frames leave this band empty.
  - **y 1600–1920:** Instagram's username, the post caption, and the audio line. Nothing of ours goes here.
- **Container law:** every frame ground sets `container-type: size`; frame-relative units are `cqw`/`cqh`, never `vw`.

## Colors

`{colors.canvas}` white is the ground on every frame except beat 5. `{colors.ink}` is headlines and
primary text, never pure black. `{colors.text-secondary}` is body. `{colors.green}` is **eyebrows and
labels only** (it doubles as signposting: "THE ANALOGY", "UNDER THE HOOD", "THE CATCH").
`{colors.orange}` marks **the single focal element** per frame. `{colors.line}` and
`{colors.line-strong}` are hairlines, connectors, and outlines. The orange gradient
(`orange-soft` → `orange` → `orange-hot`) exists only inside the logo. Beat 5 uses
`{colors.night}` as its ground (night-ground component) for rhythm.

## Typography

- **Pragmatica Extended ships Bold only.** Hierarchy comes from size, case, and color, never weight. `display` is uppercase; `h1`–`h3` are Title Case.
- **Roboto 300** for body, **500** for strong body and captions, **700** for eyebrows. Eyebrows are uppercase, 0.18em tracking, green.
- **Legibility floor:** any load-bearing text is at least **3.3cqw** (36px). `micro` is chrome and tags only.
- **Fit to measure:** headline block at most 76cqw wide, inside the 12cqw side margins. 1–3 words → `display`; 4–6 → `h1`; 7+ → `h2`. On-screen text is a label or a headline, never a narration sentence.
- **Numbers stay numerals** ("240 customers", "10,000 requests"). `stat-figure` is for the one number that matters, usually the focal mark.

## Depth & Surface

White plane, crisp hairlines, and the soft card shadow. Hierarchy from type scale, the single orange
mark, and negative space. No glassmorphism, no glow except a faint orange glow on an orange focal
button-like element, no textures, no gradients outside the logo.

## Shapes

- **9999px** — pills, tags, chips, travelling dots.
- **1.5cqw (16px scaled)** — cards, panels, tables, rounded-square nodes.
- **Circles** — nodes, dots, the logo plate's clear space.

## Components

- **focal-mark** — the one orange element.
- **card / pill / data-table** — containers and tokens for UI-like and worked-example content.
- **node / connector / icon** — the system-diagram kit; the travelling dot on a connector is the signature move for any flow.
- **scene-object** — CSS illustrations for the analogy (see Approved Entities for the allowed scope).
- **night-ground** — beat 5 only. **logo-plate** — frame 7 only.

## Frame Treatments

> The reel always has seven frames in this order (planning/Explainer Reels BUILD_PLAN §7). Each
> treatment names its ground, focal mark, composition, and the move that carries the beat.

### 1 · Hook (0–4s · type `hook` · cut in)

**Ground** `{colors.canvas}`. **Composes** eyebrow (green), `display` or `h1` headline (2–6 words, outcome language or a question), one supporting visual (an icon or a tiny scene). **Focal** the one word or object that creates the curiosity gap, in orange. **Move** fast reveal by 0.5s; the question lands, then the visual answers half of it. **Silence** 50%. **Density** sparse.

### 2 · Everyday analogy (4–12s · type `product_intro`)

**Ground** `{colors.canvas}`. **Composes** eyebrow ("THE ANALOGY"), a **scene-object illustration** built from CSS (a restaurant pass, a post office counter, a library desk), 2–4 labeled parts with `micro` tags. **Focal** the moving piece of the scene (the order ticket, the letter, the book) in orange. **Move** the scene plays out: the focal piece travels between parts on the voiceover cues, each arrival a sound-effect moment. **Silence** 35%. **Density** standard. This is the reel's most engaging visual moment.

### 3 · Map analogy to components (12–21s · type `feature_showcase`)

**Ground** `{colors.canvas}`. **Composes** the analogy's parts morphing or cross-fading into system **nodes** with Lucide icons and `node-label`s, joined by **connectors**. **Focal** the component that does the key work, in orange. **Move** progressive disclosure: one mapping per voiceover phrase (waiter → API, kitchen → server). **Silence** 35%. **Density** standard.

### 4 · Worked example (21–29s · type `social_proof`)

**Ground** `{colors.canvas}`. **Composes** a `data-table`, a request/response card pair, or a short count-up, using the script's real numbers only. **Focal** the result number or row, `stat-figure` in orange. **Move** the example executes step by step; the number lands last. **Silence** 40%. **Density** standard.

### 5 · The technical catch (29–35s · type `benefit_highlight` · night ground)

**Ground** `{colors.night}` (night-ground). **Composes** eyebrow ("THE CATCH", green), `h1`/`h2` statement in `{colors.on-night}`, one visual showing the belief vs the reality (a split, a broken connector, a queue overflowing). **Focal** the failure point or the qualifier, in orange. **Move** the expectation is shown, then corrected. **Silence** 50%. **Density** sparse.

### 6 · Real-world context (35–41s · type `social_proof`)

**Ground** `{colors.canvas}`. **Composes** 2–3 recognizable places the viewer meets this concept, as cards or pills with Lucide icons (checkout, login screen, chat app). **Focal** the most familiar one, in orange. **Move** staggered card reveal (0.06s), each on its voiceover cue. **Silence** 40%. **Density** standard.

### 7 · Close (41–45s · type `branding`)

White screen. Only the Helios logo, centered in the content area (below y=570px, above y=1600px). It animates in with the usual rise (opacity 0, 20px, ~400ms, `expo.out`) and holds. The voiceover is the one-line thesis and does not say "Helios". No headline, no URL, and no other mark.

## Motion

Helios motion, tightened for 45 seconds:

- **Reveal:** opacity 0→1 with a 1.85cqw (20px) rise, **~400ms**, ease `expo.out` (= `cubic-bezier(0.16, 1, 0.3, 1)`).
- **Stagger:** **0.06s** between siblings in a group.
- **No bounce, no spring overshoot, no spin, no flashy wipes.** Travelling dots and morphs use the same ease.
- **Transitions:** 2–3 types per reel; frame 1 enters on a `cut`.

## Composition Rules

### Do

- Keep exactly one orange focal mark per frame and move the eye to it with motion.
- Put eyebrows above headlines, green, uppercase, tracked 0.18em.
- Build analogies as clean CSS scenes with labeled parts; make the moving piece the focal mark.
- Use the approved Lucide icons for system parts, inlined from `assets/icons/`.
- Keep every element inside the content area: below y=570px, above y=1600px, and inside the 12cqw side margins.
- Use the script's real numbers for the worked example; label units.

### Don't

- Don't introduce any color outside the palette, any gradient outside the logo, or any texture or pattern.
- Don't use emoji, unicode glyph icons, another icon family, photos, stock footage, or complex hand-drawn art.
- Don't render a narration sentence as on-screen text, and don't use exclamation marks anywhere.
- Don't put two orange elements in one frame.
- Don't place, crop, cover, or recolor the Helios logo outside frame 7's logo-plate rules.

## Aspect-Ratio Behavior

| Treatment | 9:16 (primary) |
|---|---|
| Hook | eyebrow + headline at the top of the content area (just below y=570px), visual below, all above y=1600px |
| Analogy | scene fills the content area; labels beside or above parts |
| Map | nodes stacked vertically or in a 2×2, connectors vertical, all inside the content area |
| Worked example | table or card pair centered in the content area; result number above y=1600px |
| Catch | statement at the top of the content area, belief/reality visual below |
| Context | 2–3 cards stacked inside the content area |
| Close | white screen, Helios logo only, centered in the content area |

## Approved Entities

**The Helios logo** — `assets/Helios-logo.png` (wordmark). Frame 7 only. Fully on canvas,
unobscured, never overlapped by text, shapes, or captions, never cropped, never recolored, never
replaced by a gradient orb. Clear space on every side at least the height of the "H". Render it at
40–55cqw wide, centered in the content area (below y=570px, above y=1600px).

**Icons** — Lucide 0.487.0, inline the SVG from `assets/icons/<name>.svg` (stroke `currentColor`,
color by the parent). Only these names:
server, database, cloud, cpu, hard-drive, monitor, smartphone, laptop, globe, wifi, network,
router, lock, key-round, shield-check, user, users, file-text, folder, mail, message-square, bell,
search, code, terminal, git-branch, git-merge, git-commit-horizontal, package, layers, workflow,
bot, brain, zap, clock, timer, calendar, refresh-cw, arrow-right, arrow-left-right, circle-check,
circle-x, triangle-alert, list, table, chart-column, webhook, plug, link, inbox, send, repeat,
chevron-right, hash, type, braces, box, receipt, shopping-cart, utensils, truck, store.

**Scene objects** — any everyday object or scene the analogy needs, drawn in CSS from the palette
(flat shapes, optional ink outlines). No real brands, logos, products, or people's likenesses; a
person is a simple figure (circle head + rounded body) or a `user` icon.

**No other marks.** No real customer, vendor, or product logos.

## Numerals & Claims (hard rule)

Never invent figures, dates, counts, or claims. Every number on screen comes from `SCRIPT.md` or
the storyboard; when the topic has a source, every claim and visual traces to it.

## Pre-Render Self-Audit

- **Focal** — exactly one orange element in this frame.
- **Palette** — only frontmatter colors; ink not pure black; no gradient outside the logo.
- **Type** — Pragmatica Bold for headlines/figures, Roboto for the rest; load-bearing text ≥ 3.3cqw; no narration sentence on screen; no exclamation marks.
- **Icons** — only approved Lucide names, inlined; no emoji or glyph icons.
- **Keep-out** — nothing in y 0–570px (Instagram header, then the caption band) or y 1600–1920px (Instagram's username, post caption, and audio). Side margins 12cqw.
- **Logo** — frame 7 only, whole, unobscured, clear space ≥ the H height.
- **Motion** — ~400ms `expo.out` reveals with a 20px rise, 0.06s stagger; content arrives on voiceover cues, not all at t=0.
- **Fabrication** — every number traces to the script or source.

## Font loading

Fonts ship as local files in `assets/fonts/` (the worker copies them before `build-frame`). Do NOT
link Google Fonts. Paste this `<style>` into every frame's `<template>` so `font-family` resolves in
preview, snapshot, and render alike:

```html
<style>
@font-face{font-family:"Pragmatica Extended";font-weight:700;font-style:normal;font-display:block;src:url("assets/fonts/PragmaticaExtended-Bold.otf") format("opentype");}
@font-face{font-family:"Roboto";font-weight:300;font-style:normal;font-display:block;src:url("assets/fonts/Roboto-300.woff2") format("woff2");}
@font-face{font-family:"Roboto";font-weight:400;font-style:normal;font-display:block;src:url("assets/fonts/Roboto-400.woff2") format("woff2");}
@font-face{font-family:"Roboto";font-weight:500;font-style:normal;font-display:block;src:url("assets/fonts/Roboto-500.woff2") format("woff2");}
@font-face{font-family:"Roboto";font-weight:700;font-style:normal;font-display:block;src:url("assets/fonts/Roboto-700.woff2") format("woff2");}
</style>
```

## Known Gaps

- Pragmatica Extended ships Bold only; there is no italic. Emphasis is orange or size.
- The analogy's scene objects are hand-built CSS per reel; quality varies by worker. Review catches weak scenes.
- 16:9 and 1:1 are not designed for; this preset is 9:16 only.
