const {Image, Frame, GainMap, Colors} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};

const throwsA = (fn, type, label) => {
    let error = null;
    try { fn(); } catch (e) { error = e; }
    if (!(error instanceof type)) panic(`${label}: should throw a ${type.name}, got ${error}`);
};

// the distinct RGB values of the opaque pixels
const colorsOf = image => {
    const set = new Set();
    for (let i = 0; i < image.bitmap.length; i += 4) if (image.bitmap[i + 3]) set.add(Array.from(image.bitmap.subarray(i, i + 3)).join());
    return set;
};

// pseudo-random colors: many distinct ones
const photo = (width, height) => new Image(width, height).fill((x, y) => Colors.fromRGBA((x * 37 + y * 11) % 256, (x * 5 + y * 91) % 256, (x * y) % 256, 255));
const DITHERS = ['none', 'floyd-steinberg', 'atkinson', 'ordered'];

// the mean absolute error of the red channel between 8x8 block averages of two images
const blockError = (original, result) => {
    let total = 0, blocks = 0;
    for (let by = 0; by + 8 <= original.height; by += 8) for (let bx = 0; bx + 8 <= original.width; bx += 8) {
        let a = 0, b = 0;
        for (let y = by; y < by + 8; y++) for (let x = bx; x < bx + 8; x++) {
            a += original.bitmap[(y * original.width + x) * 4];
            b += result.bitmap[(y * result.width + x) * 4];
        }
        total += Math.abs(a - b) / 64;
        blocks++;
    }
    return total / blocks;
};

