# Helios Text Engine

Programmatic text compositing for Helios reels. It takes a background from the image-generation step plus the on-screen copy, and outputs a PNG or JPEG at the **exact same resolution** as the input, ready for the image-to-video step.

#### Where it sits in the pipeline

```
Scene writer → Background image gen → [check-bg gate] → Text Engine → Image-to-video
                                            │                  │
                                   reject → regenerate   longer copy → smaller type, same words
```

#### Setup

```
pip install pillow numpy
```

Inter Medium is bundled in `fonts/` (SIL Open Font License, `fonts/OFL.txt`). It is the open-source stand-in for Instagram's Classic reel text, which is San Francisco on iPhone. San Francisco cannot be redistributed. The folder is self-contained; keep `engine.py`, `spec.json` and `fonts/` together.

#### What it guarantees

| Guarantee | How |
|---|---|
| Same resolution in and out | The background is never resized or cropped. Output size is asserted against input, both in memory and after saving. |
| PNG or JPEG only | Chosen by output extension. PNG is lossless (default). JPEG saves at quality 95 with 4:4:4 chroma so the white-on-black edges don't smear. |
| Identical typography at any resolution | Every size in `spec.json` is defined at 1080px width and scales proportionally. A 720×1280 image gets exactly the same proportions as a 1080×1920 one. |
| Copy is drawn | A headline that fits the 4-line rules stays at the design size. Longer copy is rebroken and the type steps down, no smaller than the preferred minimum, until the block plus its clear space sits in the dark center band. Lines that still do not fit are left off the still and named in the warnings. Words are never rewritten. |
| Smart line breaks from raw copy | Pass a plain sentence. Breaks prefer punctuation, keep a number with the next word, and avoid ending a line on an article or preposition. The side margin stays put while the type changes. |

#### Line-break rules

A short headline still uses the original limits: at most 4 lines, about 24 characters a line, inside the 860px measure at 1080 width. Longer copy keeps the measure and the dark band. Type may step down to the preferred minimum (36px at 1080 width). It does not go smaller to squeeze a paragraph, and the block does not spill past the band. Only a single word wider than the measure may use the smaller absolute minimum.

Always:

- Words are never split or hyphenated
- A number stays with the word after it ("40 people", "$4 trillion")
- The side margin does not shrink when the type does

Preferred, and kept whenever the line still fits:

- A line does not end on an article, preposition, conjunction, or possessive
- The last line is not a single leftover word
- Breaks fall after punctuation, or before words like "and", "but", "with"
- Names stay together

**Manual breaks.** A newline in the copy is kept when that layout fits. When it does not, the engine reflows and says so in the warnings.

**Protecting a phrase.** Join words with a non-breaking space (U+00A0) and they will never be separated.

#### CLI

```
# Composite one image
python engine.py render --bg bg.png --copy "Your copy here." --out out.png --meta

# Dry run: see the line breaks without an image (run this at the copy stage)
python engine.py breaks --copy "Your copy here."

# QA gate: is the center band of the background dark enough?
python engine.py check-bg --bg bg.png

# Batch from a manifest
python engine.py batch manifest.json --report report.json
```

`--meta` writes a JSON sidecar next to the output with the final lines, pixel sizes, text bounding box and warnings.

**Exit codes:** `0` ok · `2` copy is empty · `3` background failed QA · `4` batch had at least one failure.

##### Manifest format

```json
[
  {"background": "bg_01.png", "copy": "Nvidia just passed $4 trillion.", "output": "final/01.png"},
  {"background": "bg_02.png", "copy": "Three people.\nForty people's work.", "output": "final/02.jpg", "meta": true}
]
```

Paths are relative to the manifest. Each item runs independently, and every result is reported with a status of `ok`, `rejected_background`, `copy_does_not_fit` or `error`.

#### Python API

```python
from engine import render_text, preview_breaks, check_background, CopyDoesNotFitError

qa = check_background("bg.png")
if qa["pass"]:
    try:
        result = render_text("bg.png", "Your copy here.", "out.png", write_meta=True)
        print(result.layout.lines, result.warnings)
    except CopyDoesNotFitError as e:
        print(e, e.details)      # empty copy; longer copy is fitted or clipped at the floor
```

#### Background QA gate

`check-bg` measures the reserved band (30–62% of height) and fails if:

- the mean luma is above 0.12, or
- more than 2% of pixels have a brightest channel above 0.50

The second check uses the brightest RGB channel rather than luma on purpose. Helios orange has low luma (about 0.48), so a luma-only test would let an orange glow sit right behind the text. These thresholds are starting points; calibrate them on 20–30 approved backgrounds.

`render` also checks the actual area under the text plus its clear space, and returns a warning if it's brighter than spec or extends outside the dark band.

#### Changing the look

Edit `spec.json` only. It is the single source of truth for font, size, outline, spacing, block position, line-break rules, QA thresholds and output quality. Nothing is hard-coded in `engine.py`.

---
