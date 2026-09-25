# Helios Reel Visual System — Build Plan

**For:** Cursor coding agent
**Purpose:** Build the visual layer of the Helios reel system as designed and approved below.

---

## 0. Instructions for the agent

- Build only what is in this document. Do not add stages, prompts, retries, or features that aren't described here.
- All prompts are used verbatim.
- The text compositing engine (Section 5 and Appendices A–B) is used exactly as provided.
- This is part of an existing full-stack web app (Supabase workers, GCP cloud worker, and more). Integrate using the existing infrastructure and patterns.

---

## 1. Overview

Short-form vertical reels for Helios: text-on-screen videos in education and storytelling categories. Each reel is about a specific story. The visual pipeline produces the still frame (background visual plus on-screen text) that the next step turns into video.

Models:
- **Scene writing:** Claude (Anthropic API)
- **Background image generation:** OpenAI image generation API. The model produces 9:16 output.
- **Text:** programmatic compositing with the self-contained Python engine (no image model involved)

---

## 2. Pipeline

```
Story + on-screen copy
        │
        ▼
Scene writer (Claude)  ── writes the [SCENE] block
        │
        ▼
Final image prompt = [STYLE] + [COLOR SYSTEM] + [DESIGN LANGUAGE] +
                     [PEOPLE] + [COMPOSITION] + [SCENE ← scene writer output] +
                     [AVOID]
        │
        ▼
Background image (OpenAI, 9:16)
        │
        ▼
Background check (engine: check-bg) ── dark center band QA
        │
        ▼
Text compositing (engine: render) ── same resolution in and out
        │
        ▼
Final frame (PNG or JPEG) → image-to-video step
```

**One master copy of the fixed blocks.** Keep a single master copy of the fixed style blocks. Both the scene writer's reference section and the final prompt assembly pull from it, so they never diverge.

---

## 3. Visual system

### Fixed style blocks (master copy)

```
[STYLE — FIXED, DO NOT ALTER]
High-end 3D render, Octane/Redshift quality, physically based materials. Low-key 
dark-studio lighting with deep crushed blacks. Matte black environment with 
light-absorbing, soft-touch and powder-coated surfaces. Roughly 85% of the frame 
in shadow. Single motivated key light plus subtle rim light. Clean, noise-free 
render, virtual 85mm lens, shallow depth of field, crisp micro-detail on the subject.

[COLOR SYSTEM — FIXED]
Monochrome matte-black and charcoal base with exactly two isolated accent colors:
- PRIMARY accent: vivid molten orange (#FF5E1A). Used for the key light, the single 
  hero glow, and the main focal point. One orange focal point per frame.
- SECONDARY accent: deep saturated emissive emerald-green (#138510). Used only for rim 
  light, faint background glow, and small UI details. Always subordinate to orange.
No other hues. Two-tone split grade. Glows are soft, controlled, and precise, 
never blown out.

[DESIGN LANGUAGE — FIXED]
Minimalist industrial design in the spirit of Dieter Rams: precise geometry, 
clean edges, no clutter. Tech elements appear as thin-line dark-mode interface 
graphics, subtle holographic data, node networks, or minimal hardware. 
Restrained neo-noir atmosphere with light volumetric haze for depth.

[PEOPLE — FIXED, WHEN PRESENT]
Humans appear only as silhouettes or partial figures (hands, shoulders, profiles, 
backs). Faces always in shadow and never fully lit or identifiable. Figures are 
rim-lit in green or edge-lit in orange. Rendered with the same stylized 3D realism 
as the environment, not photographic skin.

[COMPOSITION — FIXED]
Vertical 9:16 frame. The central horizontal band of the frame, from roughly 
30% to 62% of the frame height and spanning the full width, is a dark quiet 
zone reserved for text overlay. This band must be predominantly deep black: 
no light sources, no bright highlights, no orange elements, no high-contrast 
detail, no busy texture. Only dark forms, deep shadow, and at most a faint, 
dim green haze may pass through it. Place the subject and the single orange 
focal point in the upper portion of the frame (roughly 12%–30% of height) 
or the lower-middle portion (roughly 62%–78% of height), or frame the 
center from the edges. Never center the subject. The top and bottom edges 
of the frame stay dark and low detail. Overall image remains predominantly 
dark so white text reads cleanly anywhere in the center.

[SCENE — VARIABLE]
{insert scene description here}

[AVOID]
Rainbow or multicolor neon, cyberpunk city clutter, blue or purple tones, glossy 
reflective black, overexposure, blown highlights, grain, noise, lens flares, 
busy backgrounds, stock-photo look, cartoon or illustration style, visible text 
or logos generated in the image, centered subject, light source in the center 
of the frame, bright or orange elements in the middle of the frame, high-contrast 
detail behind the center, glow crossing the center of the frame, bright top or 
bottom edges
```

### Zone map (1080×1920 canvas)

