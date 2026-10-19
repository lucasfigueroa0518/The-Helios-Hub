"""Convert a Hershey Text SVG font into the kit's handwrite() glyph module (EX3-61, EX3-81).

  python3 -I convert_hershey.py HersheySans1.svg ../../../world-kit/hershey-sans.js

Strokes are split at sharp corners: a stroke that turns back on itself cancels its own filled
ink outline (perfect-freehand), which loses stems and crossbars ("t", "a", "k").
"""
import re, sys, json, html

src, out = sys.argv[1], sys.argv[2]
svg = open(src, encoding='utf-8').read()


def split(pts):
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    if max(xs) - min(xs) < 90 and max(ys) - min(ys) < 90:
        return [pts]  # a dot (":", "i", "."): kept whole so it inks as one round mark
    parts, cur = [], [pts[0]]
    for i in range(1, len(pts)):
        cur.append(pts[i])
        if i < len(pts) - 1:
            ax, ay = pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]
            bx, by = pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]
            na, nb = (ax * ax + ay * ay) ** 0.5, (bx * bx + by * by) ** 0.5
            if na > 0 and nb > 0 and (ax * bx + ay * by) / (na * nb) < 0.2:
                if len(cur) > 1:
                    parts.append(cur)
                cur = [pts[i]]
    if len(cur) > 1:
        parts.append(cur)
    return parts


glyphs = {}
default_adv = float(re.search(r'<font[^>]*horiz-adv-x="([^"]+)"', svg).group(1))
for m in re.finditer(r'<glyph\s+([^>]*?)/?>', svg):
    attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', m.group(1)))
    u = html.unescape(attrs.get('unicode', ''))
    if len(u) != 1 or not (32 <= ord(u) < 127):
        continue
    strokes = []
    for seg in re.findall(r'M[^M]*', attrs.get('d', '')):
        nums = [float(x) for x in re.findall(r'-?\d+(?:\.\d+)?', seg)]
        pts = [[round(nums[i], 1), round(nums[i + 1], 1)] for i in range(0, len(nums) - 1, 2)]
        if len(pts) == 1:
            pts = [pts[0], [pts[0][0] + 0.5, pts[0][1]]]  # a dot (":", "i", ".") as a tiny stroke
        if len(pts) > 1:
            strokes.extend(split(pts))
    glyphs[u] = {'a': float(attrs.get('horiz-adv-x', default_adv)), 's': strokes}

hs = [p[1] for s in glyphs['H']['s'] for p in s]
cap = round(max(hs), 1)
notice = """// Hershey Sans 1-stroke glyphs for the kit's handwrite() (EX3-81, Lucas's pick of 2026-10-13: plain
// print handwriting, not cursive). Generated from HersheySans1.svg (hersheytext 2.0.0, MIT,
// github.com/techninja/hersheytextjs) by explainers/design/fonts/hershey/convert_hershey.py; do
// not edit by hand. Coordinates are font units, y up, baseline 0. Strokes are split at sharp
// corners so a retraced stroke never cancels its own ink.
//
// The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the
// U. S. National Bureau of Standards (public domain).
// The format of the Font data in this distribution was originally created by
//     James Hurt, Cognition, Inc., 900 Technology Park Drive, Billerica, MA 01821
//     (mit-eddie!ci-dandelion!hurt)
// SVG conversion: Windell H. Oskay, www.evilmadscientist.com (Hershey Text, 2011/2019).
"""
with open(out, 'w', encoding='utf-8') as f:
    f.write(notice)
    f.write(f'\n/** Cap height of the font, in font units. */\nexport const HERSHEY_CAP = {cap};\n\n')
    f.write('/** char → { a: advance, s: strokes, each a list of [x, y] points }. */\nexport const HERSHEY_SANS = ')
    f.write(json.dumps(glyphs, separators=(',', ':')))
    f.write(';\n')
print(len(glyphs), 'glyphs, cap', cap)
