# Changelog

## 2026-10-21 — dry-run fixes, examples

- **Stage type:** `premium.css` now turns headings and body light inside `.premium`; the base sheet coloured every
  `h1`–`h6` off-black, so a plain heading on the stage was invisible (found by the carousel dry run).
- **Logo facts:** there is one logo, the circular sun mark. `assets/Helios-logo.png` is a 1200px copy of it (same file as
  `favicon.png`), not a horizontal wordmark; no wordmark file exists. For a lockup, set the mark beside "Helios Group".
  The website UI kit inverted the mark into a white disc in its header and footer; removed.
- **Examples** (`examples/`): a two-slide Instagram carousel, a landing page with a Premium hero over an editorial
  section, and a 1200×630 link-preview image, built only from this system's files.
- `scripts/sync.sh` takes `HUB_DIR` to sync the Hub copy into a branch checkout.

## 2026-10-21 — one source of truth, facts fixed, Premium added

- **This repo is now the source of truth.** Built from the `HELIOS/Helios Design System` folder (the Helios Group
  rename), plus the Claude account skill's header and design-tool files (`_ds_manifest.json`, `_ds_bundle.js`,
  `design-canvas.jsx`, `image-slot.js`, `_adherence.oxlintrc.json`, card labels, `social/`, `uploads/`).
  `scripts/sync.sh` makes every other copy.
- **Confirmed by Lucas:** Instagram `@heliosgroup.ai`, email `lucas@heliosgroup.ai`, and the "Who Helios is"
  positioning shared with the Hub's caption writers (`lib/social/captions/helios-context.ts`).
- **Facts fixed:**
  - The sun gradient is the mark's own, sampled from `assets/Helios-mark.png`: `#FDC60F → #F48C3F → #EA3C3A`
    (`--helios-sun`). The old `#FF8A4F → #FF5E1A → #E63946` was the website's text gradient.
  - `--helios-green-on-dark #1BBF17` for green on a dark ground (what the social slides already use).
  - Two surfaces, editorial (white) and stage (dark), instead of "white is the canvas" everywhere.
  - Social slides on the stage set body copy at Roboto 400.
- **Premium (the lit stage)** added: tokens in `colors_and_type.css`, recipes in `premium.css`, rules in the README,
  preview cards 23–27. Approved by Lucas 2026-10-20 from the Rally Point proposal; first used on Last Few Days
  (light touch) 2026-10-21.