Both the background and the text share this map.

| Zone | Vertical range | Role |
|---|---|---|
| Top UI zone | 0–12% | Covered by platform UI (profile, audio). Keep it dark and low detail. |
| Subject zone A | 12–30% | Primary option for placing the subject or focal point |
| Dark center band | 30–62% | Reserved for text. Predominantly black, no bright elements. |
| Subject zone B | 62–78% | Secondary option for placing the subject or focal point |
| Bottom UI zone | 78–100% | Covered by caption, buttons and progress bar. Keep it dark. |

---

## 4. Scene writer (Claude)

The scene writer writes the `[SCENE]` block. Scenes are inspired by each reel's specific story. The motif bank is inspiration only and is used as a fallback when the story offers no strong visual.

**Inputs:** STORY, CATEGORY, ON_SCREEN_TEXT, RECENT_SCENES (last ~10 scene blocks used on the feed).

**Prompt:**

```
ROLE
You write the [SCENE] block for Helios reel visuals. Your output is inserted 
into a fixed image-generation prompt. You describe WHAT is in the frame. 
The fixed blocks below control HOW it looks.

INPUTS YOU WILL RECEIVE
- STORY: the reel script
- CATEGORY: education or storytelling
- ON_SCREEN_TEXT: the text that will overlay this visual
- RECENT_SCENES: the last ~10 scene blocks used on the feed

OUTPUT
One scene description, 2–4 sentences, plain prose. Nothing else: no 
headers, no labels, no explanation.

PROCESS
1. Extract the story's SUBJECT (literal thing), TENSION (problem/stakes), 
   and TURN (moment of change).
2. Choose one translation mode:
   - LITERAL: the subject's physical form, stylized.
   - SYMBOLIC: a visual metaphor for the core idea.
   - HUMAN: a silhouetted figure in the story's key role or moment.
   Education reels lean LITERAL or SYMBOLIC. Storytelling reels lean HUMAN. 
   Always choose the mode that makes the story recognizable in under 
   one second.
3. Assign color by meaning. Orange marks the TURN or focal point, exactly 
   one per frame. Green marks the surrounding context or system. Name 
   which element is orange and which is green, but do not describe the 
   colors themselves beyond that.
4. Place the focal point. State explicitly whether the subject and orange 
   focal point sit in the UPPER zone or the LOWER zone of the frame. The 
   center of the frame is reserved for text and stays dark. Anything that 
   crosses the center must be a dark form or deep shadow. Compositions 
   that naturally leave a dark center are ideal: a figure in the lower 
   zone looking up toward an orange light above, a node network in the 
   upper zone fading to black below, a horizon glow along the lower edge.
5. Check against ON_SCREEN_TEXT. The visual should reinforce the text's 
   idea without repeating it literally.
6. Check against RECENT_SCENES. Do not reuse the same central subject, 
   setting, or composition as any of them. If your first idea overlaps, 
   choose a different mode or angle.

TRANSLATING INTO THE HELIOS WORLD
If the story's natural setting conflicts with the style (daylight, crowds, 
bright offices, outdoor scenes, color-heavy environments), translate it 
rather than depict it: reduce it to one subject, move it into darkness, 
and let a single orange element carry the setting. Example: a crowded 
trading floor becomes one lit desk in a vast dark room.

HARD CONSTRAINTS
- Inspired by this specific story, never generic tech imagery.
- One clear subject, placed in the upper or lower zone, never centered. 
  The center of the frame stays dark for text.
- No real logos, brand marks, or readable text. Represent real companies 
  and products through generic, stylized forms.
- People only as silhouettes or partial figures, faces in shadow.
- NEVER restate lighting, materials, render quality, camera, lens, color 
  grade, or anything else covered by the fixed blocks. Describe only the 
  scene's contents, arrangement, and which element carries each color.

FIXED STYLE BLOCKS (READ-ONLY REFERENCE — DO NOT RESTATE OR ALTER)
These are applied automatically after your output. Use them only to 
understand what will render well.

[Pulled from the master copy of the fixed style blocks in Section 3:
STYLE, COLOR SYSTEM, DESIGN LANGUAGE, PEOPLE, COMPOSITION, AVOID]

REFERENCE MOTIF BANK (INSPIRATION ONLY — USE AS A FALLBACK WHEN THE STORY 
OFFERS NO STRONG VISUAL)
Monolith processor · Circuit macro · Server column · Matte control dial · 
Cable anatomy · Neural node graph · Data stream · Signal from noise · 
Decision tree · Automation loop · Holographic dashboard · Growth curve · 
Tokenized text · Hand on interface · Figure at the console · Profile in 
glow · Walking the corridor · Two figures, one line · Hands assembling · 
Overlooking the grid · Black void stage · Data center aisle · 
Architectural monolith · Night skyline abstraction
```

### Motif bank (approved)

