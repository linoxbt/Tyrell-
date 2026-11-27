"""Generate Tyrell's brand SVGs: the two-key T mark, glyphs, wordmark and lockups."""
import json, os, sys

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
W = json.load(open(os.path.join(os.path.dirname(__file__), "word.json")))

# ---- the mark: a T made of two halves that only make a whole when they meet ----
SQ = "M18.2 0H45.8C58.5 0 64 5.5 64 18.2V45.8C64 58.5 58.5 64 45.8 64H18.2C5.5 64 0 58.5 0 45.8V18.2C0 5.5 5.5 0 18.2 0Z"
GAP = 2.0
def left(g=GAP):
    x = 32 - g / 2
    return f"M18 13H{x:g}V52A5 5 0 0 1 {x-5:g} 47V28A3 3 0 0 0 {x-8:g} 25H18A6 6 0 0 1 18 13Z"
def right(g=GAP):
    x = 32 + g / 2
    return f"M46 13H{x:g}V52A5 5 0 0 0 {x+5:g} 47V28A3 3 0 0 1 {x+8:g} 25H46A6 6 0 0 0 46 13Z"
FIT = 'transform="translate(32 32.5) scale(.94) translate(-32 -32.5)"'

def defs(p, fold=("#E6DEFF", "#B5A1FF")):
    return f'''<defs>
  <linearGradient id="{p}bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop stop-color="#8F72FF"/><stop offset="1" stop-color="#6A48F0"/></linearGradient>
  <linearGradient id="{p}sheen" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse"><stop stop-color="#fff" stop-opacity=".2"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <linearGradient id="{p}fold" x1="33" y1="13" x2="52" y2="52" gradientUnits="userSpaceOnUse"><stop stop-color="{fold[0]}"/><stop offset="1" stop-color="{fold[1]}"/></linearGradient>
</defs>'''

def mark_body(p="m"):
    return f'''{defs(p)}
<path d="{SQ}" fill="url(#{p}bg)"/>
<path d="{SQ}" fill="url(#{p}sheen)"/>
<g {FIT}><path d="{left()}" fill="#fff"/><path d="{right()}" fill="url(#{p}fold)"/></g>'''

def glyph_body(p, a, fold, mono=False):
    if mono:
        return f'<g fill="{a}"><path d="{left(2.6)}"/><path d="{right(2.6)}"/></g>'
    return f'{defs(p, fold)}<path d="{left()}" fill="{a}"/><path d="{right()}" fill="url(#{p}fold)"/>'

def svg(vb, body, w=None, h=None, title="Tyrell"):
    size = f' width="{w}" height="{h}"' if w else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}"{size} role="img" aria-label="{title}"><title>{title}</title>{body}</svg>\n'

# ---- wordmark: Geist SemiBold outlines, tracked -0.045em, "Ty" kerned optically ----
KERN = {1: -28}  # shift from glyph index onward (Ty pair)
def word_body(color, ox=0, oy=0, scale=1.0):
    parts, shift = [], 0
    for i, p in enumerate(W["paths"]):
        shift += KERN.get(i, 0)
        parts.append(f'<path transform="translate({shift - 11:g} 0)" d="{p["d"]}"/>')
    return f'<g fill="{color}" transform="translate({ox:g} {oy:g}) scale({scale:g})">{"".join(parts)}</g>'
WORD_W = W["bounds"][2] - 11 + sum(KERN.values())   # ink width in font units
CAP, DESC = W["cap"], W["bounds"][3]                # 710, 860 (y descender)

files = {}
files["tyrell-mark.svg"] = svg("0 0 64 64", mark_body())
files["tyrell-glyph.svg"] = svg("12 13 40 39", glyph_body("g", "#7C5CFF", ("#C9BCFF", "#9B83FF")))
files["tyrell-glyph-dark.svg"] = svg("12 13 40 39", glyph_body("d", "#F3F5FA", ("#CFC3FF", "#9C86FF")))
files["tyrell-glyph-mono.svg"] = svg("12 13 40 39", glyph_body("", "#0F1220", None, mono=True))
files["tyrell-wordmark.svg"] = svg(f"0 0 {WORD_W:g} {DESC:g}", word_body("#0F1220"))

# lockup: mark height = 1.62 x cap height, gap = 0.36 x mark, baseline aligned to the mark's optical centre
def lockup(color, p):
    s = 1000 / 64 * 0.0  # unused
    mark_h = CAP * 1.62
    k = mark_h / 64
    gap = mark_h * 0.36
    ty = (mark_h - CAP) / 2
    body = f'<g transform="scale({k:g})">{mark_body(p)}</g>' + word_body(color, ox=mark_h + gap, oy=ty)
    w = mark_h + gap + WORD_W
    h = max(mark_h, ty + DESC)
    return svg(f"0 0 {w:g} {h:g}", body)
files["tyrell-lockup.svg"] = lockup("#0F1220", "l")
files["tyrell-lockup-dark.svg"] = lockup("#F3F5FA", "k")

for name, text in files.items():
    open(os.path.join(OUT, name), "w").write(text)
json.dump({"SQ": SQ, "left": left(), "right": right(), "leftMono": left(2.6), "rightMono": right(2.6), "word": [{"x": sum(v for k, v in KERN.items() if k <= i) - 11, "d": p["d"]} for i, p in enumerate(W["paths"])], "wordW": WORD_W, "cap": CAP, "desc": DESC}, open(os.path.join(OUT, "_geometry.json"), "w"))
print("wrote", list(files))
