const fs = require('fs');
const {Image, LimitError} = require('..');

// bitmap glyphs (sbix, CBDT) are bounded like the rest of a render: their PNGs count before they are decoded (also those
// that turn out damaged), and a glyph scaled from a tiny strike to the font size isn't allocated past the output
// (Bun's JavaScriptCore rasterizes several times slower than V8)
// (under coverage everything takes several times as long: the budgets are reached in time only without it)
const slack = (process.versions.bun ? 4 : 1) * (process.env.NODE_V8_COVERAGE ? 4 : 1);

// a collection before a memory check, so that the rasters a render made aren't counted as kept (Node and Bun; where
// no collector can be had, the memory checks are skipped)
const collect = (() => {
    try {
        if (globalThis.Bun) return () => globalThis.Bun.gc(true);
        if (globalThis.gc) return () => globalThis.gc();
        require('v8').setFlagsFromString('--expose_gc');
        const gc = require('vm').runInNewContext('gc');
        return () => gc();
    } catch {
        return null;
    }
})();

const panic = message => {
    console.error(message);
    process.exit(1);
};
const font = name => fs.readFileSync(`${__dirname}/fonts/bitmap-limits/${name}.ttf`);
const text = n => Array.from({length: n}, (_, i) => String.fromCodePoint(0xe000 + i)).join('');
const NS = 'xmlns="http://www.w3.org/2000/svg"';

(async () => {
    for (const [name, run] of [
        // a strike at ppem 1 of a 2048x2048 PNG, drawn at size 16: a 32768x32768 copy (4 GB) for a 10x10 image
        ['a glyph from a strike at ppem 1', () => Image.renderText('\ue000', {font: font('p1'), size: 16, width: 10, height: 10, maxPixels: 100})],
        // 1000 glyphs of valid 2048x2048 PNGs without advance, in a 32x1 image: 39 s of decoding
        ['1000 large glyphs without advance', () => Image.renderText(text(1000), {font: font('z-ok-1000'), size: 1, maxPixels: 100})],
        // 1000 records of one damaged PNG with different ends: each was decoded, and never counted, as it failed
        ['1000 damaged glyphs in an SVG', () => Image.renderSVG(`<svg ${NS} width="10" height="10"><style>@font-face{font-family:f;src:url(data:font/ttf;base64,${font('sh-bad-1000').toString('base64')})}</style><text y="8" font-family="f" font-size="1">${text(2000)}</text></svg>`, {maxPixels: 100})],
        // 64 glyphs from a strike at ppem 1 in a 10x10 box, at 3 sizes of one font: the scaled glyphs were kept with the
        // font (1 GB a size, never given back)
        ['64 scaled glyphs at 3 sizes', async () => {
            const data = font('a0-p1-64');
            for (const size of [16, 17, 18]) await Image.renderText(text(64), {font: data, size, width: 10, height: 10, maxPixels: 100}).catch(err => {
                if (!(err instanceof LimitError)) throw err;
            });
        }],
        // the rasters of outline glyphs at a huge size were kept with the font: 62 letters at size 6000 in a 10x10 box
        // kept 774 MB (24 of them over 280 MB), a size more ran out of memory
        ['24 huge letters', async () => {
            const data = fs.readFileSync(`${__dirname}/fonts/opensans bold.ttf`);
            for (const size of [6000]) for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWX') await Image.renderText(c, {font: data, size, width: 10, height: 10, maxPixels: 100});
        }],
        // color glyphs (COLR) were kept for every text color: a new color each render grew without end
        ['color glyphs in 200 colors', async () => {
            const data = fs.readFileSync(`${__dirname}/fonts/noto colrv1 subset.ttf`);
            for (let i = 0; i < 200; i++) await Image.renderText('\u{1F600}', {font: data, size: 500, width: 10, height: 10, maxPixels: 100, color: ((i * 0x01020300 + 0x10000000) | 0xff) >>> 0});
        }],
        // glyphs too large to keep, over each other (no advance) 1000 times at size 8000: drawn again each time, 260 s
        ['2000 huge glyphs without advance', () => Image.renderText(text(2).repeat(1000), {font: font('zero'), size: 8000, width: 10, height: 10, maxPixels: 100})],
    ].filter(([name]) => !process.env.NODE_V8_COVERAGE || !/huge|colors/.test(name))) {
        // (not under coverage: the huge cases take most of what a test may take there)
        collect?.();
        const begin = Date.now(), before = process.memoryUsage().arrayBuffers;
        const result = await run().then(() => 'ok', err => err);
        if (result !== 'ok' && !(result instanceof LimitError)) panic(`${name}: ${result}`);
        if (Date.now() - begin > 20000 * slack) panic(`${name}: took ${Date.now() - begin} ms`);
        globalThis.gc?.();
        collect?.();
        // (the rasters of a render that weren't kept are freed later, not on the collection: that case's check is its time)
        if (collect && !name.startsWith('2000 huge') && process.memoryUsage().arrayBuffers - before > 128 * 2 ** 20) panic(`${name}: kept ${(process.memoryUsage().arrayBuffers - before) >> 20} MB`);
    }
})();