| Motif | Description |
|---|---|
| Monolith processor | A single matte black chip on a void, an orange glow bleeding from its core seams |
| Circuit macro | Extreme macro across circuit traces, with orange current pulsing along one path |
| Server column | One minimal server tower in darkness, rows of tiny green status LEDs, one orange indicator |
| Matte control dial | An industrial rotary dial mid-turn, orange ring light marking its position |
| Cable anatomy | Braided cables converging into a single port, green light traveling inward |
| Neural node graph | A sparse 3D network of nodes, one orange node activating and rippling outward through green links |
| Data stream | Thin particle streams flowing through darkness, converging into one orange point |
| Signal from noise | A chaotic field of dim particles resolving into one clean orange line |
| Decision tree | Branching thin-line pathways, with one branch lit orange and the rest fading to dark green |
| Automation loop | A minimal circular track with an orange pulse orbiting endlessly, green checkpoints along it |
| Holographic dashboard | A floating dark-mode UI panel with thin orange graphs and green metrics |
| Growth curve | A single orange line rising through a 3D grid floor |
| Tokenized text | Abstract glyph blocks dissolving into particles and reforming |
| Hand on interface | A silhouetted hand touching a floating panel, orange light spreading from the fingertip |
| Figure at the console | A back-view figure seated before a wall of dark screens, rim-lit green |
| Profile in glow | A side-profile silhouette, face in shadow, orange edge light tracing the jawline |
| Walking the corridor | A lone figure walking a matte black corridor toward an orange light at the end |
| Two figures, one line | Two silhouettes facing each other, a thin orange data line connecting them |
| Hands assembling | Partial hands fitting a glowing orange component into a matte device |
| Overlooking the grid | A figure standing above a vast dark grid of green nodes, one orange cluster below |
| Black void stage | An empty infinite matte black space with one orange-lit pedestal at center |
| Data center aisle | A symmetrical aisle of matte racks receding into haze, faint green along the floor |
| Architectural monolith | A giant brutalist black structure with one orange-lit doorway |
| Night skyline abstraction | A low-poly dark city seen from above, green grid lines, one building pulsing orange |

---

## 5. Text compositing engine

The on-screen copy is composited onto the background programmatically with a self-contained Python tool. It keeps the image at the same resolution and outputs PNG or JPEG for the image-to-video step.

### Structure

```
helios_text_engine/
├── engine.py            # Appendix B
├── spec.json            # Appendix A
├── README.md            # below
└── fonts/
    ├── Roboto-Regular.ttf
    └── LICENSE.txt
```

Font source: `https://github.com/googlefonts/roboto-2/raw/main/src/hinted/Roboto-Regular.ttf` (Apache 2.0). License: `https://raw.githubusercontent.com/googlefonts/roboto-2/main/LICENSE`.

### Text formatting spec

**Typography**

| Property | Spec |
|---|---|
| Font | Roboto Regular (weight 400) |
| Weight | Regular only. No bold, light, condensed or italic. |
| Case | Sentence case. No all caps. |
| Fill | Pure white #FFFFFF |
| Outline | Thin, uniform black #000000 stroke of about 3px at 1080 width. No drop shadow, glow or gradient. |
| Size | 64px at 1080×1920. Fixed for every reel. It never scales up or down. |
| Line height | 1.3× font size (about 83px) |
| Letter spacing | Default. No tracking changes. |
| Alignment | Center-aligned |

**Block geometry**

| Property | Spec |
|---|---|
| Max text width | 860px (about 80% of frame width), with at least 110px margin each side |
| Vertical anchor | Block centered at about 46% of frame height, slightly above true center, clear of the bottom UI |
| Max block height | 4 lines, about 330px |
| Clear space | At least one line height (about 83px) of dark background above and below the block, which lands the whole thing inside the 30–62% dark band |

### Engine README

#### Helios Text Engine

Programmatic text compositing for Helios reels. It takes a background from the image-generation step plus the on-screen copy, and outputs a PNG or JPEG at the **exact same resolution** as the input, ready for the image-to-video step.

#### Where it sits in the pipeline

```
Scene writer → Background image gen → [check-bg gate] → Text Engine → Image-to-video
                                            │                  │
                                   reject → regenerate   copy_does_not_fit → rewrite copy
```

#### Setup

```
pip install pillow numpy
```

Roboto Regular is bundled in `fonts/` (Apache 2.0, license included). The folder is self-contained; keep `engine.py`, `spec.json` and `fonts/` together.

#### What it guarantees

| Guarantee | How |
|---|---|
| Same resolution in and out | The background is never resized or cropped. Output size is asserted against input, both in memory and after saving. |
| PNG or JPEG only | Chosen by output extension. PNG is lossless (default). JPEG saves at quality 95 with 4:4:4 chroma so the white-on-black edges don't smear. |
| Identical typography at any resolution | Every size in `spec.json` is defined at 1080px width and scales proportionally. A 720×1280 image gets exactly the same proportions as a 1080×1920 one. |
| Font never shrinks to fit | Copy that can't fit under the rules raises `CopyDoesNotFitError` so it goes back upstream to be rewritten. |
| Smart line breaks from raw copy | Pass a plain sentence. The engine searches every valid layout (up to 4 lines), measures each line with real Roboto metrics, and picks the best-scoring one. |

