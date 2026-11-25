const zlib = require('zlib');
const {Image} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};

// Gray and RGB TIFFs with 8 and 16 unsigned bits per sample, in every layout the decoder converts on a fast path (and
// a few next to it), compared with RGBA computed here from the samples by the TIFF rules: 16-bit samples become their
// high byte, photometric 0 is inverted, associated alpha is undone as round(v * 255 / alpha), unassociated alpha and
// extra samples after it are kept or skipped

// a seeded generator, so a failure repeats
let seed = 12345;
const random = () => (seed = seed * 1103515245 + 12345 >>> 0) / 2 ** 32;

/** Writes a classic TIFF with one IFD; `segments` are the encoded strips or tiles */
function tiff({ little, width, height, bps, samples, photometric, extra, planar, predictor, compression, rowsPerStrip, tile, segments }) {
    const tags = [
        [256, 4, [width]], [257, 4, [height]], [258, 3, new Array(samples).fill(bps)], [259, 3, [compression]],
        [262, 3, [photometric]], [277, 3, [samples]], [284, 3, [planar ? 2 : 1]], [317, 3, [predictor]]
    ];
    if (extra.length) tags.push([338, 3, extra]);
    if (tile) tags.push([322, 4, [tile[0]]], [323, 4, [tile[1]]]);
    else tags.push([278, 4, [rowsPerStrip]]);
    const offsetsTag = tile ? 324 : 273, countsTag = tile ? 325 : 279;
    tags.push([offsetsTag, 4, segments.map(() => 0)], [countsTag, 4, segments.map(s => s.length)]);
    tags.sort((a, b) => a[0] - b[0]);

    const ifd = 8, ifdSize = 2 + tags.length * 12 + 4;
    let extraOffset = ifd + ifdSize;
    const outOfLine = [];
    for (const tag of tags) {
        const size = (tag[1] === 3 ? 2 : 4) * tag[2].length;
        if (size > 4) { tag.push(extraOffset); outOfLine.push(tag); extraOffset += size; }
    }
    let dataOffset = extraOffset;
    const offsets = segments.map(s => (dataOffset += s.length) - s.length);
    tags.find(t => t[0] === offsetsTag)[2] = offsets;

    const out = new Uint8Array(dataOffset);
    const view = new DataView(out.buffer);
    out[0] = out[1] = little ? 0x49 : 0x4d;
    view.setUint16(2, 42, little);
    view.setUint32(4, ifd, little);
    view.setUint16(ifd, tags.length, little);
    const put = (offset, type, values) => values.forEach((v, i) => type === 3 ? view.setUint16(offset + i * 2, v, little) : view.setUint32(offset + i * 4, v, little));
    tags.forEach(([tag, type, values, where], i) => {
        const entry = ifd + 2 + i * 12;
        view.setUint16(entry, tag, little);
        view.setUint16(entry + 2, type, little);
        view.setUint32(entry + 4, values.length, little);
        if (where === undefined) put(entry + 8, type, values);
        else { view.setUint32(entry + 8, where, little); put(where, type, values); }
    });
    segments.forEach((s, i) => out.set(s, offsets[i]));
    return out;
}

/** The samples of rows y0..y1 and columns x0..x1 (a tile may reach past the image: zeros), encoded as stored */
function segment(sample, layout, plane, x0, y0, w, h) {
    const { little, bps, samples, planar, predictor, compression } = layout;
    const perPixel = planar ? 1 : samples, size = bps / 8;
    const rowBytes = w * perPixel * size;
    const out = new Uint8Array(rowBytes * h);
    const view = new DataView(out.buffer);
    for (let y = 0; y < h; y++) {
        const values = [];
        for (let x = 0; x < w; x++)
            for (let s = 0; s < perPixel; s++) values.push(x0 + x < layout.width && y0 + y < layout.height ? sample(x0 + x, y0 + y, planar ? plane : s) : 0);
        // horizontal differencing, modulo the sample size
        if (predictor === 2) for (let i = values.length - 1; i >= perPixel; i--) values[i] = (values[i] - values[i - perPixel]) & (2 ** bps - 1);
        values.forEach((v, i) => size === 1 ? out[y * rowBytes + i] = v : view.setUint16(y * rowBytes + i * 2, v, little));
    }
    return compression === 8 ? zlib.deflateSync(out) : out;
}

