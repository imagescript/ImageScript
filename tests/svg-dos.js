const {Image, Colors} = require('..');

// SVGs against denial of service: small documents that must render (or throw) quickly
const NS = 'xmlns="http://www.w3.org/2000/svg"';

const panic = message => {
    console.error(message);
    process.exit(1);
};

const timed = async (name, svg, limit = 5000) => {
    const start = Date.now();
    let error = null, image = null;
    try { image = await Image.renderSVG(svg, {width: 100}); } catch (err) { error = err; }
    const time = Date.now() - start;
    if (process.env.SVG_DOS_TIMES) console.log(name, time);
    if (time > limit) panic(`${name}: took ${time} ms`);
    return {image, error, time};
};

(async () => {
    // shapes whose edges cross every row of the image tens of thousands of times: a LimitError (the work is bounded), and
    // quickly (thousands of huge overlapping strokes took 38 s from 51 KB of SVG)
    // (not under coverage: reaching the budget takes 20 seconds there, which is most of what a test may take)
    if (!process.env.NODE_V8_COVERAGE) {
        let d = '';
        for (let i = 0; i < 16000; i++) d += `M${(i % 7) / 10} 0h1v300h-1z`;
        const {error, time} = await timed('edges crossing every row', `<svg ${NS} width="1" height="300"><path d="${d}"/></svg>`, 10000);
        if (!error || error.name !== 'LimitError') panic(`edges crossing every row: expected a LimitError, got ${error} after ${time} ms`);
    }

    // many shapes starting in different rows, most of them beside the canvas: activating the edges of a row shifted
    // half of the active ones for each (80000 triangles took 8.7 s)
    {
        let d = '';
        for (let i = 0; i < 80000; i++) d += `M${(i * 7919) % 100000} ${(i * 7) % 30} l4 0 l-2 ${30 + i % 10} z`;
        const {error} = await timed('80000 triangles', `<svg ${NS} width="100" height="100"><path d="${d}"/></svg>`);
        if (error) panic(`80000 triangles: ${error.message}`);
    }

    // edges far above the canvas: their sub-scanline range wrapped in an Int32Array and ran two billion iterations
    for (const [name, shape] of [
        ['circle r=1e9', '<circle r="1e9"/>'],
        ['scale(1e9)', '<circle r="10" transform="scale(1e9)"/>'],
        ['arc', '<path d="M0 0 A 1e9 1e9 0 1 1 50 50"/>']
    ]) {
        const {error} = await timed(name, `<svg ${NS} width="100" height="100">${shape}</svg>`);
        if (error) panic(`${name}: ${error.message}`);
    }
    {
        // the visible part of a huge circle is still painted
        const {image} = await timed('huge circle', `<svg ${NS} width="100" height="100"><circle cx="50" cy="50" r="1e9" fill="#0f0"/></svg>`);
        if (Colors.toRGBA(image.getPixelAt(50, 50)).join() !== '0,255,0,255') panic('huge circle: not painted');
    }

    // feTurbulence: the cost is linear in numOctaves, which has no limit in the format; octaves past the 24th add nothing
    {
        const turbulence = octaves => `<svg ${NS} width="100" height="100"><filter id="f"><feTurbulence baseFrequency="0.01" numOctaves="${octaves}"/></filter><rect width="100" height="100" filter="url(#f)"/></svg>`;
        const {image: reference, error} = await timed('numOctaves 24', turbulence(24));
        if (error) panic(`numOctaves 24: ${error.message}`);
        for (const octaves of [25, 1000, 1e9]) {
            const {image, error} = await timed(`numOctaves ${octaves}`, turbulence(octaves), 3000);
            if (error) panic(`numOctaves ${octaves}: ${error.message}`);
            if (Buffer.compare(Buffer.from(image.bitmap), Buffer.from(reference.bitmap))) panic(`numOctaves ${octaves}: differs from 24`);
        }
    }

    // masks, clip paths, patterns, markers and filter images that reference each other, three per level: the renders
    // multiplied without a limit (minutes at ten levels, from two kilobytes)
    {
        const three = text => text.repeat(3);
        const vectors = {
            masks: n => {
                let defs = '<mask id="m0"><rect width="100" height="100" fill="#fff"/></mask>';
                for (let i = 1; i <= n; i++) defs += `<mask id="m${i}">${three(`<rect width="100" height="100" fill="#fff" mask="url(#m${i - 1})"/>`)}</mask>`;
                return `<defs>${defs}</defs><rect width="100" height="100" mask="url(#m${n})"/>`;
            },
            'clip paths': n => {
                let defs = '<clipPath id="c0"><rect width="100" height="100"/></clipPath>';
                for (let i = 1; i <= n; i++) defs += `<clipPath id="c${i}">${three(`<rect width="100" height="100" clip-path="url(#c${i - 1})"/>`)}</clipPath>`;
                return `<defs>${defs}</defs><rect width="100" height="100" clip-path="url(#c${n})"/>`;
            },
            markers: n => {
                let defs = '<marker id="k0" markerWidth="4" markerHeight="4"><rect width="4" height="4"/></marker>';
                for (let i = 1; i <= n; i++) defs += `<marker id="k${i}" markerWidth="4" markerHeight="4">${three(`<path d="M0 0 L2 2" marker-start="url(#k${i - 1})"/>`)}</marker>`;
                return `<defs>${defs}</defs><path d="M10 10 L50 50" marker-start="url(#k${n})"/>`;
            },
            'filter images': n => {
                let defs = '<g id="g0"><rect width="10" height="10"/></g>';
                for (let i = 1; i <= n; i++) defs += `<filter id="f${i}" x="0" y="0" width="100" height="100" filterUnits="userSpaceOnUse"><feImage href="#g${i - 1}"/></filter><g id="g${i}">${three(`<rect width="100" height="100" filter="url(#f${i})"/>`)}</g>`;
                return `<defs>${defs}</defs><use href="#g${n}"/>`;
            },
            patterns: n => {
                let defs = '<pattern id="p0" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="5" height="5"/></pattern>';
                for (let i = 1; i <= n; i++) defs += `<pattern id="p${i}" width="10" height="10" patternUnits="userSpaceOnUse">${three(`<rect width="10" height="10" fill="url(#p${i - 1})"/>`)}</pattern>`;
                return `<defs>${defs}</defs><rect width="100" height="100" fill="url(#p${n})"/>`;
            }
        };
        {
            // (an ordinary document at 1080p: a mask of 24 masked shapes, each mask rendered inside the outer one)
            const shapes = Array.from({length: 24}, (_, i) => `<rect x="${i * 80}" width="70" height="1080" fill="#fff" mask="url(#m)"/>`).join('');
            const svg = `<svg ${NS} width="1920" height="1080"><mask id="m"><rect width="1920" height="1080" fill="#fff"/></mask><mask id="outer">${shapes}</mask><rect width="1920" height="1080" fill="#f00" mask="url(#outer)"/></svg>`;
            const start = Date.now();
            const image = await Image.renderSVG(svg);
            if (Colors.toRGBA(image.getPixelAt(10, 10)).join() !== '255,0,0,255') panic('masked shapes inside a masked group: not rendered');
            if (process.env.SVG_DOS_TIMES) console.log('1080p masks', Date.now() - start);
        }
        for (const [name, vector] of Object.entries(vectors)) {
            // (a few levels are an ordinary document)
            const ordinary = await timed(`${name}, 3 levels`, `<svg ${NS} width="100" height="100">${vector(3)}</svg>`);
            if (ordinary.error) panic(`${name}, 3 levels: ${ordinary.error.message}`);
            const {error} = await timed(`${name}, 14 levels`, `<svg ${NS} width="100" height="100">${vector(14)}</svg>`, 30000);
            if (!(error instanceof Error)) panic(`${name}, 14 levels: should throw (${error})`);
        }
    }

    // transform lists with many unclosed functions parsed in quadratic time (5 s at 280 KB)
    {
        const {error, time, image} = await timed('transform', `<svg ${NS} width="100" height="100"><rect width="10" height="10" transform="${'rotate('.repeat(100000)}"/></svg>`, 1000);
        if (error) panic(`transform: ${error.message} after ${time} ms`);
        // (and a function after the unclosed ones still applies)
        const moved = await Image.renderSVG(`<svg ${NS} width="20" height="20"><rect width="10" height="10" transform="rotate(rotate(translate(10 0)"/></svg>`);
        if (Colors.toRGBA(moved.getPixelAt(15, 5))[3] !== 255 || Colors.toRGBA(moved.getPixelAt(5, 5))[3] !== 0) panic('transform: the closed function should apply');
    }

    // half a million dashes or more render in a 64 MB heap: the ones beside the image are left out, the others are
    // stroked a batch at a time (a 157 byte SVG took 650 MB, and failed in a 256 MB heap)
    {
        let zigzag = 'M0 0';
        for (let i = 1; i <= 200; i++) zigzag += ` L${i % 2 ? 500 : 0} ${i * 2.5}`;
        const script = `
            const {Image} = require(${JSON.stringify(require.resolve('..'))});
            const NS = 'xmlns="http://www.w3.org/2000/svg"';
            (async () => {
                const beside = await Image.renderSVG(\`<svg \${NS} width="100" height="10"><path d="M0 5 L100000 5" stroke="black" stroke-dasharray="0.1"/></svg>\`);
                const across = await Image.renderSVG(\`<svg \${NS} width="500" height="500"><path d="${zigzag}" fill="none" stroke="black" stroke-dasharray="0.2"/></svg>\`);
                let a = 0, b = 0;
                for (let i = 3; i < beside.bitmap.length; i += 4) a += beside.bitmap[i];
                for (let i = 3; i < across.bitmap.length; i += 4) b += across.bitmap[i];
                console.log(a, b);
            })();`;
        const child = require('child_process').spawnSync(process.execPath, ['--max-old-space-size=64', '-e', script], {encoding: 'utf8'});
        if (child.status !== 0) panic(`dashes in a 64 MB heap: ${child.stderr.split('\n').find(line => /heap|Error/.test(line)) ?? child.status}`);
        const [beside, across] = child.stdout.trim().split(' ').map(Number);
        // (half of the line shows: dashes of 0.1 with gaps as long; the zigzag about half of its length too)
        if (Math.abs(beside / (100 * 255) - 0.5) > 0.05) panic(`dashes beside the image: ${beside / 255} pixels covered of the line's 100, expected about half`);
        if (!(across > 0)) panic('the dashed zigzag shows nothing');
    }

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
        if (time > 15000) panic(`filter chain: took ${time} ms`);
        error = null;
        try { await Image.renderSVG(chain(8), {maxLayerPixels: 4e6}); } catch (err) { error = err; }
        if (!error || error.name !== 'LimitError') panic(`filter chain within maxLayerPixels: expected a LimitError, got ${error}`);
        // one primitive that costs far more than its pixels: a convolution of order 200 took 341 s over a megapixel (80 KB
        // of SVG); it is charged for its kernel's taps
        const convolve = `<svg ${NS} width="1000" height="1000"><filter id="f"><feConvolveMatrix order="200" kernelMatrix="${'1 '.repeat(200 * 200)}"/></filter><rect width="1000" height="1000" filter="url(#f)"/></svg>`;
        const convolveStart = Date.now();
        error = null;
        try { await Image.renderSVG(convolve); } catch (err) { error = err; }
        if (!error || error.name !== 'LimitError' || Date.now() - convolveStart > 15000) panic(`a convolution of order 200: expected a LimitError within 15 s, got ${error} after ${Date.now() - convolveStart} ms`);
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
            if (!error || error.name !== 'LimitError' || Date.now() - begin > 15000) panic(`${name}: expected a LimitError within 15 s, got ${error} after ${Date.now() - begin} ms`);
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
        // a real filter on a large image still renders
        const shadow = await Image.renderSVG(`<svg ${NS} width="2000" height="2000"><filter id="s"><feGaussianBlur in="SourceAlpha" stdDeviation="8"/><feOffset dx="10" dy="10" result="b"/><feFlood flood-color="#0004"/><feComposite in2="b" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter><rect x="100" y="100" width="1700" height="1700" fill="red" filter="url(#s)"/></svg>`);
        if (shadow.width !== 2000) panic('a drop shadow on a large image should render');
    }
})();
