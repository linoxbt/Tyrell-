"""Outline the Tyrell wordmark from Geist SemiBold (SIL OFL) into SVG path data, plus brand SVG files."""
import json, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

font_path, out = sys.argv[1], sys.argv[2]
f = TTFont(font_path)
gs = f.getGlyphSet()
cmap = f.getBestCmap()
upm = f["head"].unitsPerEm
cap = f["OS/2"].sCapHeight
kern = {}

TEXT = "Tyrell"
TRACK = -0.045 * upm  # letter-spacing, as on the site

# GPOS kerning: skip (Geist uses class kerning; tracking does the work at this weight); measure advances
x = 0
paths = []
for i, ch in enumerate(TEXT):
    g = cmap[ord(ch)]
    pen = SVGPathPen(gs)
    # flip y so cap height sits at y=0..cap
    tp = TransformPen(pen, (1, 0, 0, -1, x, cap))
    gs[g].draw(tp)
    paths.append({"ch": ch, "d": pen.getCommands(), "x": x, "adv": gs[g].width})
    x += gs[g].width + (TRACK if i < len(TEXT) - 1 else 0)

bp = BoundsPen(gs)
minx = 10**9; maxx = -10**9; miny = 10**9; maxy = -10**9
xx = 0
for i, ch in enumerate(TEXT):
    g = cmap[ord(ch)]
    b = BoundsPen(gs)
    gs[g].draw(TransformPen(b, (1, 0, 0, -1, xx, cap)))
    if b.bounds:
        minx = min(minx, b.bounds[0]); miny = min(miny, b.bounds[1]); maxx = max(maxx, b.bounds[2]); maxy = max(maxy, b.bounds[3])
    xx += gs[g].width + (TRACK if i < len(TEXT) - 1 else 0)

json.dump({"upm": upm, "cap": cap, "paths": paths, "bounds": [minx, miny, maxx, maxy]}, open(out, "w"))
print(upm, cap, [minx, miny, maxx, maxy])
