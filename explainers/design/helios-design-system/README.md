# Helios Design System

A design system for **Helios Marketing** — *"We Build AI Marketing Systems."*
Helios is a Madison-Avenue-meets-AI marketing agency that produces high-volume content (statics, video, AI ad creative), runs Meta-ads campaigns, builds custom AI agents/automations, and is pioneering AI-influencer partnerships.

## Sources

This system is reverse-engineered from the materials the user provided:

- **`uploads/Helios Deck.pdf`** — 11-slide pitch deck (services, team, pricing, case studies). Extracted to `slides_source.md`.
- **`uploads/HELIOS-HIGH-DEF.png`** — high-resolution circular sun-mark with HELIOS wordmark on an orange→red radial gradient. → `assets/Helios-mark.png`.
- **GitHub: `lucasfigueroa0518/Heliosmarketingwebsite`** (default branch `main`)
  - `DESIGN_SYSTEM.md` — official design philosophy & token guidance.
  - `BLOG_GUIDELINES.md` — voice, tone, SEO posture for written content.
  - `src/styles/theme.css`, `src/styles/fonts.css` — design tokens + the proprietary heading font.
  - `src/app/components/{Hero,Header,Footer,Services,Team,CaseStudies,Ticker}.tsx` — primary marketing-site components, copied 1:1 in `ui_kits/website/`.
  - The original Figma is at `figma.com/design/aXBYUwdnlhx7kj0t9PwYlJ/Helios-Marketing-Website` (private — not consulted directly; codebase was the source of truth).

## Index

```
Helios Design System/
├── README.md                ← you are here
├── SKILL.md                 ← Claude Skill manifest (works as an Agent Skill)
├── colors_and_type.css      ← all color, type, spacing, radius, shadow, motion tokens
├── slides_source.md         ← extracted deck content, kept verbatim for reference
├── assets/
│   ├── Helios-logo.png      ← horizontal/wordmark logo (used in header/footer)
│   ├── Helios-mark.png      ← circular sun-mark (high-def)
│   ├── favicon.png
│   ├── clients/             ← 12 real client logos (used in social-proof ticker)
│   └── case-studies/        ← thumbnails + media for Local Boy, The Source, FlyerStudio
├── fonts/
│   └── PragmaticaExtended-Bold.otf   ← display heading font, weight 700 only
├── preview/                 ← design-system-tab cards (one per token group / component)
├── ui_kits/
│   └── website/             ← marketing-site UI kit (Hero, Header, Footer, Services, Team)
└── slides/                  ← deck slide templates matching the pitch deck
```

## Brand Snapshot

| | |
|---|---|
| **Name** | Helios Marketing |
| **Tagline** | *We Build AI Marketing Systems.* |
| **Promise** | "One 30-minute call. Identify your bottleneck. We handle development, implementation, and training." |
| **Positioning** | "A bridge between an editorial Madison-Avenue legacy and a cutting-edge AI future." |
| **Audience** | Founders, marketing leaders, SMBs in retail / real-estate / hospitality / nightlife. |
| **Tagline word cloud** | Content · Sales · More |
| **Channels** | heliosmarketing.org · @heliosmarketingg · lucas@heliosmarketing.org |

---

## Content Fundamentals

The voice on the marketing site is **professional, confident, and editorial**, but the body copy is set in *light weight* — it reads like a high-end magazine, not like SaaS marketing.

**Voice:**
- **Authoritative & direct.** "We Build AI Marketing Systems." "We solve problems." "We don't just talk about the future. We build it." — these are the canonical headlines. **Never** narrow the brand promise to a single output (e.g. "we build content machines"). The system is the product; content, sales automation, custom agents, and influencers are all *expressions* of the system.
- **Action-oriented & operator-flavored.** Every CTA is a verb: *Book a Call · Apply for Retainer · Start a Project · View Case Studies · See our work*.
- **Outcome-led, not feature-led.** Numbers are weaponized: "100+ ADS WEEKLY · 80% COST SAVINGS · 10x MORE CONTENT".
- **Plain-spoken about AI.** AI is described as *systems*, *engines*, *agents*, *pipelines* — never as magic. Concrete: "30 statics delivered weekly", "1,000+ AI images".

