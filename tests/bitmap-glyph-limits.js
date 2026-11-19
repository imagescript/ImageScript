const fs = require('fs');
const {Image, LimitError} = require('..');

// bitmap glyphs (sbix, CBDT) are bounded like the rest of a render: their PNGs count before they are decoded (also those
// that turn out damaged), and a glyph scaled from a tiny strike to the font size isn't allocated past the output
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
    ]) {
        const begin = Date.now(), before = process.memoryUsage().rss;
        const result = await run().then(() => 'ok', err => err);
        if (result !== 'ok' && !(result instanceof LimitError)) panic(`${name}: ${result}`);
        if (Date.now() - begin > 10000) panic(`${name}: took ${Date.now() - begin} ms`);
        if (process.memoryUsage().rss - before > 768 * 2 ** 20) panic(`${name}: took ${(process.memoryUsage().rss - before) >> 20} MB`);
    }
})();
