# Helios Social: slide buckets and variants (slide design spec)

**Owner:** Tommy Pozo
**Status:** DECIDED design (Tommy, 2026-10-07, sixth round); variants beyond today's are OPEN until their mock-ups are approved.
**Companion:** the photo spec (`2026-10-07-photo-spec.md` §4) decides each slide's photo; this spec decides how the slide is laid out.

## 1. Who decides what

| Decision | Who | From |
|---|---|---|
| What a slide **says**: text, 1–2 numbers, or a quote | the Writer | the brief |
| What **visual** it asks for (kind + description, plus a fallback) | the Writer | the brief (photo spec §4) |
| Which **photo** it gets | code + Haiku tags + Jev fit | photo spec §4 |
| Which **bucket** it goes in | **Jev** (`slide-bucket@1`, a choice) | the slide's content type, copy, lengths, photo tags |
| Which **variant** of the bucket | **Jev** (`slide-variant@1`, a choice) | among the variants code allows (§3) |

The Writer never picks a layout. Jev never writes or changes words.

## 2. Buckets

| Bucket | Content it takes |
|---|---|
| **cover** | the chosen cover line |
| **story** | text (headline + body); what used to be text, landing and image slides |
| **stat** | 1 number (stat) or 2 numbers (split stat); at most 2 stat slides per post |
| **quote** | a quote by ID |
| **spread** | two neighbouring text slides sharing one wide photo |

Content decides the possible buckets: text → story, or spread for a neighbouring pair; numbers → stat; a quote → quote.
**Spread:** Jev picks the pair among neighbouring text slides that have a wide candidate (at least 1.45:1); **exactly one
per post** when any pair qualifies; otherwise none, and the report says why.

## 3. Variants

Each variant states what it needs. Code removes those the slide can't meet, and **those already used in the post**;
Jev picks among the rest by how well the slide's elements fit (photo kind, copy type, copy length).

| Bucket | Variant | Needs | Status |
|---|---|---|---|
| cover | bleed | a scene photo or a person framed for full bleed | built |
| cover | split | a person photo | built |
| cover | logo card | a logo | built |
| cover | icon | no photo | built |
| story | photo below | any photo but a logo-only | built |
| story | photo top | any photo | built |
| story | full bleed | a scene photo or a framed person | built |
| story | text only | no photo | built |
| story | landing (one big centred line, optional photo below) | a short headline (≤ 60 chars) and a short body | built |
| story | +1 new | OPEN: mock-up | to design |
| stat | backdrop | a scene or headquarters photo | built |
| stat | plain | no photo | built |
| stat | +1 new | OPEN: mock-up | to design |
| quote | speaker | a verified photo of the speaker | built |
| quote | backdrop | a scene or headquarters photo | built |
| quote | type-led | no photo | built |
| quote | +1 new | OPEN: mock-up | to design |
| spread | text bottom | a wide scene photo | built |
| spread | text top | a wide scene photo | built |
| spread | **photo centred across the seam, text to its left and right** (Tommy, 2026-10-07) | a wide scene photo | to design |

**No repeats:** a variant used once is out for the rest of the post. The story bucket gets enough variants (5 built today, a sixth to
design) that it never runs dry (Tommy, 2026-10-07). Until then, on a post with more story slides than variants, a fully used story bucket may reuse its
least recently used variant, never on neighbouring slides, logged.

Every variant passes the frozen render checks: text fit, bounds, contrast, faces clear of text, C7.

## 4. What Jev reads

One state per decision: the slide's content type, headline and body lengths (characters), number or quote length,
the photo's kind (scene, person, logo, none), its Haiku tags, its shape (wide, tall), and the variants already used.
Jev answers with `choice`; its probabilities are logged with the pick.

## 5. Adaptive framing and finishes (Tommy, 2026-10-07: "more premium … how pixelized an image can become … when it's nice for an image to go end to end")

Code (`lib/social/render/framing.ts`) decides from the photo's own pixel size and the frame it would fill:

- **End to end** (full bleed, the bleed cover, spreads) only when the photo needs at most **1.5×** enlargement; darkened backdrops (stat, quote) at most **2.2×**, softened with a light blur. A scene too small for a full-bleed cover takes the framed split cover.
- **Panels** fill edge to edge when the photo needs at most **1.25×** and the crop keeps at least 60% of it; otherwise a **matte**: the photo whole and sharp (never past 1.25×) on a blurred, darkened copy of itself. Unknown size: matte.
- **Finishes:** rounded panels with a soft drop shadow and an inner hairline; eased fades under text (0.84 where copy starts); the split cover melts into the canvas; feathered edges when the face framing narrows a person photo; backdrops darkest where copy sits, with a shallow blur; a blurred-glass credit pill and arrow disc; a quiet double ring on the speaker portrait; balanced headline lines. No new colours, no texture (the Helios brand).
