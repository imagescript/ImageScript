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
})();
