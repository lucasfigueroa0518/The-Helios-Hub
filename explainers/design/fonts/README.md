# Explainer Reels fonts

The render machine is a clean headless Chrome: every font a frame names must ship as a file
(HyperFrames `font_family_without_font_face`). The worker copies this folder into each job's
`assets/fonts/` before `build-frame.mjs`. `tokens.json` lists **no** fonts: build-frame would give display and body to the first
brand font, collapsing Pragmatica + Roboto into one face. The Helios preset's FRAME.md carries the
`@font-face` block for these exact filenames instead.

| File | Family | Weight | Source / license |
|---|---|---|---|
| `PragmaticaExtended-Bold.otf` | Pragmatica Extended | 700 | Helios licensed brand font (`app/fonts/`, Helios design system). Headings only. |
| `Roboto-300.woff2` | Roboto | 300 | `@fontsource/roboto` 5.3.0 (`roboto-latin-300-normal.woff2`, renamed), SIL OFL 1.1 (`Roboto-LICENSE-OFL.txt`). Body. |
| `Roboto-400.woff2` | Roboto | 400 | same |
| `Roboto-500.woff2` | Roboto | 500 | same. Captions (E-12: Roboto Medium). |
| `Roboto-700.woff2` | Roboto | 700 | same. Eyebrows. |
