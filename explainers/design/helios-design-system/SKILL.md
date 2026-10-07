# Helios Marketing Design System

This skill loads the Helios Marketing brand: a Madison-Avenue-meets-AI marketing agency that builds high-volume content systems, runs Meta-ads campaigns, and ships custom AI agents. Use it for any Helios-branded artifact — pitch decks, website pages, ad creative, internal docs.

## Activation

Apply this skill whenever the user is making something for Helios Marketing, or when an artifact lives inside this project's folders. The user's email (`@heliosmarketing.org`) is a signal but not required.

## Always do

1. **Read `README.md` first** — it has the full content + visual foundations, voice rules, and motion library. Do not invent rules; read the README.
2. **Use tokens from `colors_and_type.css`** — link it directly. Don't redeclare colors or fonts inline.
3. **Match the four-beat content pattern**: SHOUTED EYEBROW (green or orange, 0.18em tracking) → tight Pragmatica Extended headline → light-weight Roboto body → short verb CTA.
4. **Restrict color**: white canvas, off-black text, **orange** for action only, **green** for structural metadata only. No new accent colors.
5. **Use existing assets**: real client logos in `assets/clients/`, case-study media in `assets/case-studies/`, wordmark in `assets/Helios-logo.png`, sun-mark in `assets/Helios-mark.png`.
6. **Lucide icons only** — `lucide@0.487.0` from CDN. Specifically: `arrow-right`, `check-circle-2`, `chevron-right`, `linkedin`, `instagram`. **No emoji, no unicode glyphs as icons.**
7. **Match motion**: opacity 0→1 + y 20→0 over 600ms ease-out, stagger `idx*0.1s`, image hover `scale(1.05)` over 1000ms, card hover `translateY(-4px)` + xl shadow. Easing is `cubic-bezier(0.16, 1, 0.3, 1)`.

## Reference materials in this project

- **`README.md`** — voice, color, type, spacing, motion, iconography (read first, every time).
- **`colors_and_type.css`** — full token sheet. `:root` has every color, font stack, radius, shadow, and easing var.
- **`slides_source.md`** — verbatim deck content, in order, for any pitch-deck work.
- **`ui_kits/website/index.html`** — site recreation (hero / ticker / services / team / cases / footer). Lift sections wholesale when building landing pages.
- **`slides/index.html`** — 11 finished slide templates (title, team, two-card services, content-engine 4-grid, premium services, trusted-by logo wall, case studies, pricing, closing). Use `<deck-stage>` from `slides/deck-stage.js`.
- **`preview/`** — design-system tab cards for review.

## Defaults to inherit

- Container: `max-width: 1280px; padding: 0 24px;`
- Section padding: `96–128px` vertical.
- Cards: 16px radius default; **32px radius** for premium service / pricing cards.
- Buttons / pills: `border-radius: 9999px;` always.
- Body text: Roboto 300 (light) at 16–20px. **Never** set body to 400+ unless it's a UI label.
- Headings: Pragmatica Extended Bold, `letter-spacing: -0.02em`, often `text-transform: uppercase` at hero scale.
- The orange CTA always carries the glow: `box-shadow: 0 0 40px -10px #FF5E1A`.

## Logo protection (non-negotiable)

The Helios logo (mark **or** wordmark) must be **fully on-canvas, fully unobscured**, with clear-space margins ≥ the height of the "H" on every side. **Never** bleed it off the edge, **never** layer text or other shapes over it, and **never** use a generic gradient orb without the wordmark as a stand-in. The brand is the *whole* mark, not the gradient.

## Brand promise (use these phrasings, in this order of preference)

1. **"We Build AI Marketing Systems."** — primary, default, evergreen.
2. **"We solve problems."** — short variant when a slide needs punch.
3. Sub-promises ("content engines", "sales automation", "custom AI agents") are valid as *supporting* lines, never as the headline. Do not reduce the brand to a single output channel.

## Things to avoid

- Bluish-purple gradients, semantic green/red, multi-color palettes.
- Texture, grain, hand-drawn illustrations, repeating patterns.
- Emoji, exclamation marks, marketing fluff ("revolutionary"), or feature-led copy.
- New icon families. Lucide only.
- Pure black `#000` for text — use `--neutral-900` (`#171717`).
- Adding photos of the team — the source codebase doesn't ship them; use initial-letter portraits as the canonical placeholder.

## When the user says…

- *"Make a deck"* → start from `slides/index.html`'s patterns, use `<deck-stage>`. Title slide gets the dark `brand-bg` + radial sun-mark; content slides alternate white / `#FAFAFA`.
- *"Build a landing page"* → start from `ui_kits/website/index.html`. Header is fixed and transparent above the fold, white + glass past 50px scroll.
- *"Design an ad"* → use orange CTA with glow on white, Pragmatica heading, eyebrow above, real product imagery from `assets/case-studies/`.
- *"Make it more fun / colorful"* → push back gently. The brand is intentionally restrained. Offer an *editorial* version (more whitespace, larger type, sharper photography) before adding color.
