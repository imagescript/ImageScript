const {Image} = require('..');

// SVGs against denial of service, part 3 (split from svg-dos-paint.js for the time a test may take): markers and the
// pixels shapes and layers paint; small documents that must render (or throw) quickly
const NS = 'xmlns="http://www.w3.org/2000/svg"';

const panic = message => {
    console.error(message);
    process.exit(1);
};

// (Bun's JavaScriptCore runs the rasterizer several times slower than V8: 12 s where Node takes 2 s)
const slack = process.versions.bun ? 4 : 1;

(async () => {
    // (not under coverage: reaching the budgets takes most of what a test may take there)
    if (!process.env.NODE_V8_COVERAGE) {
        let error = null;
        // markers are limited like the elements of <use> references: 120000 marker-mid instances took 135 s
        {
            const points = Array.from({length: 120000}, (_, i) => `${i % 1000} ${i / 1000 | 0}`).join(' L');
            const markers = `<svg ${NS} width="1000" height="200"><marker id="m" markerWidth="8" markerHeight="8"><circle cx="4" cy="4" r="3"/></marker><path d="M${points}" stroke="black" marker-mid="url(#m)"/></svg>`;
            const begin = Date.now();
            error = null;
            try { await Image.renderSVG(markers); } catch (err) { error = err; }
            if (!error || error.name !== 'LimitError' || !/markers/.test(error.message) || Date.now() - begin > 30000 * slack) panic(`120000 markers: expected the marker limit within 30 s, got ${error} after ${Date.now() - begin} ms`);
        }
        // what counts is what is painted, not the bounding boxes of the shapes: a chart of 1000 thin lines across the
        // image renders (each line's box is the whole image)
        {
            let lines = '';
            for (let i = 0; i < 1000; i++) lines += `<path d="M0 ${i} L1000 ${(i * 37) % 1000}" stroke="#08f" stroke-width="0.5"/>`;
            const begin = Date.now();
            const chart = await Image.renderSVG(`<svg ${NS} width="1000" height="1000">${lines}</svg>`).catch(err => err);
            if (!(chart instanceof Image) || Date.now() - begin > 60000 * slack) panic(`a chart of 1000 lines: ${chart} after ${Date.now() - begin} ms, it should render`);
        }
        // the pixels shapes and layers fill are bounded like the filters' work: 1000 <use> copies of a full-canvas group
        // with opacity (16 KB) took 260 s at 4000x4000, 9999 markers of a 400x400 group 36 s
        for (const [name, svg] of [
            ['<use> copies', `<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" width="2000" height="2000"><defs><g id="g" opacity="0.5"><rect width="2000" height="2000" fill="red"/></g></defs>${'<use href="#g"/>'.repeat(1000)}</svg>`],
            ['markers', `<svg ${NS} width="1000" height="1000"><marker id="m" markerWidth="400" markerHeight="400" markerUnits="userSpaceOnUse"><g opacity="0.5"><rect width="400" height="400"/></g></marker><path d="M0 0${' L500 500 L0 0'.repeat(4999)}" marker-mid="url(#m)"/></svg>`]
        ]) {
            const begin = Date.now();
            error = null;
            try { await Image.renderSVG(svg); } catch (err) { error = err; }
            if (!error || error.name !== 'LimitError' || Date.now() - begin > 30000 * slack) panic(`${name}: expected a LimitError within 30 s, got ${error} after ${Date.now() - begin} ms`);
        }
    }
})();
