# python mksbix3.py out.ttf N SIZE MODE PPEM ADV: sbix font, U+E000+i -> distinct SIZExSIZE PNGs in one strike at PPEM, advance ADV units (of 1000)
import sys, struct, zlib
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import newTable
from fontTools.ttLib.tables.sbixStrike import Strike
from fontTools.ttLib.tables.sbixGlyph import Glyph as SbixGlyph
out, n, size, mode = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]; PPEM = int(sys.argv[5]) if len(sys.argv) > 5 else 64
def chunk(k, d): return struct.pack('>I', len(d)) + k + d + struct.pack('>I', zlib.crc32(k + d))
def png(i):
    c = zlib.compressobj(9); parts = []
    row = b'\0' + bytes([i & 255, i >> 8 & 255, 0, 255]) * size
    for y in range(size):
        r = row if not (mode == 'badfilter' and y == size - 1) else b'\5' + row[1:]
        if mode == 'trunc' and y == size - 1: break
        parts.append(c.compress(r))
    parts.append(c.flush())
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', b''.join(parts)) + chunk(b'IEND', b'')
ADV = int(sys.argv[6]) if len(sys.argv) > 6 else 1000
names = ['.notdef'] + [f'g{i}' for i in range(n)]
fb = FontBuilder(1000, isTTF=True); fb.setupGlyphOrder(names)
fb.setupCharacterMap({0xE000 + i: f'g{i}' for i in range(n)})
fb.setupGlyf({k: TTGlyphPen(None).glyph() for k in names})
fb.setupHorizontalMetrics({k: (ADV, 0) for k in names})
fb.setupHorizontalHeader(ascent=900, descent=-100)
fb.setupNameTable({'familyName': 'x', 'styleName': 'Regular'}); fb.setupOS2(); fb.setupPost()
st = Strike(ppem=PPEM, resolution=72)
for i in range(n): st.glyphs[f'g{i}'] = SbixGlyph(glyphName=f'g{i}', graphicType='png ', originOffsetX=0, originOffsetY=0, imageData=png(i))
sb = newTable('sbix'); sb.version = 1; sb.flags = 1; sb.strikes = {64: st}; fb.font['sbix'] = sb
fb.save(out)