function expected(sample, { width, height, bps, samples, photometric, extra }) {
    const color = photometric === 2 ? 3 : 1;
    const alpha = samples > color && (extra[0] === 1 || extra[0] === 2) ? color : -1;
    const eight = v => bps === 16 ? v >> 8 : v;
    const out = new Uint8Array(width * height * 4);
    for (let y = 0, o = 0; y < height; y++)
        for (let x = 0; x < width; x++, o += 4) {
            for (let c = 0; c < 3; c++) {
                const v = eight(sample(x, y, color === 3 ? c : 0));
                out[o + c] = photometric === 0 ? 255 - v : v;
            }
            out[o + 3] = alpha < 0 ? 255 : eight(sample(x, y, alpha));
            if (alpha >= 0 && extra[0] === 1)
                for (let c = 0; c < 3; c++) out[o + c] = out[o + 3] ? Math.min(255, Math.round(out[o + c] * 255 / out[o + 3])) : 0;
        }
    return out;
}

(async () => {
    const {littleEndian, useLittleEndian} = await import('../dist/util/alpha.js');
    let count = 0;

    for (const words of littleEndian ? [true, false] : [false])
        for (const photometric of [0, 1, 2])
            for (const bps of [8, 16])
                for (const extra of [[], [0], [1], [2], [2, 0]])
                    for (const planar of [false, true])
                        for (const tiled of [false, true]) {
                            useLittleEndian(words);
                            const little = random() < 0.5;
                            const width = 1 + (random() * 37 | 0), height = 1 + (random() * 23 | 0);
                            const samples = (photometric === 2 ? 3 : 1) + extra.length;
                            const layout = {
                                little, width, height, bps, samples, photometric, extra, planar,
                                predictor: random() < 0.5 ? 2 : 1, compression: random() < 0.5 ? 8 : 1,
                                rowsPerStrip: 1 + (random() * height | 0), tile: tiled ? [16, 16] : null
                            };

                            // random samples, with whole rows and columns of alpha 0 and 255, and the colors under alpha 0 set
                            const values = new Map();
                            const sample = (x, y, s) => {
                                const key = (y * width + x) * samples + s;
                                if (!values.has(key)) {
                                    let v = random() * 2 ** bps | 0;
                                    const isAlpha = s === samples - extra.length && extra.length && (extra[0] === 1 || extra[0] === 2);
                                    if (isAlpha && x % 5 === 0) v = 0;
                                    if (isAlpha && y % 7 === 0) v = 2 ** bps - 1;
                                    values.set(key, v);
                                }
                                return values.get(key);
                            };

                            const segments = [];
                            for (let plane = 0; plane < (planar ? samples : 1); plane++) {
                                if (tiled) {
                                    for (let ty = 0; ty < height; ty += 16) for (let tx = 0; tx < width; tx += 16) segments.push(segment(sample, layout, plane, tx, ty, 16, 16));
                                } else for (let y = 0; y < height; y += layout.rowsPerStrip) segments.push(segment(sample, layout, plane, 0, y, width, Math.min(layout.rowsPerStrip, height - y)));
                            }

                            const image = await Image.decode(tiff({ ...layout, segments }));
                            const want = expected(sample, layout);
                            const got = new Uint8Array(image.bitmap);
                            const at = got.findIndex((v, i) => v !== want[i]);
                            if (at >= 0) panic(`${JSON.stringify({ ...layout, words })}: byte ${at} is ${got[at]}, expected ${want[at]}`);
                            count++;
                        }

    useLittleEndian(littleEndian);
    if (count < (littleEndian ? 240 : 120)) panic(`only ${count} layouts were checked`);
})();