#### Line-break rules enforced

Hard rules (a layout that breaks any of these is never chosen):

- Max 4 lines, max 24 characters per line, and no line wider than 860px at 1080 width
- Words are never split or hyphenated
- A number always stays with the word after it ("40 people", "$4 trillion")
- No line ends with an article, preposition, conjunction or possessive (full list in `spec.json`)
- The last line has at least 2 words (no orphans)

Scoring preferences (used to rank the valid layouts):

- Fewer lines
- Breaks after punctuation, or before words like "and", "but", "with"
- Balanced line lengths, with a penalty once adjacent lines differ by more than 8 characters
- Keeping runs of capitalized words (names such as "Goldman Sachs") on one line
- Avoiding inverted pyramids and stubby last lines

**Manual override.** If the copy already contains line breaks (`\n`), the engine respects them. Hard limits still apply; soft-rule issues come back as warnings instead of errors.

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

**Exit codes:** `0` ok · `2` copy does not fit · `3` background failed QA · `4` batch had at least one failure.

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
        print(e, e.details)      # send back to the copy step with these details
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

## 6. Out of scope for now

- Scene and video design for social media psychology (engagement). To be designed later.
- The image-to-video step itself.

---

## Appendix A — `helios_text_engine/spec.json`

```json
{
  "_comment": "Helios reel text overlay spec. Single source of truth. All pixel values are defined at the 1080px reference width and scale proportionally to the actual image width, so any resolution renders identically in proportion.",
  "reference_width_px": 1080,
  "typography": {
    "font_file": "fonts/Roboto-Regular.ttf",
    "font_size_px": 64,
    "stroke_width_px": 3,
    "line_height_multiplier": 1.3,
    "fill_rgb": [
      255,
      255,
      255
    ],
    "stroke_rgb": [
      0,
      0,
      0
    ],
    "case": "sentence"
  },
  "layout": {
    "max_text_width_px": 860,
    "block_center_y_ratio": 0.46,
    "clear_space_lines": 1.0
  },
  "line_breaks": {
    "max_lines": 4,
    "max_chars_per_line": 24,
    "min_words_last_line": 2,
    "balance_tolerance_chars": 8,
    "no_line_end_words": [
      "a",
      "an",
      "the",
      "of",
      "to",
      "in",
      "on",
      "at",
      "by",
      "for",
      "with",
      "from",
      "into",
      "onto",
      "and",
      "but",
      "or",
      "nor",
      "so",
      "yet",
      "as",
      "than",
      "that",
      "my",
      "your",
      "our",
      "their",
      "his",
      "her",
      "its"
    ],
    "good_line_start_words": [
      "and",
      "but",
      "or",
      "so",
      "because",
      "while",
      "when",
      "if",
      "then",
      "which",
      "who",
      "that",
      "with",
      "without",
      "for",
      "from",
      "to",
      "in",
      "into",
      "by",
      "after",
      "before",
      "until",
      "than"
    ]
  },
  "overflow_policy": "error",
  "background_qa": {
    "dark_band_top_ratio": 0.3,
    "dark_band_bottom_ratio": 0.62,
    "max_mean_luma": 0.12,
    "bright_pixel_value": 0.5,
    "max_bright_pixel_fraction": 0.02,
    "_comment": "Starting thresholds. Calibrate against 20-30 approved backgrounds. 'value' is the brightest RGB channel, so saturated orange registers as bright even though its luma is low."
  },
  "output": {
    "default_format": "png",
    "jpeg_quality": 95,
    "jpeg_subsampling": "4:4:4"
  }
}
```

---

## Appendix B — `helios_text_engine/engine.py`