(async () => {
    // at most N distinct colors, for several N and sizes
    for (const colors of [2, 3, 16, 64, 256]) {
        const image = photo(40, 30).quantize({colors});
        const size = colorsOf(image).size;
        if (size > colors || size < 2) panic(`quantize({colors: ${colors}}): ${size} colors`);
        if (image.width !== 40 || image.height !== 30) panic('quantize changed the size');
    }
    for (const dither of DITHERS) {
        const image = photo(7, 5).quantize({colors: 4, dither});
        if (colorsOf(image).size > 4 || image.width !== 7 || image.height !== 5) panic(`quantize 7x5 with ${dither}`);
    }

    // a fixed palette: every opaque pixel is one of its colors, whatever the dithering
    const gameBoy = [0x0f380fff, 0x306230ff, 0x8bac0fff, 0x9bbc0fff];
    for (const dither of DITHERS) {
        const image = photo(33, 17).quantize({palette: gameBoy, dither});
        const allowed = new Set(gameBoy.map(c => [c >>> 24, c >>> 16 & 255, c >>> 8 & 255].join()));
        for (const color of colorsOf(image)) if (!allowed.has(color)) panic(`fixed palette, ${dither}: ${color} is not in the palette`);
    }
    // the palette's alpha is ignored
    const opaqueAndClear = new Image(2, 1).fill((x) => x ? 0xf0f0f0ff : 0x101010ff).quantize({palette: [0x0f380f00, 0xffffff00]});
    if (Array.from(opaqueAndClear.bitmap).join() !== '15,56,15,255,255,255,255,255') panic(`palette alpha: ${Array.from(opaqueAndClear.bitmap).join()}`);

    // without dithering a reduced image doesn't change again
    for (const options of [{colors: 8}, {palette: gameBoy}]) {
        const once = photo(40, 30).quantize(options);
        const twice = once.clone().quantize(options);
        if (!Buffer.from(once.bitmap).equals(Buffer.from(twice.bitmap))) panic(`quantize is not idempotent: ${JSON.stringify(options)}`);
    }

    // dithering averages out: 8x8 block averages of a gradient with 4 colors are closer to the original than undithered
    const ramp = new Image(128, 16).fill(x => Colors.fromRGBA(Math.round(x * 255 / 127), Math.round(x * 255 / 127), Math.round(x * 255 / 127), 255));
    const plain = blockError(ramp, ramp.clone().quantize({colors: 4}));
    for (const dither of ['floyd-steinberg', 'atkinson', 'ordered']) {
        const error = blockError(ramp, ramp.clone().quantize({colors: 4, dither}));
        if (!(error < plain)) panic(`${dither} block error ${error} is not below the undithered ${plain}`);
    }
    // strength 0 is the same as no dithering
    for (const dither of ['floyd-steinberg', 'atkinson', 'ordered']) {
        const none = photo(20, 20).quantize({colors: 4});
        const zero = photo(20, 20).quantize({colors: 4, dither, ditherStrength: 0});
        if (!Buffer.from(none.bitmap).equals(Buffer.from(zero.bitmap))) panic(`${dither} with ditherStrength 0 differs from none`);
    }

    // deterministic: the same input gives the same bytes every time
    for (const dither of DITHERS) {
        const first = photo(37, 23).quantize({colors: 6, dither });
        const second = photo(37, 23).quantize({colors: 6, dither });
        if (!Buffer.from(first.bitmap).equals(Buffer.from(second.bitmap))) panic(`quantize with ${dither} is not deterministic`);
    }

    // transparency: fully transparent pixels keep their color and don't count, the others keep their alpha
    {
        // pixels 0 and 1 opaque, 2 half transparent, 3 to 11 fully transparent with many colors
        const image = new Image(12, 1);
        image.bitmap.set([10, 20, 30, 255, 250, 0, 0, 255, 90, 90, 90, 128]);
        for (let i = 3; i < 12; i++) image.bitmap.set([i * 20, 255 - i * 20, i, 0], i * 4);
        const before = Buffer.from(image.bitmap);
        image.quantize({colors: 2});
        if (colorsOf(image).size > 2) panic('transparent pixels count towards the palette');
        for (let i = 3; i < 12; i++) {
            if (image.bitmap[i * 4 + 3] !== 0 || !Buffer.from(image.bitmap.subarray(i * 4, i * 4 + 3)).equals(before.subarray(i * 4, i * 4 + 3)))
                panic(`transparent pixel ${i} changed`);
        }
        const alphas = [0, 1, 2].map(i => image.bitmap[i * 4 + 3]);
        if (alphas.join() !== '255,255,128') panic(`alpha of the visible pixels: ${alphas}`);
    }

    // validation: every bad argument throws before the image changes
    {
        const image = photo(5, 5);
        const snapshot = Buffer.from(image.bitmap);
        const bad = [
            [() => image.quantize({colors: 1}), RangeError, 'colors 1'],
            [() => image.quantize({colors: 257}), RangeError, 'colors 257'],
            [() => image.quantize({colors: NaN}), RangeError, 'colors NaN'],
            [() => image.quantize({colors: 2.5}), RangeError, 'colors 2.5'],
            [() => image.quantize({colors: 4, palette: [0xffffffff]}), TypeError, 'colors and palette'],
            [() => image.quantize({palette: []}), RangeError, 'empty palette'],
            [() => image.quantize({palette: 'black'}), TypeError, 'palette not an array'],
            [() => image.quantize({palette: Array(257).fill(0xffffffff)}), RangeError, 'palette of 257'],
            [() => image.quantize({palette: [NaN]}), RangeError, 'palette NaN'],
            [() => image.quantize({palette: [1.5]}), RangeError, 'palette fraction'],
            [() => image.quantize({dither: 'bayer'}), TypeError, 'unknown dither'],
            [() => image.quantize({dither: null}), TypeError, 'null dither'],
            [() => image.quantize({dither: 'constructor'}), TypeError, 'inherited dither name'],
            [() => image.quantize({ditherStrength: 1.5}), RangeError, 'ditherStrength 1.5'],
            [() => image.quantize({ditherStrength: -0.1}), RangeError, 'ditherStrength -0.1'],
            [() => image.quantize({ditherStrength: NaN}), RangeError, 'ditherStrength NaN'],
            [() => image.quantize(256), TypeError, 'a positional argument'],
        ];
        for (const [fn, type, label] of bad) throwsA(fn, type, label);
        if (!Buffer.from(image.bitmap).equals(snapshot)) panic('a failed quantize changed the image');
        // numeric strings are accepted like the other numeric options
        if (colorsOf(photo(9, 9).quantize({colors: '4'})).size > 4) panic('colors: "4" not accepted');
    }

    // edge sizes, and a plain pixel stays what it was
    const single = new Image(1, 1).fill(0x123456ff).quantize({colors: 2, dither: 'atkinson'});
    if (Array.from(single.bitmap).join() !== '18,52,86,255') panic(`1x1: ${Array.from(single.bitmap).join()}`);
    const thin = photo(1, 9).quantize({colors: 3, dither: 'floyd-steinberg'});
    if (thin.width !== 1 || thin.height !== 9 || colorsOf(thin).size > 3) panic('1x9 quantize');

    // frames: quantize their own pixels and return the frame
    {
        const frame = new Frame(20, 10, {duration: 100}).fill((x, y) => Colors.fromRGBA(x * 12, y * 25, 128, 255));
        if (frame.quantize({colors: 2, dither: 'ordered'}) !== frame) panic('quantize does not return this for a frame');
        if (colorsOf(frame).size > 2) panic('frame quantize');
    }

    // an image with a gain map keeps a valid one
    {
        const hdr = new Image(8, 8).fill((x, y) => Colors.fromRGBA(x * 30, y * 30, 200, 255));
        hdr.gainMap = new GainMap(new Image(4, 4).fill(0x808080ff), {min: 0, max: 2});
        hdr.quantize({colors: 4, dither: 'floyd-steinberg'});
        if (!(hdr.gainMap instanceof GainMap)) panic('gain map removed by quantize');
        if (colorsOf(hdr).size > 4) panic('quantize with a gain map');
        const decoded = await Image.decode(await hdr.encodeJPEG());
        if (!decoded.gainMap) panic('the gain map of a quantized image is not encoded');
    }
})().catch(error => panic(error.stack || String(error)));
