---
name: helios-design-system
description: 'Brand and design system for Helios Group (heliosgroup.ai), an AI consultancy: "We build your unfair advantage." Use this skill for ANY Helios-branded artifact - pitch decks, slides, website pages, landing pages, ad creative, social posts and carousels, OG images, internal docs, or any visual asset carrying the Helios name. Trigger it whenever the user mentions Helios, Helios Group, Helios Marketing (the old name), heliosgroup.ai, or asks to build a deck, page, post or ad on-brand, or to make something look premium, cinematic, lit or "Helios Premium", without further specifying colors, fonts, or tokens - this skill supplies the exact palette (orange/green, the sun gradient), the editorial (white) and stage (dark) surfaces, the Premium lighting recipes, the Pragmatica Extended + Roboto type system, spacing tokens, motion rules, and logo-protection requirements needed to get it right on the first try.'
---

# Helios Group Design System

This skill loads the Helios Group brand: an AI consultancy (heliosgroup.ai) whose slogan is "We build your unfair advantage." It was founded as Helios Marketing; the editorial system carried over and the Premium stage was added in October 2026. Use it for any Helios-branded artifact — pitch decks, website pages, social posts, ad creative, internal docs.

## Activation

Apply this skill whenever the user is making something for Helios Group (or the older name Helios Marketing), or when an artifact lives inside this project's folders. A `@heliosgroup.ai` or `@heliosmarketing.org` email is a signal but not required.

## Always do

1. **Read `README.md` first** — it has the full content + visual foundations, voice rules, who Helios is, the Premium rules and the motion library. Do not invent rules; read the README.
2. **Use tokens from `colors_and_type.css`** (and `premium.css` for the lit stage) — link them directly. Don't redeclare colors or fonts inline.
3. **Pick the surface first**: **Editorial** (white canvas, off-black text) for the website, documents and deck content slides; **Stage** (charcoal `#161616 → #0B0B0B`, white text) for social posts, deck titles and hero moments. Never mix them in one frame.
4. **Match the four-beat content pattern**: SHOUTED EYEBROW (green or orange, 0.18em tracking) → tight Pragmatica Extended headline → light-weight Roboto body → short verb CTA.
5. **Restrict color**: **orange** for action only, **green** for structural metadata only (`#138510` on white, `#1BBF17` on the stage). The sun gradient (`--helios-sun`, `#FDC60F → #F48C3F → #EA3C3A`) belongs to the mark and small stage accents. No new accent colors.
6. **Use existing assets**: real client logos in `assets/clients/`, case-study media in `assets/case-studies/`, the sun mark in `assets/Helios-logo.png` (1200px, small uses) and `assets/Helios-mark.png` (5000px, large uses). There is no horizontal wordmark file: for a lockup, set the mark beside "Helios Group" in Pragmatica Extended. Never recolour, invert or filter the mark.
7. **Lucide icons only** — `lucide@0.487.0` from CDN. Specifically: `arrow-right`, `check-circle-2`, `chevron-right`, `linkedin`, `instagram`. **No emoji, no unicode glyphs as icons.**
8. **Match motion**: opacity 0→1 + y 20→0 over 600ms ease-out, stagger `idx*0.1s`, image hover `scale(1.05)` over 1000ms, card hover `translateY(-4px)` + xl shadow. Easing is `cubic-bezier(0.16, 1, 0.3, 1)`.

## Premium (the lit stage)

Cinematic lighting and depth on the stage: charcoal under warm spotlights and orange glows, the sun mark with a halo, huge extended headlines whose last line is lit orange, tracked eyebrows with a leading rule, glossy orange icon tiles, dark cards with a corner glow and ghost numeral, frosted glass, hairline footers. Put `class="premium"` on the frame and use the `.hp-*` recipes in `premium.css`.

- **Light** (`.premium`, the default) for daily social formats; **full** (`data-premium="full"`) for deck titles, covers and hero moments.
- **Light and depth only**: adding Premium to an existing format never changes its layout, copy or type sizes.
- **Rendered social slides**: the lit line is solid orange with a glow (`.hp-lit`), never transparent gradient text.
- **Logo plates and memes stay clean**: drop shadow only.
- **Never** paper, foil, emboss, grain, letterpress or hand-drawn textures.

## Reference materials in this project

