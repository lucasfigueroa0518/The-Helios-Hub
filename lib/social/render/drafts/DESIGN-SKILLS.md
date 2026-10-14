# Skills applied to Helios carousel slide drafts

Open-source skills used for every premium slide draft. Helios brand and
layout-system rules always win when a skill conflicts.

## 1. core-design (inhaq/core-design-skills, MIT)

Source: https://github.com/inhaq/core-design-skills

Priority order: **hierarchy → spacing → typography → color → polish**.

- One element dominates each slide. If two compete, demote one.
- Establish hierarchy through size, weight, color, position, contrast, whitespace.
- Reserve the accent (Helios orange) for the single most important thing.
- Group by proximity, not boxes. Negative space is active design.
- 8px spacing scale. Tighter for related items, looser between groups.
- Weight does more hierarchy work than adding a fifth type size.
- `text-wrap: balance` on headlines; `pretty` on body; tabular nums on numbers.
- Optical alignment over geometric centering when a letterform or glyph looks off.
- Concentric radii: inner = outer − inset.
- Image outlines at ~10% white on dark / 10% black on light.
- No AI-default tells: purple gradients, icon-in-colored-circle, centered-everything, card soup, Inter-by-default.
- Existing design system wins. Helios already chose Pragmatica Extended + Roboto + orange/green/black/white.

## 2. social-media-carousel (inference-sh/skills)

Source: https://github.com/inference-sh/skills/blob/main/guides/social/social-media-carousel/SKILL.md

- Instagram canvas is **1080×1350 (4:5)** — already Helios.
- Cover is a hook, not a title. If the first slide fails, nobody swipes.
- One point per slide. Never two ideas fighting.
- Swipe psychology: curiosity gap, visual continuity, increasing value, a swipe cue on the cover.
- Visual continuity across the family: same margins, type, accent meaning.
- Common mistakes to avoid: weak hook, too much text, no swipe signal, no CTA on the close.

Helios already uses 80–220px display type on a 1080px image canvas. Do **not**
shrink type to the skill's web-UI sizes (48–64px headings). Those are for HTML
pages, not baked Instagram images.

## 3. social-carousel (inklate/social-skills, MIT)

Source: https://github.com/inklate/social-skills/blob/main/skills/social-carousel/SKILL.md

- Cover must work as a standalone feed image (and as an Instagram grid crop).
- One emphasis element per slide: a single accent word, number, or arrow. Two emphases is zero emphases.
- Self-contained: the slide parses without its neighbors.
- Numbers and simple editorial devices beat decorative chrome.
- Design note every slide: where the eye starts, what is large, what is quiet.

## 4. hook-anatomy (Helios, `.cursor/skills/hook-anatomy`)

- A hook opens a loop. The first thing the eye hits must create a reason to stay or swipe.
- Pattern interrupt is visual: unexpected scale, a number, a face, a line that does not resolve.
- Anti-pattern: greeting chrome, slow landing, hook that promises nothing.

## 5. Helios marketing design system (project skill)

- Tokens only: orange `#FF5E1A` for action/hook, green for structural metadata, no new accents.
- Pragmatica Extended Bold for display. Roboto for body. Roboto Mono for attribution.
- Lucide icons only. No emoji. No unicode-as-icon except the existing quote glyph / swipe mark if refined.
- Logo protection: mark and wordmark fully on-canvas, unobscured, with clear space.
- No grain, no texture, no hand-drawn illustration, no extra palette.

## Eye-flow (applied from the skills above)

Design the path before the decoration.

1. **Entry** — the involuntary first fixation (largest contrast, face, or number). On Instagram this must also survive the grid crop: the middle 60% of the 1350px height.
2. **Read** — the line the eye is pulled into next (headline or quote). Left-aligned gravity unless the template is the follow close.
3. **Settle** — the quiet closer (body, note, attribution, swipe, handle). This is where the loop opens or the CTA lives.

Test: squint. One shape should remain. If two remain, demote one.
