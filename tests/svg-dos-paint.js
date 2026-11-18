const {Image} = require('..');

// SVGs against denial of service, part 2 (split from svg-dos.js for the time a test may take): filters, the pixels
// shapes and layers paint, markers; small documents that must render (or throw) quickly
const NS = 'xmlns="http://www.w3.org/2000/svg"';

const panic = message => {
    console.error(message);
    process.exit(1);
};

// (Bun's JavaScriptCore runs the rasterizer several times slower than V8: 12 s where Node takes 2 s)
const slack = process.versions.bun ? 4 : 1;

(async () => {
    // a filter of hundreds of primitives over a large region: a LimitError (the work is bounded) instead of minutes of
    // work, and the results it keeps for `result=` references count against maxLayerPixels (600 such pairs over a
    // megapixel took more than 3 GB, also with a lower maxLayerPixels)
    // (not under coverage: reaching the budget takes most of what a test may take there)
    if (!process.env.NODE_V8_COVERAGE) {
        const chain = n => `<svg ${NS} width="1000" height="1000"><filter id="f">${'<feGaussianBlur stdDeviation="3"/><feMorphology radius="50"/>'.repeat(n)}</filter><rect width="1000" height="1000" filter="url(#f)"/></svg>`;
        const start = Date.now();
        let error = null;
        try { await Image.renderSVG(chain(600)); } catch (err) { error = err; }
        const time = Date.now() - start;
        if (!error || error.name !== 'LimitError') panic(`filter chain: expected a LimitError, got ${error} after ${time} ms`);
        if (time > 30000 * slack) panic(`filter chain: took ${time} ms`);
        error = null;
        try { await Image.renderSVG(chain(8), {maxLayerPixels: 4e6}); } catch (err) { error = err; }
        if (!error || error.name !== 'LimitError') panic(`filter chain within maxLayerPixels: expected a LimitError, got ${error}`);
        // one primitive that costs far more than its pixels: a convolution of order 200 took 341 s over a megapixel (80 KB
        // of SVG); it is charged for its kernel's taps
        const convolve = `<svg ${NS} width="1000" height="1000"><filter id="f"><feConvolveMatrix order="200" kernelMatrix="${'1 '.repeat(200 * 200)}"/></filter><rect width="1000" height="1000" filter="url(#f)"/></svg>`;
        const convolveStart = Date.now();
        error = null;
        try { await Image.renderSVG(convolve); } catch (err) { error = err; }
        if (!error || error.name !== 'LimitError' || Date.now() - convolveStart > 15000 * slack) panic(`a convolution of order 200: expected a LimitError within 15 s, got ${error} after ${Date.now() - convolveStart} ms`);
        // the work allowed scales with the size of the render: a drop shadow on a 4096x4096 image (rendered by rc.5) stays within it
        {
            const big = await Image.renderSVG(`<svg ${NS} width="4096" height="4096"><filter id="s" x="-10%" y="-10%" width="130%" height="130%"><feGaussianBlur in="SourceAlpha" stdDeviation="8"/><feOffset dx="10" dy="10" result="b"/><feFlood flood-color="#0004"/><feComposite in2="b" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter><rect x="100" y="100" width="3800" height="3800" fill="red" filter="url(#s)"/></svg>`);
            if (big.getPixelAt(2000, 2000) !== 0xff0000ff) panic('a drop shadow on a 4096x4096 image should render');
        }
        // primitives that cost more than one pass over their pixels are charged for it: turbulence per octave (83 of 24
        // octaves, 5.7 KB, took 238 s), a merge per node (5000 nodes took 107 s)
        for (const [name, filter] of [
            ['turbulence', '<feTurbulence baseFrequency="0.01" numOctaves="24"/>'.repeat(83)],
            ['merge', `<feMerge>${'<feMergeNode in="SourceGraphic"/>'.repeat(5000)}</feMerge>`]
        ]) {
            const begin = Date.now();
            error = null;
            try { await Image.renderSVG(`<svg ${NS} width="1000" height="1000"><filter id="f">${filter}</filter><rect width="1000" height="1000" filter="url(#f)"/></svg>`); } catch (err) { error = err; }
            if (!error || error.name !== 'LimitError' || Date.now() - begin > 15000 * slack) panic(`${name}: expected a LimitError within 15 s, got ${error} after ${Date.now() - begin} ms`);
        }
        // a filter region is a layer like the others: over maxLayerPixels it's a LimitError, not a silently missing
        // element, and the limit is what the option says (a fixed 2^26 pixels refused a filter on the whole of 6900x6900)
        error = null;
        try { await Image.renderSVG(`<svg ${NS} width="3000" height="3000"><filter id="f"><feFlood flood-color="blue"/></filter><rect width="3000" height="3000" fill="red" filter="url(#f)"/></svg>`, {maxLayerPixels: 9.5e6}); } catch (err) { error = err; }
        if (!error || error.name !== 'LimitError' || !/maxLayerPixels/.test(error.message)) panic(`a filter region over maxLayerPixels: expected a LimitError naming it, got ${error}`);
        // a declared size no integer can hold is a LimitError like the other sizes past maxPixels
        error = null;
        try { await Image.renderSVG(`<svg ${NS} width="1e17" height="10"/>`); } catch (err) { error = err; }
        if (!error || error.name !== 'LimitError') panic(`a declared width of 1e17: expected a LimitError, got ${error}`);
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
        // a real filter on a large image still renders
        const shadow = await Image.renderSVG(`<svg ${NS} width="2000" height="2000"><filter id="s"><feGaussianBlur in="SourceAlpha" stdDeviation="8"/><feOffset dx="10" dy="10" result="b"/><feFlood flood-color="#0004"/><feComposite in2="b" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter><rect x="100" y="100" width="1700" height="1700" fill="red" filter="url(#s)"/></svg>`);
        if (shadow.width !== 2000) panic('a drop shadow on a large image should render');
    }
})();
