# python mkshared.py out.ttf M SIZE MODE: sbix font with 2M+1 glyphs; glyph 2k (U+E000+k) = the SAME PNG bytes at one
# start offset, with end = start+len+k (distinct (offset,length) cache keys); odd glyphs are fillers (end<start -> null)
import sys, struct, zlib
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib.tables.DefaultTable import DefaultTable
out, M, size, mode = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
def chunk(k, d): return struct.pack('>I', len(d)) + k + d + struct.pack('>I', zlib.crc32(k + d))
c = zlib.compressobj(9); row = b'\0' + b'\xff\x00\x00\xff' * size; parts = []
for y in range(size): parts.append(c.compress(b'\5' + row[1:] if mode == 'badfilter' and y == size - 1 else row))
parts.append(c.flush())
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', b''.join(parts)) + chunk(b'IEND', b'')
n = 2 * M + 2  # .notdef + 2M+1 glyphs
names = ['.notdef'] + [f'g{i}' for i in range(n - 1)]
fb = FontBuilder(1000, isTTF=True); fb.setupGlyphOrder(names)
fb.setupCharacterMap({0xE000 + k: f'g{2 * k}' for k in range(M)})
fb.setupGlyf({k: TTGlyphPen(None).glyph() for k in names})
fb.setupHorizontalMetrics({k: (1000, 0) for k in names})
fb.setupHorizontalHeader(ascent=900, descent=-100)
fb.setupNameTable({'familyName': 'x', 'styleName': 'Regular'}); fb.setupOS2(); fb.setupPost()
hdr = 4 + 4 * (n + 1); S = hdr; L = 8 + len(png)
offs = []
for gid in range(n + 1):
    if gid == 0: offs.append(S + L + M + 10)  # .notdef: start beyond, end S -> null
    elif (gid - 1) % 2 == 0: offs.append(S)          # glyph g{2k}: start S
    else: offs.append(S + L + (gid - 2) // 2)        # end of g{2k} = S+L+k
strike = struct.pack('>HH', 64, 72) + b''.join(struct.pack('>I', o) for o in offs) + struct.pack('>hh4s', 0, 0, b'png ') + png + b'\0' * (M + 16)
t = DefaultTable('sbix'); t.data = struct.pack('>HHII', 1, 1, 1, 12) + strike
fb.font['sbix'] = t; fb.save(out); print('png', len(png), 'font', len(open(out, 'rb').read()))