**Tone & casing:**
- **Eyebrows are SHOUTED.** All-caps, wide-tracked, short: `THE HELIOS FOUNDATION`, `BUILD & SCALE`, `PARTNER FOCUS`, `PREMIERE`. They sit above the bold headline as a structural label.
- **Headlines are Title Case** in tightly-tracked Pragmatica Extended: *Two Ways to Work With Us · Meet the Team · Custom Static Content Engines*.
- **Body is sentence case**, light weight, longer line lengths. Strong points get **`<strong>` bold ink** rather than colored highlights — e.g. "One **30-minute** call."
- **First-person plural**: "We build…", "We've worked with…", "Our team of software engineers…". Speaking *as the agency*.
- **Second person** for promises directly to the reader: "Choose Your Plan", "Let's Build Your System", "your brand", "your bottleneck".
- **No emoji.** None on the site, none in the deck. Don't introduce them.
- **No exclamation marks** on the site. Period-terminated declarations.
- **Numbers stay in numerals** ("30-minute", "100+", "750+", "10x"). Reads like a stat panel.

**Specific examples to mimic:**
- Headline → eyebrow → body → CTA (short verb): the four-beat pattern almost every section uses.
- *"Continuous, high-output AI-powered marketing engines integrated straight into your brand's daily operations."* ← stacked adjectives, single sentence, no fluff.
- *"Laser-focused builds solving specific bottlenecks with bespoke AI architecture and automated systems."* ← same shape on the dark card.
- Bullet items are noun phrases, 3–5 per list: "Custom AI Agents · Automated Workflows · App Builds · SaaS Tools".

---

## Visual Foundations

The aesthetic is **clean, minimal, premium, editorial.** The system runs on stark **white + off-black** with two restrained accents (**orange** for action, **dark green** for structural metadata). Imagery is candid and high-end. Animation is smooth, never flashy.

### Color
- White (`#FFFFFF`) is the default canvas. Negative space is the design.
- Off-black `--neutral-900 #171717` is used for all primary text and dark sections — softer than pure black.
- **Helios Orange `#FF5E1A`** is reserved for: primary CTAs, hover-state link color, key data points, the small dot dividers, the orange→hot-orange gradient inside the hero word "AI Marketing", and the page selection highlight.
- **Helios Green `#138510`** is reserved for: eyebrows, category labels ("Partner Focus"), the secondary "Book a Call" button when scrolled.
- The orange logo gradient runs **`#FF8A4F` (top, soft yellow-orange) → `#FF5E1A` (mid) → `#E63946` (bottom, red-orange)**.
- Avoid: bluish-purple gradients, semantic green/red beyond Helios Green, multicolor palettes.

### Type
- Display & headings: **Pragmatica Extended Bold** (custom OTF, weight 700 only). Tightly tracked. Used in `font-heading`. Often `uppercase` at hero scale.
- Body & UI: **Roboto** (Google Fonts), weights 300/400/500/700. Body copy almost always at `font-light` (300) for the editorial feel. UI labels at 500/600.
- Eyebrows: 12–14px, bold, **uppercase**, `letter-spacing: 0.18em`, usually green.
- Massive contrast between heading and body: hero is 100px, body is 18–20px light.
- A **serif** (Times-style) is used *only* for the giant decorative `"` quotation mark in client highlights — nowhere else.

### Spacing & Layout
- **Container**: `max-width: 1280px`, centered, `px-6` (24px) on the sides.
- **Vertical rhythm**: section padding is `py-24` (96px) or `py-32` (128px). Generous on purpose.
- **Grids**: CSS Grid with `grid-cols-1 md:grid-cols-2 lg:grid-cols-3/4`. Gaps are `gap-x-8` (32px) and `gap-y-16` (64px).
- Negative space is never collapsed — content is allowed to breathe.

### Backgrounds
- Almost always solid white or `--neutral-50` for alt sections. Sections often alternate `bg-white` ↔ `bg-neutral-50` for rhythm.
- The hero section is the *only* full-bleed dark surface: black with a looping `helios demo reel.webm` at 25% opacity, fading to white at the bottom via a vertical gradient. This creates the only "atmospheric" moment.
- The footer is solid `--neutral-900`.
- **No repeating patterns, no hand-drawn illustrations, no textures, no grain.** The brand intentionally avoids visual noise.
- Decorative gradients exist only in three places: the hero word "AI Marketing" (orange→orange-light gradient `bg-clip-text`), the CTA button glow (`shadow-[0_0_40px_-10px_#FF5E1A]`), and the logo's radial sun.

### Motion
- All scroll-reveal animations are **`opacity: 0, y: 20 → opacity: 1, y: 0`** over ~600ms. Never longer, never shorter.
- Stagger by **`idx * 0.1s`** for grids/lists — cascading is the brand's signature reveal.
- Hover on text → color transitions to `#FF5E1A`.
- Hover on images inside `overflow-hidden` containers → `scale(1.05)` over `1000ms`. Slow on purpose.
- Hover on portrait photos → `grayscale → grayscale-0` over 700ms.
- Hover on cards → soft `--shadow-card-hover` and `translateY(-4px)`.
- Press: `active:scale-95`.
- Easing: smooth `ease-out` (cubic-bezier(0.16, 1, 0.3, 1)). No bounces, no spring overshoot.