```python
"""
Helios Text Engine
Programmatic text compositing for Helios reel backgrounds.

- Reads a background image, never resizes it, and writes PNG or JPEG at the
  exact same resolution.
- All typography and layout come from spec.json (single source of truth) and
  scale proportionally to the image width.
- Line breaks are computed automatically from raw copy using the Helios rules,
  measured against the real Roboto Regular font metrics.
- Copy that cannot fit under the rules raises CopyDoesNotFitError. The font is
  never shrunk to make copy fit.

Usage (CLI):
  python engine.py render  --bg bg.png --copy "Your copy here" --out out.png [--meta]
  python engine.py breaks  --copy "Your copy here"        # dry run, no image
  python engine.py check-bg --bg bg.png                    # dark-band QA gate
  python engine.py batch   manifest.json [--report report.json]
"""

from __future__ import annotations

import argparse
import itertools
import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

ENGINE_DIR = Path(__file__).resolve().parent
DEFAULT_SPEC = ENGINE_DIR / "spec.json"
NBSP = "\u00a0"

NUMERIC_TOKEN = re.compile(r"^[\$€£]?\d[\d,.]*(%|[kKmMbBxX]|\+)?[,.;:!?]?$")
BREAK_PUNCT = (",", ";", ":", ".", "!", "?", "—", "–")


# --------------------------------------------------------------------------- #
# Errors and results
# --------------------------------------------------------------------------- #

class CopyDoesNotFitError(ValueError):
    """Copy cannot be laid out under the Helios line-break rules."""

    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message)
        self.details = details or {}


@dataclass
class LayoutResult:
    lines: list[str]
    mode: str                      # "auto" or "manual"
    font_px: int
    stroke_px: int
    line_height_px: int
    max_width_px: int
    line_widths_px: list[int]
    warnings: list[str] = field(default_factory=list)


@dataclass
class RenderResult:
    output_path: str
    width: int
    height: int
    format: str
    layout: LayoutResult
    text_bbox: list[int]           # [x0, y0, x1, y1] of rendered text
    clear_zone: list[int]          # text bbox expanded by the clear space
    clear_zone_mean_luma: float
    warnings: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# Spec and scaling
# --------------------------------------------------------------------------- #

def load_spec(spec_path: str | Path | None = None) -> dict:
    path = Path(spec_path) if spec_path else DEFAULT_SPEC
    with open(path, encoding="utf-8") as f:
        spec = json.load(f)
    spec["_base_dir"] = str(path.resolve().parent)
    return spec


@dataclass
class Scaled:
    font: ImageFont.FreeTypeFont
    font_px: int
    stroke_px: int
    line_height_px: int
    max_width_px: int
    cap_height_px: int


def scale_spec(spec: dict, image_width: int) -> Scaled:
    """Convert spec values (defined at reference width) to this image's pixels."""
    typo, layout = spec["typography"], spec["layout"]
    k = image_width / spec["reference_width_px"]
    font_px = max(1, round(typo["font_size_px"] * k))
    stroke_px = max(1, round(typo["stroke_width_px"] * k))
    font_path = Path(spec["_base_dir"]) / typo["font_file"]
    font = ImageFont.truetype(str(font_path), font_px)
    cap_top = font.getbbox("H", anchor="ls")[1]      # negative: distance above baseline
    return Scaled(
        font=font,
        font_px=font_px,
        stroke_px=stroke_px,
        line_height_px=round(font_px * typo["line_height_multiplier"]),
        max_width_px=round(layout["max_text_width_px"] * k),
        cap_height_px=-cap_top,
    )


def _measure(text: str, sc: Scaled) -> int:
    """Rendered pixel width of one line including the outline on both sides."""
    return round(sc.font.getlength(text.replace(NBSP, " "))) + 2 * sc.stroke_px


# --------------------------------------------------------------------------- #
# Tokenizing
# --------------------------------------------------------------------------- #

def _bare(word: str) -> str:
    return re.sub(r"^[^\w$€£]+|[^\w%+]+$", "", word)


def _tokenize(copy: str) -> list[str]:
    """
    Split copy into unbreakable tokens.
    - Words already joined with a non-breaking space stay together
      (upstream can use NBSP to protect names or phrases).
    - A number is always bound to the word after it ("40 people", "$2M raise").
    """
    words = copy.split()                              # NBSP is not split on
    tokens: list[str] = []
    i = 0
    while i < len(words):
        w = words[i]
        if NUMERIC_TOKEN.match(w.split(NBSP)[-1]) and i + 1 < len(words) \
                and not w.endswith(BREAK_PUNCT):
            w = w + NBSP + words[i + 1]
            i += 1
        tokens.append(w)
        i += 1
    return tokens


def _is_proper(word: str) -> bool:
    b = _bare(word)
    return bool(b) and b[0].isupper() and b.lower() != "i"


def _word_count(line: str) -> int:
    return len(line.replace(NBSP, " ").split())


def _last_word(line: str) -> str:
    return _bare(line.replace(NBSP, " ").split()[-1]).lower()


# --------------------------------------------------------------------------- #
# Line breaking
# --------------------------------------------------------------------------- #

def _break_cost(left: str, right: str, rules: dict, prev_end_punct: bool) -> float:
    """Cost of placing a line break between two tokens (negative = good break)."""
    cost = 0.0
    if left.endswith(BREAK_PUNCT):
        cost -= 8
    elif _bare(right.split(NBSP)[0]).lower() in rules["good_line_start_words"]:
        cost -= 3
    # Splitting a run of capitalized words (likely a name) is strongly discouraged.
    if _is_proper(left.split(NBSP)[-1]) and _is_proper(right.split(NBSP)[0]) \
            and not prev_end_punct:
        cost += 40
    return cost


def _score(lines: list[str], break_costs: float, rules: dict) -> float:
    lens = [len(l) for l in lines]
    tol = rules["balance_tolerance_chars"]
    cost = (len(lines) - 1) * 12 + break_costs
    for a, b in zip(lens, lens[1:]):
        d = abs(a - b)
        cost += 0.5 * d + max(0, d - tol) * 4
    if len(lines) > 1:
        if lens[0] - lens[-1] > tol:                  # inverted pyramid
            cost += 5
        if lens[-1] < 0.4 * max(lens):                # stubby last line
            cost += 10
    return cost


def _hard_violations(lines: list[str], sc: Scaled, rules: dict) -> list[str]:
    v = []
    if len(lines) > rules["max_lines"]:
        v.append(f"{len(lines)} lines exceeds max of {rules['max_lines']}")
    for l in lines:
        if len(l) > rules["max_chars_per_line"]:
            v.append(f'line "{l}" is {len(l)} chars (max {rules["max_chars_per_line"]})')
        if _measure(l, sc) > sc.max_width_px:
            v.append(f'line "{l}" is {_measure(l, sc)}px wide (max {sc.max_width_px}px)')
    return v


def _soft_violations(lines: list[str], rules: dict) -> list[str]:
    v = []
    for l in lines[:-1]:
        if _last_word(l) in rules["no_line_end_words"]:
            v.append(f'line "{l}" ends with "{_last_word(l)}"')
    if len(lines) > 1 and _word_count(lines[-1]) < rules["min_words_last_line"]:
        v.append(f'last line "{lines[-1]}" is an orphan')
    return v


def break_lines(copy: str, sc: Scaled, spec: dict) -> LayoutResult:
    rules = spec["line_breaks"]
    copy = copy.strip()
    if not copy:
        raise CopyDoesNotFitError("Copy is empty.")

    base = dict(font_px=sc.font_px, stroke_px=sc.stroke_px,
                line_height_px=sc.line_height_px, max_width_px=sc.max_width_px)
    warnings = []
    letters = [c for c in copy if c.isalpha()]
    if len(letters) > 3 and all(c.isupper() for c in letters):
        warnings.append("Copy is in all caps; spec calls for sentence case.")

    # ---- Manual mode: upstream supplied explicit line breaks -------------- #
    if "\n" in copy:
        lines = [" ".join(l.split()) for l in copy.splitlines() if l.strip()]
        hard = _hard_violations(lines, sc, rules)
        if hard:
            raise CopyDoesNotFitError("Manual line breaks violate hard limits.",
                                      {"violations": hard, "lines": lines})
        warnings += [f"Manual breaks: {s}" for s in _soft_violations(lines, rules)]
        return LayoutResult(lines=[l.replace(NBSP, " ") for l in lines], mode="manual",
                            line_widths_px=[_measure(l, sc) for l in lines],
                            warnings=warnings, **base)

    # ---- Auto mode: search every valid break configuration ---------------- #
    tokens = _tokenize(copy)
    n = len(tokens)
    for t in tokens:
        if len(t) > rules["max_chars_per_line"] or _measure(t, sc) > sc.max_width_px:
            raise CopyDoesNotFitError(
                f'Unbreakable token "{t.replace(NBSP, " ")}" is wider than one line.',
                {"token": t.replace(NBSP, " ")})

    best, best_cost = None, float("inf")
    for k in range(1, min(rules["max_lines"], n) + 1):
        for cuts in itertools.combinations(range(1, n), k - 1):
            bounds = (0, *cuts, n)
            lines = [" ".join(tokens[a:b]) for a, b in zip(bounds, bounds[1:])]
            if _hard_violations(lines, sc, rules) or _soft_violations(lines, rules):
                continue
            bc = sum(
                _break_cost(tokens[c - 1], tokens[c], rules,
                            tokens[c - 2].endswith(BREAK_PUNCT) if c >= 2 else True)
                for c in cuts)
            cost = _score(lines, bc, rules)
            if cost < best_cost:
                best, best_cost = lines, cost

    if best is None:
        total = len(copy)
        cap = rules["max_lines"] * rules["max_chars_per_line"]
        raise CopyDoesNotFitError(
            "Copy cannot be laid out within the Helios line-break rules. "
            "Rewrite it shorter; the font is never reduced to fit.",
            {"copy_chars": total, "approx_capacity_chars": cap,
             "max_lines": rules["max_lines"],
             "max_chars_per_line": rules["max_chars_per_line"]})

    return LayoutResult(lines=[l.replace(NBSP, " ") for l in best], mode="auto",
                        line_widths_px=[_measure(l, sc) for l in best],
                        warnings=warnings, **base)


# --------------------------------------------------------------------------- #
# Image I/O and QA
# --------------------------------------------------------------------------- #

def _open_rgb(path: str | Path) -> tuple[Image.Image, dict]:
    img = Image.open(path)
    info = {"icc_profile": img.info.get("icc_profile")}
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        bg = Image.new("RGB", rgba.size, (0, 0, 0))
        bg.paste(rgba, mask=rgba.split()[-1])
        img = bg
    else:
        img = img.convert("RGB")
    return img, info


def _luma(arr: np.ndarray) -> np.ndarray:
    a = arr.astype(np.float32) / 255.0
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def check_background(bg_path: str | Path, spec: dict | None = None) -> dict:
    """QA gate: is the reserved center band dark enough for white text?"""
    spec = spec or load_spec()
    qa = spec["background_qa"]
    img, _ = _open_rgb(bg_path)
    w, h = img.size
    y0, y1 = round(h * qa["dark_band_top_ratio"]), round(h * qa["dark_band_bottom_ratio"])
    band = _luma(np.asarray(img)[y0:y1])
    mean = float(band.mean())
    val = np.asarray(img)[y0:y1].max(axis=2).astype(np.float32) / 255.0
    bright = float((val > qa["bright_pixel_value"]).mean())
    reasons = []
    if mean > qa["max_mean_luma"]:
        reasons.append(f"mean luma {mean:.3f} > {qa['max_mean_luma']}")
    if bright > qa["max_bright_pixel_fraction"]:
        reasons.append(f"bright pixel fraction {bright:.3%} > {qa['max_bright_pixel_fraction']:.0%}")
    return {"background": str(bg_path), "width": w, "height": h,
            "band_px": [y0, y1], "mean_luma": round(mean, 4),
            "bright_fraction": round(bright, 5), "pass": not reasons,
            "reasons": reasons}


def _save(img: Image.Image, out: Path, fmt: str, spec: dict, info: dict) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    extra = {"icc_profile": info["icc_profile"]} if info.get("icc_profile") else {}
    if fmt == "JPEG":
        img.save(out, "JPEG", quality=spec["output"]["jpeg_quality"],
                 subsampling=0, optimize=True, **extra)
    else:
        img.save(out, "PNG", compress_level=6, **extra)


def _resolve_format(out: Path, spec: dict) -> str:
    ext = out.suffix.lower()
    if ext in (".jpg", ".jpeg"):
        return "JPEG"
    if ext == ".png":
        return "PNG"
    if ext == "":
        return "PNG" if spec["output"]["default_format"] == "png" else "JPEG"
    raise ValueError(f"Unsupported output extension '{ext}'. Use .png, .jpg or .jpeg.")


# --------------------------------------------------------------------------- #
# Render
# --------------------------------------------------------------------------- #

def render_text(bg_path: str | Path, copy: str, out_path: str | Path,
                spec: dict | None = None, write_meta: bool = False) -> RenderResult:
    spec = spec or load_spec()
    out = Path(out_path)
    fmt = _resolve_format(out, spec)
    if out.suffix == "":
        out = out.with_suffix(".png" if fmt == "PNG" else ".jpg")

    img, info = _open_rgb(bg_path)
    w, h = img.size
    sc = scale_spec(spec, w)
    layout = break_lines(copy, sc, spec)
    warnings = list(layout.warnings)

    # Vertical placement: center the visual block (cap top of line 1 to the
    # baseline of the last line) on block_center_y_ratio.
    n = len(layout.lines)
    block_h = sc.cap_height_px + (n - 1) * sc.line_height_px
    top = h * spec["layout"]["block_center_y_ratio"] - block_h / 2
    baselines = [round(top + sc.cap_height_px + i * sc.line_height_px) for i in range(n)]

    typo = spec["typography"]
    draw = ImageDraw.Draw(img)
    boxes = []
    for line, y in zip(layout.lines, baselines):
        kw = dict(font=sc.font, anchor="ms", stroke_width=sc.stroke_px)
        draw.text((w / 2, y), line, fill=tuple(typo["fill_rgb"]),
                  stroke_fill=tuple(typo["stroke_rgb"]), **kw)
        boxes.append(draw.textbbox((w / 2, y), line, **kw))

    bbox = [int(min(b[0] for b in boxes)), int(min(b[1] for b in boxes)),
            int(round(max(b[2] for b in boxes))), int(round(max(b[3] for b in boxes)))]

    # Clear-space zone and dark-band containment checks (warnings, not errors).
    pad = round(sc.line_height_px * spec["layout"]["clear_space_lines"])
    zone = [max(0, bbox[0] - pad), max(0, bbox[1] - pad),
            min(w, bbox[2] + pad), min(h, bbox[3] + pad)]
    qa = spec["background_qa"]
    band_top, band_bot = h * qa["dark_band_top_ratio"], h * qa["dark_band_bottom_ratio"]
    if zone[1] < band_top or zone[3] > band_bot:
        warnings.append("Text block plus clear space extends outside the reserved "
                        "dark band; check aspect ratio or line count.")
    src, _ = _open_rgb(bg_path)   # measure the untouched background under the zone
    zl = _luma(np.asarray(src)[zone[1]:zone[3], zone[0]:zone[2]])
    zone_mean = float(zl.mean())
    if zone_mean > qa["max_mean_luma"]:
        warnings.append(f"Background under the text is brighter than spec "
                        f"(mean luma {zone_mean:.3f} > {qa['max_mean_luma']}).")

    assert img.size == (w, h), "Resolution changed during compositing."
    _save(img, out, fmt, spec, info)
    with Image.open(out) as check:
        assert check.size == (w, h), "Saved file resolution does not match input."

    result = RenderResult(output_path=str(out), width=w, height=h, format=fmt,
                          layout=layout, text_bbox=bbox, clear_zone=zone,
                          clear_zone_mean_luma=round(zone_mean, 4), warnings=warnings)
    if write_meta:
        out.with_suffix(".json").write_text(json.dumps(asdict(result), indent=2))
    return result


def preview_breaks(copy: str, spec: dict | None = None, width: int | None = None) -> LayoutResult:
    """Dry run: compute line breaks without an image (for upstream copy checks)."""
    spec = spec or load_spec()
    return break_lines(copy, scale_spec(spec, width or spec["reference_width_px"]), spec)


# --------------------------------------------------------------------------- #
# Batch
# --------------------------------------------------------------------------- #

def run_batch(manifest_path: str | Path, spec: dict | None = None,
              check_bg: bool = True) -> list[dict]:
    """
    Manifest: JSON list of {"background": ..., "copy": ..., "output": ...}.
    Relative paths resolve against the manifest's folder. Each item is
    processed independently; failures are reported, not fatal.
    """
    spec = spec or load_spec()
    manifest_path = Path(manifest_path)
    root = manifest_path.resolve().parent
    items = json.loads(manifest_path.read_text(encoding="utf-8"))
    report = []
    for i, item in enumerate(items):
        bg = root / item["background"]
        out = root / item["output"]
        entry = {"index": i, "background": str(bg), "output": str(out)}
        try:
            if check_bg:
                qa = check_background(bg, spec)
                entry["background_qa"] = qa
                if not qa["pass"]:
                    entry.update(status="rejected_background")
                    report.append(entry)
                    continue
            res = render_text(bg, item["copy"], out, spec,
                              write_meta=item.get("meta", False))
            entry.update(status="ok", lines=res.layout.lines, warnings=res.warnings)
        except CopyDoesNotFitError as e:
            entry.update(status="copy_does_not_fit", error=str(e), details=e.details)
        except Exception as e:  # noqa: BLE001
            entry.update(status="error", error=f"{type(e).__name__}: {e}")
        report.append(entry)
    return report


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def _cli(argv=None) -> int:
    p = argparse.ArgumentParser(description="Helios reel text compositing engine")
    p.add_argument("--spec", default=None, help="Path to spec.json")
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("render", help="Composite copy onto one background")
    r.add_argument("--bg", required=True)
    r.add_argument("--copy", required=True, help="Raw copy. Use \\n for manual breaks.")
    r.add_argument("--out", required=True, help="Output .png or .jpg")
    r.add_argument("--meta", action="store_true", help="Write a .json sidecar")

    b = sub.add_parser("breaks", help="Dry-run line breaks for a piece of copy")
    b.add_argument("--copy", required=True)
    b.add_argument("--width", type=int, default=None)

    c = sub.add_parser("check-bg", help="Dark-band QA gate for a background")
    c.add_argument("--bg", required=True)

    m = sub.add_parser("batch", help="Process a manifest of renders")
    m.add_argument("manifest")
    m.add_argument("--report", default=None)
    m.add_argument("--skip-bg-check", action="store_true")

    a = p.parse_args(argv)
    spec = load_spec(a.spec)

    try:
        if a.cmd == "render":
            res = render_text(a.bg, a.copy.replace("\\n", "\n"), a.out, spec, a.meta)
            print(json.dumps({"output": res.output_path, "size": [res.width, res.height],
                              "lines": res.layout.lines, "warnings": res.warnings}, indent=2))
        elif a.cmd == "breaks":
            lay = preview_breaks(a.copy.replace("\\n", "\n"), spec, a.width)
            print(json.dumps(asdict(lay), indent=2))
        elif a.cmd == "check-bg":
            res = check_background(a.bg, spec)
            print(json.dumps(res, indent=2))
            return 0 if res["pass"] else 3
        elif a.cmd == "batch":
            rep = run_batch(a.manifest, spec, check_bg=not a.skip_bg_check)
            text = json.dumps(rep, indent=2)
            if a.report:
                Path(a.report).write_text(text)
            print(text)
            return 0 if all(x["status"] == "ok" for x in rep) else 4
    except CopyDoesNotFitError as e:
        print(json.dumps({"error": str(e), "details": e.details}, indent=2), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
```
