# Helios Design System

A design system for **Helios Group** — *"We build your unfair advantage."*
Helios Group is an AI consultancy (heliosgroup.ai). It was founded as Helios Marketing, an AI marketing agency; the editorial visual system carried over, and the **Premium** stage (below) was added in October 2026. `slides_source.md`, `uploads/` and the Sources list below keep the old name because they record where the system came from.

> **This repo is the one source of truth** (`HELIOS/CODE/helios-design-system`). Every other copy — the Claude account skill, The Helios Hub, helios-dashboards, the `HELIOS/Helios Design System` folder — is made from it by `scripts/sync.sh`. Edit here, never in a copy. See [Source of truth](#source-of-truth).

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
helios-design-system/
├── README.md                ← you are here
├── SKILL.md                 ← Claude Skill manifest (works as an Agent Skill)
├── CHANGELOG.md             ← what changed, when, and who approved it
├── colors_and_type.css      ← all color, type, spacing, radius, shadow, motion, stage + premium tokens
├── premium.css              ← Premium recipes (the lit stage), scoped under .premium
├── slides_source.md         ← extracted deck content, kept verbatim for reference
├── _ds_manifest.json, _ds_bundle.js, design-canvas.jsx, image-slot.js, _adherence.oxlintrc.json
│                            ← Claude design-tool files (card index, canvas, image slot, lint)
├── social/                  ← example social work (Coconut Grove cover concepts)
├── uploads/                 ← the original source files (deck PDF, high-def mark)
├── scripts/sync.sh          ← copies this repo to every place that uses it
├── assets/
│   ├── Helios-logo.png      ← horizontal/wordmark logo (used in header/footer)
│   ├── Helios-mark.png      ← circular sun-mark (high-def)
│   ├── favicon.png
│   ├── clients/             ← 12 real client logos (used in social-proof ticker)
│   └── case-studies/        ← thumbnails + media for Local Boy, The Source, FlyerStudio
├── fonts/
│   └── PragmaticaExtended-Bold.otf   ← display heading font, weight 700 only
├── preview/                 ← design-system-tab cards (one per token group / component; 23–27 are Premium)
├── ui_kits/
│   └── website/             ← marketing-site UI kit (Hero, Header, Footer, Services, Team)
└── slides/                  ← deck slide templates matching the pitch deck
```

## Brand Snapshot

| | |
|---|---|
| **Name** | Helios Group |
| **Tagline** | *We build your unfair advantage.* |
| **What it is** | An AI consultancy. |
| **Promise** | "One 30-minute call. Identify your bottleneck. We handle development, implementation, and training." |
| **Website** | heliosgroup.ai |
| **Earlier identity** | Helios Marketing, "We Build AI Marketing Systems." (heliosmarketing.org). Don't use it in new work. |
| **Who it is** | A team of forward-deployed AI engineers who build and ship, not advise from the sidelines. |
| **Audience** | Founders and CEOs, marketing and growth leads, operators and COOs, technical leads — at professional-services firms and consumer brands. See [Who Helios is](#who-helios-is). |
| **Channels** | heliosgroup.ai · Instagram **@heliosgroup.ai** · **lucas@heliosgroup.ai** (confirmed 2026-10-21) |

### Who Helios is

Approved positioning, shared with every Helios social caption writer (The Helios Hub, `lib/social/captions/helios-context.ts`). Use it for any line that says what Helios is or who it's for.

- **Builders, not advisors.** Helios integrates systems and builds proprietary tools when off-the-shelf doesn't cut it. The focus is agentic marketing and sales: automating repetitive work while improving conversion, connecting the stack, and surfacing the intelligence buried in a company's data. Helios does both the strategy and the engineering, and ships full-stack products to production, not prototypes.
- **Full-stack visual AI.** Image generation, video generation and generative HTML-first design run in production for clients.
- **Who it builds for, and what each cares about:**
  - Founder/CEO: systems that remove the bottleneck slowing growth, without hiring a team to run them.
  - Marketing/growth: scaling efforts without more headcount or agency fees.
  - Operator/COO: automation that replaces manual, repeatable busywork with a system.
  - Technical lead: systems integration, stack modernization, custom agents.
- **Industries:** professional services (real estate, law, financial services and wealth management, hospitality and nightlife, accounting, insurance, architecture and construction, healthcare practices, home services, staffing, IT/MSPs, property management) and consumer brands (food and beverage, beauty, wellness, apparel, home goods, pets, fitness studios, automotive, education, travel). Use one as a concrete example when it fits; never list them.
- **Outcomes, as direction only:** cutting labor and software spend with owned systems; an integrated, AI-forward stack; scaling outreach and content without headcount; removing operational bottlenecks.
- **Facts about Helios are limited to this section.** Never invent a client, a project, a result, or something Helios "is already doing". The agency-era figures in the deck (`100+ ads weekly`, `80% cost savings`, `10x more content`) show the *style* of a stat panel; don't reuse the numbers in new work unless Lucas confirms them.

---

## Content Fundamentals

The voice on the marketing site is **professional, confident, and editorial**, but the body copy is set in *light weight* — it reads like a high-end magazine, not like SaaS marketing.

**Voice:**
- **Authoritative & direct.** "We build your unfair advantage." "We solve problems." "We don't just talk about the future. We build it." — these are the canonical headlines. **Never** narrow the brand promise to a single output (e.g. "we build content machines"). Helios Group is an AI consultancy; content, sales automation, custom agents, and AI systems are all *expressions* of the advantage, never the headline.
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

### Two surfaces
- **Editorial (white)** — the website, documents, most deck content slides. Everything in this section describes it unless it says otherwise.
- **Stage (dark)** — social posts (carousels, Last Few Days, Stories, Reels), deck title and hero slides, OG images. A charcoal ground (`--stage-top #161616` → `--stage-bottom #0B0B0B`) with white type. The stage may be **Premium** (lit): see [Premium](#premium-the-lit-stage). Pick one surface per page or slide; never mix them inside one frame.

### Color
- White (`#FFFFFF`) is the default editorial canvas. Negative space is the design.
- Off-black `--neutral-900 #171717` is used for all primary text and dark sections — softer than pure black.
- **Helios Orange `#FF5E1A`** is reserved for: primary CTAs, hover-state link color, key data points, the small dot dividers, the orange→hot-orange gradient inside the website's hero headline, and the page selection highlight. On the stage, the lit accent is **`--stage-orange #FF6A2A`**, the same orange lifted for a dark ground.
- **Helios Green `#138510`** is reserved for: eyebrows, category labels ("Partner Focus"), the secondary "Book a Call" button when scrolled. On a dark ground use **`--helios-green-on-dark #1BBF17`**: `#138510` is only ~3.6:1 against near-black. (The social carousels and Last Few Days already use it for company names.)
- **The sun gradient is the mark's own**, sampled from `assets/Helios-mark.png`: **`#FDC60F` (yellow, top) → `#F48C3F` (orange, ~35%) → `#EA3C3A` (red, solid from ~62% down)** — `--helios-sun`. Earlier versions of this file listed `#FF8A4F → #FF5E1A → #E63946`; that was the website's text gradient, not the logo, and those values stay as `--helios-orange-soft` / `--helios-orange-hot` for that use only.
- Avoid: bluish-purple gradients, semantic green/red beyond Helios Green, multicolor palettes.

### Type
- Display & headings: **Pragmatica Extended Bold** (custom OTF, weight 700 only). Tightly tracked. Used in `font-heading`. Often `uppercase` at hero scale.
- Body & UI: **Roboto** (Google Fonts), weights 300/400/500/700. Body copy almost always at `font-light` (300) for the editorial feel. UI labels at 500/600. **Social slides on the stage set body at 400**: light 300 thins out on a phone at feed size against a dark ground.
- Eyebrows: 12–14px, bold, **uppercase**, `letter-spacing: 0.18em`, usually green.
- Massive contrast between heading and body: hero is 100px, body is 18–20px light.
- A **serif** (Times-style) is used *only* for the giant decorative `"` quotation mark in client highlights — nowhere else.

### Spacing & Layout
- **Container**: `max-width: 1280px`, centered, `px-6` (24px) on the sides.
- **Vertical rhythm**: section padding is `py-24` (96px) or `py-32` (128px). Generous on purpose.
- **Grids**: CSS Grid with `grid-cols-1 md:grid-cols-2 lg:grid-cols-3/4`. Gaps are `gap-x-8` (32px) and `gap-y-16` (64px).
- Negative space is never collapsed — content is allowed to breathe.

### Backgrounds
- **Editorial:** almost always solid white or `--neutral-50` for alt sections. Sections often alternate `bg-white` ↔ `bg-neutral-50` for rhythm.
- On the website, the hero section is the *only* full-bleed dark surface: black with a looping `helios demo reel.webm` at 25% opacity, fading to white at the bottom via a vertical gradient. The footer is solid `--neutral-900`.
- **Stage:** the charcoal ground; social formats and deck titles live here. Lighting on it comes only from the Premium recipes.
- **No repeating patterns, no hand-drawn illustrations, no textures, no grain** — and, for Premium, **no paper, foil, emboss or letterpress** (all rejected 2026-10-20). Depth comes from light, never from texture.
- **Editorial** decorative gradients exist only in three places: the website's hero headline (orange→orange-light gradient `bg-clip-text`), the CTA button glow (`shadow-[0_0_40px_-10px_#FF5E1A]`), and the logo's sun. **On the stage**, gradients are the Premium lights, the sun gradient on small accents, and the glossy tile gradient — nothing else.

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
- **Editorial glassmorphism is reserved for the fixed header**: `bg-white/95 backdrop-blur-md` once scrolled past 50px, transparent above the fold (so it sits cleanly on the dark hero video). On the stage, frosted glass panes and pill chips are a Premium recipe (`.hp-glass`).
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
- The decorative dot dividers in the hero (`Content · Sales · More`) are `<span>` circles, not icons — they're 6–8px circles filled with `--helios-orange`. On the stage they may be **sun dots** (`.hp-dot`): the same 6–8px circle in the sun gradient with a small glow. A sun dot is a divider, never a stand-in for the logo.
- Logo treatment: the wordmark `assets/Helios-logo.png` is used in the header (`h-8 md:h-10`) and footer (`h-12`). The circular sun-mark `assets/Helios-mark.png` is used at large sizes — for OG images, social, and the deck title slide.
- **Logo protection (non-negotiable):** the Helios logo (mark or wordmark) must always be **fully visible** — never bleeding off the canvas, never partially covered by other elements, never overlapped by text. Maintain a clear-space margin of at least the height of the "H" on every side. The mark is allowed to be a *dominant* visual element, but only when the entire shape is in-frame with breathing room. **Do not** use a generic gradient circle as a stand-in for the logo — a gradient orb without the wordmark is not the brand. A halo around the mark (`.hp-orb`) is fine: it surrounds the whole mark and never covers it.

If a needed icon isn't in Lucide (rare), match its stroke weight (2px) and roundness — don't introduce a different icon family.

---

## Premium (the lit stage)

Cinematic lighting and depth on the stage. Approved by Lucas on 2026-10-20 from the Rally Point proposal (`HELIOS/Decks/RALLY POINT PROPOSAL.pdf`, pages 1, 4 and 5 — a client document, so it is referenced here, not copied in). First production use: Last Few Days carousel slides, light touch, 2026-10-21.

**Load** `colors_and_type.css` then `premium.css`, and put `class="premium"` on the slide, section or page. Every recipe is scoped under `.premium`, so editorial pages never pick it up.

**Two intensities:**

| | Use for | How |
|---|---|---|
| **Light** (default) | Daily social formats (Last Few Days, carousels, Stories). Lighting you feel more than see; the format's identity stays. | `.premium` |
| **Full** | Deck title and hero slides, covers, OG images, a one-off hero moment. | `.premium[data-premium="full"]` |

**The look:**
- **Ground:** charcoal `#161616 → #0B0B0B` under a warm orange glow (top right), a faint white lift (top left) and a faint red bloom (low). Where the top is covered or the title is centred, a spotlight sits behind the headline (`.premium--spot`, `--premium-spot-y`), or a beam falls from above (`.hp-beam`).
- **Sun:** the mark (`.hp-orb`) with a soft halo; sun dots (`.hp-dot`) as dividers.
- **Headlines:** huge Pragmatica Extended, white, uppercase; the last word or line is lit (`.hp-lit`: solid `#FF6A2A` with a glow).
- **Eyebrows:** tracked uppercase in stage orange with a short leading rule (`.hp-eyebrow`).
- **Icon tiles:** glossy orange gradient, drop glow, 1px top highlight, white Lucide icon (`.hp-tile`).
- **Cards:** dark, an orange glow in one corner, a faint ghost numeral (`.hp-card[data-num]`).
- **Glass:** frosted panes and pill chips with an inset top highlight (`.hp-glass`, `.hp-glass--pill`).
- **Lifted media:** deep drop shadow and top highlight (`.hp-lift`); photos may also catch warm light off one corner (`.hp-lift--lit`).
- **Rules and footers:** rules fade toward both edges (`.hp-rule`); footers are a 1px hairline with tracked small labels (`.hp-footer`).

**Rules:**
1. **Light and depth only.** Adding Premium to an existing format never changes its layout, copy, type sizes or spacing. Every recipe is paint: gradients, shadows, pseudo-elements.
2. **No transparent gradient text in rendered social slides.** Render checks (The Helios Hub's `fit-check`) read the text colour; `color: transparent` breaks them. Use `.hp-lit` (solid orange + glow). `.hp-lit--gradient` is for web pages and decks only.
3. **Logo plates and memes stay clean.** A company logo sits on its cream plate (`#F4F2ED`) and a meme on its own white, untinted: they get the drop shadow (`.hp-lift`) and nothing else — no corner light, no tint, no fade over them.
4. **Contrast holds.** White on the glossy tile is ~3.5:1 at its centre (fine for icons, not for small text). Body copy on the stage is `--stage-ink-2` or brighter.
5. **No textures, ever** — see Backgrounds.

Previews: `preview/23-premium-ground.html` … `preview/27-premium-title.html`.

---

## Source of truth

This repo (`HELIOS/CODE/helios-design-system`, git) is the only place the design system is edited. `scripts/sync.sh` copies it out:

| Copy | What it gets | Who reads it |
|---|---|---|
| Claude account skill (`helios-design-system`) | The whole skill, as `dist/helios-design-system.zip`, uploaded by hand in Claude's settings | Every Claude session |
| `HELIOS/Helios Design System/` | Everything | Claude's design tool, people browsing the folder |
| `HELIOS/CODE/helios-dashboards/helios-design-system/` | Everything | The dashboards project |
| `HELIOS/CODE/The-Helios-Hub/explainers/design/helios-design-system/` | The core: README, SKILL, CHANGELOG, both CSS files, logo, mark, font | The Hub (Explainers copies the logo; the Hub's own CSS restates these tokens and a test checks they still match) |

Apps that render in a clean headless browser (Hub carousels, Last Few Days, Stories) restate the tokens they use in their own CSS rather than importing this file; keep their values equal to the ones here.

## Index of UI kits and slides

- **`ui_kits/website/`** — marketing-site recreation. `index.html` shows hero → ticker → services → team → case-studies → footer in one page. Components: `Header.jsx`, `Hero.jsx`, `Ticker.jsx`, `Services.jsx`, `Team.jsx`, `CaseStudies.jsx`, `Footer.jsx`, `Button.jsx`.
- **`slides/`** — deck-template recreations matching the 11-slide pitch deck. `index.html` plays them in sequence; one HTML/JSX file per slide kind (Title, Team, Two-Column, Service grid, Stats, Pricing, Closing).

## Caveats / known substitutions

- **Pragmatica Extended** is a paid commercial typeface. Only the **Bold** weight is bundled (the only one shipped in the codebase). If you need other weights, license them separately. As a fallback we use Helvetica/Arial — adequate but not identical metrics.
- The Figma file is private; the visual reference here comes from the codebase + deck PDF + supplied assets, not from Figma directly.
- The hero `helios demo reel.webm` is not bundled (it's a large video asset). Mocks use a black-tinted poster frame as a stand-in.