### Borders, shadows, transparency
- Borders are crisp 1px hairlines: `--neutral-100` for subtle, `--neutral-200` for visible.
- Shadows are minimal by default; cards use `shadow-sm` resting → `shadow-xl` on hover.
- The **CTA orange glow** (`box-shadow: 0 0 40px -10px #FF5E1A`) is a brand signature.
- **Glassmorphism is reserved for the fixed header**: `bg-white/95 backdrop-blur-md` once scrolled past 50px, transparent above the fold (so it sits cleanly on the dark hero video).
- Image overlays use `mix-blend-luminosity` + dark-to-transparent gradients only when text needs to read on top.

### Corner radii
- Buttons & badges: **fully rounded** (`rounded-full`, `--radius-pill`). Always.
- Service / pricing big cards: **`2rem` (32px)** — the "premium card" radius.
- Default cards (case studies, blog tiles): `1rem` (16px).
- Inputs: `rounded-full` for the footer "Message us" field, `rounded-md` (6–8px) for form inputs in `ui/`.
- Images: `rounded-2xl` (16px) for portraits, full-bleed (no radius) for hero video.

### Layout rules
- Header is `position: fixed; top: 0` with a 20px content height (`h-20`), full-width.
- Footer is full-width dark, with a 3-column grid at lg.
- Cards are bounded inside the 1280px container — content never reaches the edge of the viewport.

---

## Iconography

Helios uses **`lucide-react`** as its icon system across the site (`package.json` pins `lucide-react@0.487.0`). Icons are line-style, 1.5–2px stroke, drawn at 16–24px.

**Icons actually used in the codebase:**
- `ArrowRight` — every CTA button has one, sliding right on hover.
- `ChevronRight` — "View All Work" link.
- `CheckCircle2` — feature-list bullets in the Services section (orange or green based on card).
- `Linkedin` — team-member social link.
- `Instagram` — footer follow link.
- `Menu` / `X`, `Plus`, `Minus` — mobile nav, accordions (in shadcn UI).

**For HTML mocks, link Lucide from CDN:**
```html
<script src="https://unpkg.com/lucide@0.487.0/dist/umd/lucide.min.js"></script>
<script>lucide.createIcons();</script>
```
Render with `<i data-lucide="arrow-right"></i>`.

**Other rules:**
- **No emoji.** The brand never uses them.
- **No unicode-character icons** (★, ✓, ➜) as substitutes for Lucide. Use the real icon.
- **No PNG icon files** — all icons are SVG via Lucide.
- The decorative dot dividers in the hero (`Content · Sales · More`) are `<span>` circles, not icons — they're 6–8px circles filled with `--helios-orange`.
- Logo treatment: the wordmark `assets/Helios-logo.png` is used in the header (`h-8 md:h-10`) and footer (`h-12`). The circular sun-mark `assets/Helios-mark.png` is used at large sizes — for OG images, social, and the deck title slide.
- **Logo protection (non-negotiable):** the Helios logo (mark or wordmark) must always be **fully visible** — never bleeding off the canvas, never partially covered by other elements, never overlapped by text. Maintain a clear-space margin of at least the height of the "H" on every side. The mark is allowed to be a *dominant* visual element, but only when the entire shape is in-frame with breathing room. **Do not** use a generic gradient circle as a stand-in for the logo — a gradient orb without the wordmark is not the brand.

If a needed icon isn't in Lucide (rare), match its stroke weight (2px) and roundness — don't introduce a different icon family.

---

## Index of UI kits and slides

- **`ui_kits/website/`** — marketing-site recreation. `index.html` shows hero → ticker → services → team → case-studies → footer in one page. Components: `Header.jsx`, `Hero.jsx`, `Ticker.jsx`, `Services.jsx`, `Team.jsx`, `CaseStudies.jsx`, `Footer.jsx`, `Button.jsx`.
- **`slides/`** — deck-template recreations matching the 11-slide pitch deck. `index.html` plays them in sequence; one HTML/JSX file per slide kind (Title, Team, Two-Column, Service grid, Stats, Pricing, Closing).

## Caveats / known substitutions

- **Pragmatica Extended** is a paid commercial typeface. Only the **Bold** weight is bundled (the only one shipped in the codebase). If you need other weights, license them separately. As a fallback we use Helvetica/Arial — adequate but not identical metrics.
- The Figma file is private; the visual reference here comes from the codebase + deck PDF + supplied assets, not from Figma directly.
- The hero `helios demo reel.webm` is not bundled (it's a large video asset). Mocks use a black-tinted poster frame as a stand-in.