- **`README.md`** — voice, who Helios is, color, type, surfaces, Premium, spacing, motion, iconography (read first, every time).
- **`colors_and_type.css`** — full token sheet. `:root` has every color, font stack, radius, shadow, easing, stage and premium var.
- **`premium.css`** — the Premium recipes (`.premium`, `.hp-*`).
- **`slides_source.md`** — verbatim deck content from the agency era, for reference.
- **`ui_kits/website/index.html`** — site recreation (hero / ticker / services / team / cases / footer). Lift sections wholesale when building landing pages.
- **`slides/index.html`** — 11 finished slide templates (title, team, two-card services, content-engine 4-grid, premium services, trusted-by logo wall, case studies, pricing, closing). Use `<deck-stage>` from `slides/deck-stage.js`.
- **`preview/`** — design-system tab cards for review; `23`–`27` are Premium (`27-premium-title.html` is a full-intensity title slide).
- **`social/`** — example social cover concepts.

## Defaults to inherit

- Container: `max-width: 1280px; padding: 0 24px;`
- Section padding: `96–128px` vertical.
- Cards: 16px radius default; **32px radius** for premium service / pricing cards; 24px for Premium stage cards.
- Buttons / pills: `border-radius: 9999px;` always.
- Body text: Roboto 300 (light) at 16–20px on editorial pages. **Never** set editorial body to 400+ unless it's a UI label. Social slides on the stage use 400.
- Headings: Pragmatica Extended Bold, `letter-spacing: -0.02em`, often `text-transform: uppercase` at hero scale.
- The orange CTA always carries the glow: `box-shadow: 0 0 40px -10px #FF5E1A`.

## Logo protection (non-negotiable)

The Helios logo (mark **or** wordmark) must be **fully on-canvas, fully unobscured**, with clear-space margins ≥ the height of the "H" on every side. **Never** bleed it off the edge, **never** layer text or other shapes over it, and **never** use a generic gradient orb without the wordmark as a stand-in. The brand is the *whole* mark, not the gradient. A halo around the whole mark is fine; small sun dots are dividers, not logos.

## Brand promise (use these phrasings, in this order of preference)

1. **"We build your unfair advantage."** — primary, default, evergreen.
   Name the company **Helios Group** and the site **heliosgroup.ai**. When a line says what Helios is, it is an **AI consultancy**: forward-deployed AI engineers who build and ship (README, "Who Helios is"). Never use "We Build AI Marketing Systems", "Helios Marketing", or heliosmarketing.org in new work.
2. **"We solve problems."** — short variant when a slide needs punch.
3. Sub-promises ("content engines", "sales automation", "custom AI agents", "AI systems") are valid as *supporting* lines, never as the headline. Do not reduce the brand to a single output channel.

Contact details for new work: **heliosgroup.ai**, Instagram **@heliosgroup.ai**, **lucas@heliosgroup.ai**. Never invent a client, a project or a result.

## Things to avoid

- Bluish-purple gradients, semantic green/red, multi-color palettes.
- Texture of any kind: grain, paper, foil, emboss, letterpress, hand-drawn illustrations, repeating patterns.
- Transparent gradient text in rendered social slides.
- Emoji, exclamation marks, marketing fluff ("revolutionary"), or feature-led copy.
- New icon families. Lucide only.
- Pure black `#000` for text — use `--neutral-900` (`#171717`).
- Adding photos of the team — the source codebase doesn't ship them; use initial-letter portraits as the canonical placeholder.

## When the user says…

- *"Make a deck"* → start from `slides/index.html`'s patterns, use `<deck-stage>`. The title slide is a full-intensity Premium stage (see `preview/27-premium-title.html`); content slides alternate white / `#FAFAFA`.
- *"Build a landing page"* → start from `ui_kits/website/index.html`. Header is fixed and transparent above the fold, white + glass past 50px scroll. A Premium hero section is allowed; the rest stays editorial.
- *"Make a social post / carousel"* → the stage, light Premium. White Pragmatica headline with its last line lit, Roboto 400 body, the sun mark in a glass chip.
- *"Make it premium / cinematic / Helios Premium"* → `premium.css`. Light for anything daily, full for one hero moment. Lighting and depth only; keep the layout.
- *"Design an ad"* → use orange CTA with glow on white, Pragmatica heading, eyebrow above, real product imagery from `assets/case-studies/`.
- *"Make it more fun / colorful"* → push back gently. The brand is intentionally restrained. Offer an *editorial* version (more whitespace, larger type, sharper photography), or a Premium stage, before adding color.
