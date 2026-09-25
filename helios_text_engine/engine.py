"""
Helios Text Engine
Programmatic text compositing for Helios reel backgrounds.

- Reads a background image, never resizes it, and writes PNG or JPEG at the
  exact same resolution.
- All typography and layout come from spec.json (single source of truth) and
  scale proportionally to the image width.
- Line breaks are computed from raw copy using the Helios rhythm rules,
  measured against the real Inter Medium font metrics.
- Copy that fits the headline rules stays at the design size. Longer copy is
  rebroken and the type is reduced until the block sits in the dark band with
  the side margin and the clear space intact. Empty copy still raises.

Usage (CLI):
  python engine.py render  --bg bg.png --copy "Your copy here" --out out.png [--meta]
  python engine.py breaks  --copy "Your copy here"        # dry run, no image
  python engine.py check-bg --bg bg.png                    # dark-band QA gate
  python engine.py batch   manifest.json [--report report.json]
"""

from __future__ import annotations

import argparse
import copy
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
    descent_px: int


def scale_spec(spec: dict, image_width: int, font_px: int | None = None) -> Scaled:
    """Convert spec values (defined at reference width) to this image's pixels.

    `font_px` overrides the design size. Stroke scales with that override.
    The side margin stays at the spec width, so smaller type does not pull
    the text into a narrower column.
    """
    typo, layout = spec["typography"], spec["layout"]
    k = image_width / spec["reference_width_px"]
    design_font = max(1, round(typo["font_size_px"] * k))
    design_stroke = max(1, round(typo["stroke_width_px"] * k))
    chosen = design_font if font_px is None else max(1, font_px)
    stroke_px = max(1, round(design_stroke * chosen / design_font))
    font_path = Path(spec["_base_dir"]) / typo["font_file"]
    font = ImageFont.truetype(str(font_path), chosen)
    cap_top = font.getbbox("H", anchor="ls")[1]      # negative: distance above baseline
    descent = font.getbbox("gyq", anchor="ls")[3]
    return Scaled(
        font=font,
        font_px=chosen,
        stroke_px=stroke_px,
        line_height_px=round(chosen * typo["line_height_multiplier"]),
        max_width_px=round(layout["max_text_width_px"] * k),
        cap_height_px=-cap_top,
        descent_px=max(0, descent),
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


def _band_room(sc: Scaled, image_height: int, spec: dict) -> float:
    """Vertical room inside the dark band after the clear-space padding."""
    qa = spec["background_qa"]
    band = image_height * (qa["dark_band_bottom_ratio"] - qa["dark_band_top_ratio"])
    pad = sc.line_height_px * spec["layout"]["clear_space_lines"]
    return band - 2 * pad


def _block_height(line_count: int, sc: Scaled) -> float:
    if line_count <= 0:
        return 0
    return sc.cap_height_px + sc.descent_px + (line_count - 1) * sc.line_height_px


def _max_lines_in_band(sc: Scaled, image_height: int, spec: dict) -> int:
    room = _band_room(sc, image_height, spec)
    first = sc.cap_height_px + sc.descent_px
    if room < first:
        return 0
    return 1 + int((room - first) // sc.line_height_px)


def _prepare_tokens(copy: str) -> tuple[list[str], set[int]]:
    """Tokens for the whole copy. A newline is a preferred break, not a wall."""
    preferred: set[int] = set()
    tokens: list[str] = []
    for para in copy.splitlines():
        part = _tokenize(para.strip())
        if not part:
            continue
        if tokens:
            preferred.add(len(tokens))
        tokens.extend(part)
    return tokens, preferred


def _measure_tokens(tokens: list[str], sc: Scaled) -> int:
    return _measure(" ".join(tokens), sc)


def _wrap_tokens(
    tokens: list[str],
    sc: Scaled,
    rules: dict,
    preferred: set[int],
) -> list[list[str]] | None:
    """Greedy wrap that backs up to a rhythmic break near the full measure."""
    lines: list[list[str]] = []
    n = len(tokens)
    i = 0
    while i < n:
        farthest = i
        for j in range(i + 1, n + 1):
            if _measure_tokens(tokens[i:j], sc) > sc.max_width_px:
                break
            farthest = j
        if farthest == i:
            return None
        if farthest == n:
            lines.append(tokens[i:n])
            break
        best_b = farthest
        best_cost: float | None = None
        for b in range(farthest, i, -1):
            if _measure_tokens(tokens[i:b], sc) > sc.max_width_px:
                continue
            cost = _break_cost(
                tokens[b - 1],
                tokens[b],
                rules,
                tokens[b - 2].endswith(BREAK_PUNCT) if b >= 2 else True,
            )
            if _last_word(" ".join(tokens[i:b])) in rules["no_line_end_words"]:
                cost += 50
            if b in preferred:
                cost -= 30
            slack = (sc.max_width_px - _measure_tokens(tokens[i:b], sc)) / sc.max_width_px
            cost += slack * 6
            if best_cost is None or cost < best_cost:
                best_cost = cost
                best_b = b
        lines.append(tokens[i:best_b])
        i = best_b
    _push_function_words(lines, sc, rules)
    _pull_orphan(lines, sc, rules)
    _fill_short_lines(lines, sc, rules)
    _push_function_words(lines, sc, rules)
    return lines


def _fill_short_lines(lines: list[list[str]], sc: Scaled, rules: dict) -> None:
    """Pull words down onto a short line so a clause does not sit in a stub.

    If the first word pulled would leave an article at the end of the line
    above, take that article down too.
    """
    banned = rules["no_line_end_words"]
    for i in range(1, len(lines)):
        while len(lines[i - 1]) > 2 and _measure_tokens(lines[i], sc) < 0.55 * sc.max_width_px:
            moved = False
            for k in range(1, len(lines[i - 1])):
                prev = lines[i - 1][:-k]
                if len(prev) < 2:
                    break
                if _last_word(" ".join(prev)) in banned:
                    continue
                nxt = [*lines[i - 1][-k:], *lines[i]]
                if _measure_tokens(nxt, sc) > sc.max_width_px:
                    break
                # Don't hollow out the line above to pad the one below.
                if _measure_tokens(prev, sc) < _measure_tokens(nxt, sc):
                    break
                lines[i - 1] = prev
                lines[i] = nxt
                moved = True
                break
            if not moved:
                break


def _push_function_words(lines: list[list[str]], sc: Scaled, rules: dict) -> None:
    """Move a trailing article or preposition onto the next line when it fits."""
    for _ in range(20):
        moved = False
        for i in range(len(lines) - 1):
            if len(lines[i]) <= 1:
                continue
            if _last_word(" ".join(lines[i])) not in rules["no_line_end_words"]:
                continue
            prev = lines[i][:-1]
            nxt = [lines[i][-1], *lines[i + 1]]
            if _measure_tokens(prev, sc) > sc.max_width_px or _measure_tokens(nxt, sc) > sc.max_width_px:
                continue
            lines[i] = prev
            lines[i + 1] = nxt
            moved = True
        if not moved:
            return


def _pull_orphan(lines: list[list[str]], sc: Scaled, rules: dict) -> None:
    """Keep the last line from being a single leftover word."""
    minimum = rules["min_words_last_line"]
    for _ in range(10):
        if len(lines) < 2:
            return
        if _word_count(" ".join(lines[-1])) >= minimum:
            return
        if len(lines[-2]) <= 1:
            return
        prev = lines[-2][:-1]
        last = [lines[-2][-1], *lines[-1]]
        if _measure_tokens(prev, sc) > sc.max_width_px or _measure_tokens(last, sc) > sc.max_width_px:
            return
        lines[-2] = prev
        lines[-1] = last


def _layout_from_tokens(groups: list[list[str]], sc: Scaled, mode: str, warnings: list[str]) -> LayoutResult:
    lines = [" ".join(group).replace(NBSP, " ") for group in groups]
    return LayoutResult(
        lines=lines,
        mode=mode,
        font_px=sc.font_px,
        stroke_px=sc.stroke_px,
        line_height_px=sc.line_height_px,
        max_width_px=sc.max_width_px,
        line_widths_px=[_measure(line, sc) for line in lines],
        warnings=warnings,
    )


def _honors_breaks(groups: list[list[str]], preferred: set[int]) -> bool:
    starts: set[int] = set()
    cursor = 0
    for group in groups:
        starts.add(cursor)
        cursor += len(group)
    return preferred.issubset(starts)


def _attempt_fit(
    tokens: list[str],
    sc: Scaled,
    rules: dict,
    preferred: set[int],
    image_height: int,
    spec: dict,
    allow_spill: bool,
) -> list[list[str]] | None:
    groups = _wrap_tokens(tokens, sc, rules, preferred)
    if groups is None:
        return None
    if allow_spill or len(groups) <= _max_lines_in_band(sc, image_height, spec):
        return groups
    return None


def _fit_copy(
    copy: str,
    image_width: int,
    image_height: int,
    spec: dict,
    tokens: list[str],
    preferred: set[int],
    design: Scaled,
) -> tuple[LayoutResult, Scaled]:
    """Largest type at or above the preferred minimum that stays inside the band."""
    rules = spec["line_breaks"]
    typo = spec["typography"]
    k = image_width / spec["reference_width_px"]
    preferred_min = max(1, round(typo.get("min_font_size_px", 36) * k))
    absolute_min = max(1, round(typo.get("absolute_min_font_size_px", 22) * k))
    absolute_min = min(absolute_min, design.font_px)

    def at_size(size: int) -> tuple[list[list[str]] | None, Scaled]:
        sc = design if size == design.font_px else scale_spec(spec, image_width, size)
        return _attempt_fit(tokens, sc, rules, preferred, image_height, spec, allow_spill=False), sc

    best_groups: list[list[str]] | None = None
    best_sc: Scaled | None = None
    # An explicit newline is kept when a slightly smaller size can hold it.
    if preferred:
        for size in range(design.font_px, preferred_min - 1, -1):
            groups, sc = at_size(size)
            if groups is not None and _honors_breaks(groups, preferred):
                best_groups, best_sc = groups, sc
                break
    if best_groups is None:
        lo, hi = min(preferred_min, design.font_px), design.font_px
        while lo <= hi:
            mid = (lo + hi) // 2
            groups, sc = at_size(mid)
            if groups is not None:
                best_groups, best_sc = groups, sc
                lo = mid + 1
            else:
                hi = mid - 1

    warnings: list[str] = []
    if best_groups is None or best_sc is None:
        # Stay at the preferred minimum and inside the band. An unbreakable
        # word may go smaller so that one word can still be drawn.
        sc = scale_spec(spec, image_width, min(preferred_min, design.font_px))
        groups = _wrap_tokens(tokens, sc, rules, preferred)
        size = sc.font_px
        while groups is None and size > absolute_min:
            size -= 2
            sc = scale_spec(spec, image_width, size)
            groups = _wrap_tokens(tokens, sc, rules, preferred)
        if groups is None:
            sc = scale_spec(spec, image_width, absolute_min)
            groups = [[token] for token in tokens]
            warnings.append("A word is wider than the text measure. It is still drawn.")
        room = max(1, _max_lines_in_band(sc, image_height, spec))
        if len(groups) > room:
            omitted = len(groups) - room
            groups = groups[:room]
            warnings.append(
                f"{omitted} line(s) do not fit in the dark band at the smallest readable size and are not on this still."
            )
        best_groups, best_sc = groups, sc

    if best_sc.font_px < design.font_px:
        warnings.append(
            f"Type set at {best_sc.font_px}px to fit the dark band (design size is {design.font_px}px)."
        )
    if best_sc.font_px < preferred_min:
        warnings.append(
            f"Type is {best_sc.font_px}px, under the preferred minimum of {preferred_min}px."
        )
    if preferred:
        starts: set[int] = set()
        cursor = 0
        for group in best_groups:
            starts.add(cursor)
            cursor += len(group)
        if not preferred.issubset(starts):
            warnings.append("Explicit line breaks were reflowed so the copy would fit.")

    letters = [c for c in copy if c.isalpha()]
    if len(letters) > 3 and all(c.isupper() for c in letters):
        warnings.append("Copy is in all caps; spec calls for sentence case.")

    return _layout_from_tokens(best_groups, best_sc, "fit", warnings), best_sc


def layout_for_image(
    copy: str,
    image_width: int,
    image_height: int,
    spec: dict,
) -> tuple[LayoutResult, Scaled]:
    """Headline layout when the copy fits; otherwise rebreak and resize to fit."""
    copy = copy.strip()
    if not copy:
        raise CopyDoesNotFitError("Copy is empty.")

    design = scale_spec(spec, image_width)
    if spec.get("overflow_policy", "fit") == "error":
        return break_lines(copy, design, spec), design

    rules = spec["line_breaks"]
    tokens, preferred = _prepare_tokens(copy)
    plain = " ".join(copy.split())
    obviously_long = "\n" not in copy and (
        len(tokens) > rules["max_lines"] * 8
        or len(plain) > rules["max_lines"] * rules["max_chars_per_line"]
    )
    if not obviously_long:
        try:
            layout = break_lines(copy, design, spec)
            if _block_height(len(layout.lines), design) <= _band_room(design, image_height, spec):
                return layout, design
        except CopyDoesNotFitError:
            pass

    return _fit_copy(copy, image_width, image_height, spec, tokens, preferred, design)


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


def apply_profile(spec: dict, profile: str | None) -> dict:
    """Swap type color and the background gate for one grade. Default is noir."""
    spec = copy.deepcopy(spec)
    name = profile or "noir"
    block = spec.get("color_profiles", {}).get(name)
    if not block:
        raise ValueError(f"Unknown color profile: {name}")
    spec["typography"]["fill_rgb"] = list(block["fill_rgb"])
    spec["typography"]["stroke_rgb"] = list(block["stroke_rgb"])
    qa = dict(spec["background_qa"])
    qa.update({key: value for key, value in block.items() if key not in ("fill_rgb", "stroke_rgb")})
    spec["background_qa"] = qa
    return spec


def check_background(bg_path: str | Path, spec: dict | None = None) -> dict:
    """QA gate for the reserved center band, or the whole frame on the orange grade."""
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
    mode = qa.get("qa_mode", "dark")
    if mode == "light":
        dark = float((band < qa["dark_pixel_value"]).mean())
        if mean < qa["min_mean_luma"]:
            reasons.append(f"mean luma {mean:.3f} < {qa['min_mean_luma']}")
        if dark > qa["max_dark_pixel_fraction"]:
            reasons.append(f"dark pixel fraction {dark:.3%} > {qa['max_dark_pixel_fraction']:.0%}")
    elif mode == "orange":
        rgb = np.asarray(img).astype(np.float32) / 255.0
        red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        orange = (red > 0.65) & (red > green * 1.3) & (red > blue * 1.5)
        fraction = float(orange.mean())
        bright = fraction
        if fraction < qa["min_orange_fraction"]:
            reasons.append(f"orange fraction {fraction:.3%} < {qa['min_orange_fraction']:.0%}")
    else:
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
    layout, sc = layout_for_image(copy, w, h, spec)
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
    mode = qa.get("qa_mode", "dark")
    if mode == "light" and zone_mean < qa.get("min_mean_luma", 0.72):
        warnings.append(f"Background under the text is darker than the white grade "
                        f"(mean luma {zone_mean:.3f} < {qa.get('min_mean_luma', 0.72)}).")
    elif mode == "dark" and zone_mean > qa["max_mean_luma"]:
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


def render_plate(copy: str, width: int, height: int, out_path: str | Path,
                 spec: dict | None = None) -> dict:
    """Draw the same layout on a transparent PNG. The video model never sees this plate."""
    spec = spec or load_spec()
    out = Path(out_path)
    layout, sc = layout_for_image(copy, width, height, spec)
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    n = len(layout.lines)
    block_h = sc.cap_height_px + (n - 1) * sc.line_height_px
    top = height * spec["layout"]["block_center_y_ratio"] - block_h / 2
    baselines = [round(top + sc.cap_height_px + i * sc.line_height_px) for i in range(n)]
    typo = spec["typography"]
    draw = ImageDraw.Draw(img)
    fill = tuple(typo["fill_rgb"]) + (255,)
    stroke = tuple(typo["stroke_rgb"]) + (255,)
    for line, y in zip(layout.lines, baselines):
        draw.text((width / 2, y), line, font=sc.font, anchor="ms",
                  fill=fill, stroke_fill=stroke, stroke_width=sc.stroke_px)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "PNG", compress_level=6)
    return {"output": str(out), "size": [width, height], "lines": layout.lines,
            "warnings": layout.warnings}


def preview_breaks(copy: str, spec: dict | None = None, width: int | None = None) -> LayoutResult:
    """Dry run: the layout a 9:16 frame of this width would draw."""
    spec = spec or load_spec()
    frame_width = width or spec["reference_width_px"]
    frame_height = round(frame_width * 16 / 9)
    layout, _sc = layout_for_image(copy, frame_width, frame_height, spec)
    return layout


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
    r.add_argument("--profile", default="noir")

    b = sub.add_parser("breaks", help="Dry-run line breaks for a piece of copy")
    b.add_argument("--copy", required=True)
    b.add_argument("--width", type=int, default=None)

    c = sub.add_parser("check-bg", help="Dark-band QA gate for a background")
    c.add_argument("--bg", required=True)
    c.add_argument("--profile", default="noir")

    plate = sub.add_parser("plate", help="Transparent text plate at a clip's size")
    plate.add_argument("--copy", required=True)
    plate.add_argument("--width", type=int, required=True)
    plate.add_argument("--height", type=int, required=True)
    plate.add_argument("--out", required=True)
    plate.add_argument("--profile", default="noir")

    m = sub.add_parser("batch", help="Process a manifest of renders")
    m.add_argument("manifest")
    m.add_argument("--report", default=None)
    m.add_argument("--skip-bg-check", action="store_true")

    a = p.parse_args(argv)
    spec = load_spec(a.spec)
    if getattr(a, "profile", None):
        spec = apply_profile(spec, a.profile)

    try:
        if a.cmd == "render":
            res = render_text(a.bg, a.copy.replace("\\n", "\n"), a.out, spec, a.meta)
            print(json.dumps({"output": res.output_path, "size": [res.width, res.height],
                              "lines": res.layout.lines, "warnings": res.warnings}, indent=2))
        elif a.cmd == "breaks":
            lay = preview_breaks(a.copy.replace("\\n", "\n"), spec, a.width)
            print(json.dumps(asdict(lay), indent=2))
        elif a.cmd == "plate":
            res = render_plate(a.copy.replace("\\n", "\n"), a.width, a.height, a.out, spec)
            print(json.dumps(res, indent=2))
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
