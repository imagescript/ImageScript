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
    if (time > limit) panic(`${name}: took ${time} ms`);
    return {image, error, time};
};

(async () => {
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
        for (const [name, vector] of Object.entries(vectors)) {
            // (a few levels are an ordinary document)
            const ordinary = await timed(`${name}, 3 levels`, `<svg ${NS} width="100" height="100">${vector(3)}</svg>`);
            if (ordinary.error) panic(`${name}, 3 levels: ${ordinary.error.message}`);
            const {error, time} = await timed(`${name}, 14 levels`, `<svg ${NS} width="100" height="100">${vector(14)}</svg>`, 20000);
            if (!error || !/inside each other|<use> references/.test(error.message)) panic(`${name}, 14 levels: should throw (${error && error.message})`);
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
})();
