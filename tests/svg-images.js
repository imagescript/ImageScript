const {Image, Animation, Frame, Colors} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};

const same = (a, b) => a.width === b.width && a.height === b.height && Buffer.from(a.bitmap).equals(Buffer.from(b.bitmap));
const svg = (body, width = 8, height = 3) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`;
const dataURI = (type, bytes) => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
const pixel = (image, x, y) => Array.from(image.bitmap.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
const transparent = image => image.bitmap.every((v, i) => i % 4 !== 3 || v === 0);

const throwsA = async (promise, type, label) => {
    let error = null;
    try { await promise; } catch (e) { error = e; }
    if (!(error instanceof type)) panic(`${label}: should throw a ${type.name}, got ${error}`);
    return error;
};

// counts the calls to Image.decode while run() goes on
const countDecodes = async run => {
    const original = Image.decode;
    let calls = 0;
    Image.decode = (...args) => {
        calls++;
        return original.apply(Image, args);
    };
    try {
        return {result: await run(), calls};
    } finally {
        Image.decode = original;
    }
};

// CRC-32 of a PNG chunk, to patch the header of a test file
const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let k = 0; k < 8; k++) crc = crc >>> 1 ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
};

(async () => {
    const logo = new Image(4, 3).fill((x, y) => Colors.fromRGBA(x * 60, y * 80, 128, x === 0 ? 0 : 255));
    const other = new Image(4, 3).fill((x, y) => Colors.fromRGBA(255 - x * 60, y * 40, 200, 255));
    const opaque = new Image(4, 3).fill((x, y) => Colors.fromRGBA(x * 60, y * 80, 128, 255));
    const png = await logo.encodePNG({compression: 1});
    const webp = await logo.encodeWebP();
    const jpeg = await opaque.encodeJPEG({quality: 90});
    const gif = await new Animation([new Frame(opaque.clone())]).encodeGIF();
    const otherPNG = await other.encodePNG({compression: 1});

    // images given by href render exactly like the same images as data URIs, in every format and placement
    const formats = [['image/png', png], ['image/webp', webp], ['image/jpeg', jpeg], ['image/gif', gif]];
    for (const [type, bytes] of formats) {
        const viaURI = await Image.renderSVG(svg(`<image href="${dataURI(type, bytes)}" width="4" height="3"/>`));
        const viaMap = await Image.renderSVG(svg('<image href="logo.png" width="4" height="3"/>'), {images: {'logo.png': bytes}});
        if (!same(viaURI, viaMap)) panic(`${type}: an image given by href differs from the data URI`);
        if (viaMap.width !== 8 || transparent(viaMap)) panic(`${type}: the image was not drawn`);
    }
    // the same, with preserveAspectRatio and scaling
    for (const aspect of ['none', 'xMidYMid meet', 'xMinYMin slice']) {
        const element = (href) => `<image href="${href}" x="1" y="0" width="6" height="6" preserveAspectRatio="${aspect}"/>`;
        const viaURI = await Image.renderSVG(svg(element(dataURI('image/png', png)), 8, 6), {scale: 2});
        const viaMap = await Image.renderSVG(svg(element('logo.png'), 8, 6), {scale: 2, images: {'logo.png': png}});
        if (!same(viaURI, viaMap)) panic(`preserveAspectRatio="${aspect}" differs between data URIs and given images`);
    }

    // an Image instance works like its encoded bytes
    {
        const bytes = await Image.renderSVG(svg('<image href="logo.png" width="4" height="3"/>'), {images: {'logo.png': png}});
        const instance = await Image.renderSVG(svg('<image href="logo.png" width="4" height="3"/>'), {images: {'logo.png': logo}});
        if (!same(bytes, instance)) panic('an Image value renders differently from its bytes');
        if (!same(instance, bytes)) panic('an Image value is not equal to its bytes (reverse)');
    }

    // two hrefs: each image is drawn where its element is
    {
        const body = '<image href="a.png" width="4" height="3"/><image href="b.png" x="4" width="4" height="3"/>';
        const image = await Image.renderSVG(svg(body), {images: {'a.png': png, 'b.png': otherPNG}});
        for (let y = 0; y < 3; y++) for (let x = 0; x < 8; x++) {
            const expected = x < 4 ? logo : other, X = x % 4;
            // (the first pixel of logo is transparent)
            if (expected === logo && X === 0) continue;
            if (pixel(image, x, y).join() !== pixel(expected, X, y).join())
                panic(`two hrefs: pixel ${x},${y} is ${pixel(image, x, y)}, expected ${pixel(expected, X, y)}`);
        }
    }

    // the same href twice: drawn twice, decoded once
    {
        const body = '<image href="logo.png" width="4" height="3"/><image href="logo.png" x="4" width="4" height="3"/>';
        const {result, calls} = await countDecodes(() => Image.renderSVG(svg(body), {images: {'logo.png': png}}));
        if (calls !== 1) panic(`the same href decoded ${calls} times`);
        if (pixel(result, 2, 1).join() !== pixel(result, 6, 1).join()) panic('the same href drawn twice differs');
    }

    // patterns, use/symbol, feImage and nested SVG documents: the same as with data URIs
    // each shape is built around an href: the data URI version and the given-by-href version differ only in it
    const uri = dataURI('image/png', png);
    const nested = href => dataURI('image/svg+xml', svg(`<image href="${href}" width="4" height="3"/>`, 4, 3));
    const shapes = [
        ['pattern', href => `<defs><pattern id="p" width="4" height="3" patternUnits="userSpaceOnUse"><image href="${href}" width="4" height="3"/></pattern></defs><rect width="8" height="3" fill="url(#p)"/>`, 3],
        ['use/symbol', href => `<defs><symbol id="s" viewBox="0 0 4 3"><image href="${href}" width="4" height="3"/></symbol></defs><use href="#s" width="8" height="6"/>`, 6],
        ['feImage', href => `<filter id="f" x="0" y="0" width="1" height="1"><feImage href="${href}" x="0" y="0" width="4" height="3"/></filter><rect width="4" height="3" filter="url(#f)"/>`, 3],
        ['nested SVG', href => `<image href="${nested(href)}" width="4" height="3"/>`, 3],
    ];
    for (const [name, build, height] of shapes) {
        const viaURI = await Image.renderSVG(svg(build(uri), 8, height));
        const viaMap = await Image.renderSVG(svg(build('logo.png'), 8, height), {images: {'logo.png': png}});
        if (!same(viaURI, viaMap)) panic(`${name}: images given by href differ from data URIs`);
        if (transparent(viaMap)) panic(`${name}: nothing drawn`);
    }

    // drawing an href that isn't given throws (the SVG can't be rendered as it is); images that aren't drawn don't
    {
        await throwsA(Image.renderSVG(svg('<image href="missing.png" width="4" height="3"/>')), Error, 'a missing href');
        await throwsA(Image.renderSVG(svg('<image href="missing.png" width="4" height="3"/>'), {images: {'logo.png': png}}), Error, 'a missing href next to a given one');
        await throwsA(Image.renderSVG(svg('<image href="https://example.com/logo.png" width="4" height="3"/>')), Error, 'a URL');
        await throwsA(Image.renderSVG(svg(`<image href="${dataURI('image/bmp', [1, 2, 3])}" width="4" height="3"/>`)), Error, 'an unsupported data URI type');
        await throwsA(Image.renderSVG(svg(`<image href="${dataURI('image/svg+xml', '<html/>')}" width="4" height="3"/>`)), Error, 'a data URI SVG without <svg>');
        const empty = await Image.renderSVG(svg(''));
        for (const [label, body] of [
            ['in <defs>', '<defs><image id="i" href="missing.png" width="4" height="3"/></defs>'],
            ['display="none"', '<image href="missing.png" width="4" height="3" display="none"/>'],
            ['visibility="hidden"', '<image href="missing.png" width="4" height="3" visibility="hidden"/>'],
            ['in a group\'s bounding box', '<g fill="url(#g)"><image href="missing.png" width="4" height="3" visibility="hidden"/><rect width="2" height="2"/></g><linearGradient id="g"><stop stop-color="red"/></linearGradient>'],
            ['without an href', '<image width="4" height="3"/>'],
        ]) {
            const result = await Image.renderSVG(svg(body)).catch(error => panic(`a missing image that isn't drawn (${label}) throws: ${error.message}`));
            if (label !== 'in a group\'s bounding box' && !same(result, empty)) panic(`a missing image that isn't drawn (${label}) draws something`);
        }
    }

    // images that are given but not referenced are not decoded (garbage bytes don't throw)
    {
        const {result, calls} = await countDecodes(() => Image.renderSVG(svg('<image href="logo.png" width="4" height="3"/>'), {
            images: {'logo.png': png, 'unused.png': new Uint8Array([1, 2, 3])},
        }));
        if (calls !== 1) panic(`an unused image was decoded (${calls} decodes)`);
        if (transparent(result)) panic('the used image was not drawn next to an unused one');
    }

    // drawing an undecodable image throws, given by href or as a data URI (with the decoding error as its cause)
    {
        const broken = await throwsA(Image.renderSVG(svg('<image href="logo.png" width="4" height="3"/>'), {images: {'logo.png': new Uint8Array([1, 2, 3, 4])}}), Error, 'a broken given image');
        if (!broken.cause) panic(`a broken image's error has no cause: ${broken.message}`);
        await throwsA(Image.renderSVG(svg(`<image href="${dataURI('image/png', [1, 2, 3, 4])}" width="4" height="3"/>`)), Error, 'a broken data URI');
        await throwsA(Image.renderSVG(svg(`<filter id="f"><feImage href="${dataURI('image/png', [1, 2, 3, 4])}"/></filter><rect width="4" height="3" filter="url(#f)"/>`)), Error, 'a broken feImage');
        // (one that isn't drawn doesn't throw)
        await Image.renderSVG(svg('<defs><image href="logo.png" width="4" height="3"/></defs>'), {images: {'logo.png': new Uint8Array([1, 2, 3, 4])}});
    }

    // validation before anything is decoded
    {
        const element = svg('<image href="logo.png" width="4" height="3"/>');
        for (const images of ['logo.png', null, [], new Map([['logo.png', png]])])
            await throwsA(Image.renderSVG(element, {images}), TypeError, `images ${Object.prototype.toString.call(images)}`);
        for (const value of [42, 'bytes', null, {}, [1, 2]])
            await throwsA(Image.renderSVG(element, {images: {'logo.png': value}}), TypeError, `value ${JSON.stringify(value)}`);
        const {calls} = await countDecodes(() => throwsA(Image.renderSVG(element, {images: {'logo.png': png, 'bad.png': 42}}), TypeError, 'a later bad value'));
        if (calls !== 0) panic(`images were decoded before validation failed (${calls})`);
    }

    // a huge declared image doesn't get around the decoding limit: drawing it throws a RangeError
    {
        const tiny = await new Image(1, 1).fill(0xffffffff).encodePNG({compression: 1});
        const huge = Uint8Array.from(tiny);
        const view = new DataView(huge.buffer);
        view.setUint32(16, 20000);
        view.setUint32(20, 20000);
        view.setUint32(29, crc32(huge.subarray(12, 29)));
        await throwsA(Image.decode(huge), RangeError, 'the huge PNG decodes on its own');
        await throwsA(Image.renderSVG(svg('<image href="big.png" width="4" height="3"/>'), {images: {'big.png': huge}}), RangeError, 'a huge image');
    }

    // maxImagePixels: the images together (Image values don't count), by default maxPixels
    {
        const body = '<image href="a.png" width="4" height="3"/><image href="b.png" x="4" width="4" height="3"/>';
        const two = {'a.png': png, 'b.png': otherPNG};
        await Image.renderSVG(svg(body), {images: two, maxImagePixels: 24});
        await throwsA(Image.renderSVG(svg(body), {images: two, maxImagePixels: 23}), RangeError, 'two images over maxImagePixels');
        // (a 4x3 output: only the images exceed maxPixels)
        await throwsA(Image.renderSVG(svg(body, 4, 3), {images: two, maxPixels: 23}), RangeError, 'two images over maxPixels');
        await Image.renderSVG(svg(body), {images: {'a.png': logo, 'b.png': other}, maxImagePixels: 1});
        await Image.renderSVG(svg(body, 4, 3), {images: two, maxPixels: 23, maxImagePixels: Infinity});
        for (const [value, type] of [[0, RangeError], [-1, RangeError], [NaN, RangeError], ['many', TypeError], ['100', TypeError]])
            await throwsA(Image.renderSVG(svg(body), {images: two, maxImagePixels: value}), type, `maxImagePixels ${value}`);
    }

    // maxLayerPixels: the layers alive at once (nested groups with opacity each take one), by default 4 * maxPixels
    {
        const nest = depth => '<g opacity="0.9">'.repeat(depth) + '<rect width="8" height="3"/>' + '</g>'.repeat(depth);
        // the canvas and 3 layers fit 4 * maxPixels
        await Image.renderSVG(svg(nest(3)), {maxPixels: 24});
        await throwsA(Image.renderSVG(svg(nest(4)), {maxPixels: 24}), RangeError, 'nested layers over 4 * maxPixels');
        await throwsA(Image.renderSVG(svg(nest(2)), {maxLayerPixels: 24 * 2}), RangeError, 'nested layers over maxLayerPixels');
        await Image.renderSVG(svg(nest(20)), {maxPixels: 24, maxLayerPixels: Infinity});
        // layers that are done are given back: many groups after each other only take one at a time
        await Image.renderSVG(svg(nest(1).repeat(100) + `<g opacity="0.5" filter="url(#f)" mask="url(#m)"><rect width="8" height="3"/></g>`.repeat(50)
            + '<filter id="f"><feOffset dx="1"/></filter><mask id="m"><rect width="8" height="3" fill="white"/></mask>'), {maxLayerPixels: 24 * 8});
        for (const value of [0, -1, NaN])
            await throwsA(Image.renderSVG(svg(nest(1)), {maxLayerPixels: value}), RangeError, `maxLayerPixels ${value}`);
    }

    // quantized images can be given too (the palette of an SVG's image)
    {
        const reduced = await new Image(4, 3).fill((x, y) => Colors.fromRGBA(x * 60, y * 80, 128, 255)).quantize({colors: 4}).encodePNG({compression: 1});
        const result = await Image.renderSVG(svg('<image href="logo.png" width="4" height="3"/>'), {images: {'logo.png': reduced}});
        if (transparent(result)) panic('a reduced image was not drawn');
    }
})().catch(error => panic(error.stack || String(error)));
