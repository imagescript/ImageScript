# python -I mkzero.py out.ttf N : TrueType font, N glyphs (U+E000..) each a full-em square, advance 0 (no third-party data)
import sys
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
out, n = sys.argv[1], int(sys.argv[2])
names = ['.notdef'] + [f'g{i}' for i in range(n)]
fb = FontBuilder(1000, isTTF=True); fb.setupGlyphOrder(names)
fb.setupCharacterMap({0xE000 + i: f'g{i}' for i in range(n)})
def sq(i):
    p = TTGlyphPen(None); d = i % 7
    p.moveTo((d, 0)); p.lineTo((d, 1000)); p.lineTo((1000, 1000)); p.lineTo((1000, d)); p.closePath(); return p.glyph()
glyf = {'.notdef': TTGlyphPen(None).glyph()}; glyf.update({f'g{i}': sq(i) for i in range(n)})
fb.setupGlyf(glyf); fb.setupHorizontalMetrics({k: (0, 0) for k in names})
fb.setupHorizontalHeader(ascent=1000, descent=0)
fb.setupNameTable({'familyName': 'x', 'styleName': 'Regular'}); fb.setupOS2(); fb.setupPost(); fb.save(out)
