const fs = require('fs').promises;
const {Image, Animation, Frame, GainMap, Colors} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};
const rejects = async (name, fn, Type) => {
    try {
        await fn();
    } catch (error) {
        if (!(error instanceof Type)) panic(`${name}: wrong error ${error?.constructor?.name}: ${error?.message}`);
        return;
    }
    panic(`${name}: accepted`);
};
const has = (bytes, text) => Buffer.from(bytes).includes(Buffer.from(text, 'latin1'));

(async () => {
    const image = new Image(8, 8).fill((x, y) => Colors.fromRGB(x * 30, y * 30, 128));

    // a gain map's hdrCapacityMin and hdrCapacityMax are checked against each other when they are set (the old value
    // stays), so a map is never in a state that clone(), image.gainMap = map or an encoder refuses
    {
        const map = new GainMap(new Image(4, 4).fill(0x808080ff), {max: 2});
        await rejects('hdrCapacityMax below hdrCapacityMin', () => { map.hdrCapacityMax = -0.5; }, RangeError);
        await rejects('hdrCapacityMax equal to hdrCapacityMin', () => { map.hdrCapacityMax = 0; }, RangeError);
        await rejects('hdrCapacityMin above hdrCapacityMax', () => { map.hdrCapacityMin = 3; }, RangeError);
        if (map.hdrCapacityMax !== 2 || map.hdrCapacityMin !== 0) panic(`gain map capacities changed by refused values: ${map.hdrCapacityMin} ${map.hdrCapacityMax}`);
        map.hdrCapacityMax = 3;
        map.hdrCapacityMin = 1;
        map.clone();
        image.clone().gainMap = map;
        await rejects('new GainMap capacities crossed', () => new GainMap(new Image(4, 4), {hdrCapacityMin: 2, hdrCapacityMax: 1}), RangeError);
        // a channel value is a number or [r, g, b] (a one-element array is neither)
        await rejects('gain map max [1]', () => { map.max = [1]; }, RangeError);
        await rejects('gain map min [1, 2]', () => { map.min = [1, 2]; }, RangeError);
        if (map.max.join() !== '2,2,2') panic('gain map max changed by a refused value');
    }

    // the gain map embed options and the lossy WebP options are checked whether they are used or not
    {
        const map = new GainMap(new Image(8, 8).fill(0x808080ff), {max: 2});
        const hdr = image.clone();
        hdr.gainMap = map;
        for (const [name, encode] of Object.entries({jpeg: o => hdr.encodeJPEG(o), avif: o => hdr.encodeAVIF(o), jxl: o => hdr.encodeJXL(o)})) {
            await rejects(`${name} gain map quality -1`, () => encode({gainMap: {quality: -1}}), RangeError);
            await rejects(`${name} gain map quality 101`, () => encode({gainMap: {quality: 101}}), RangeError);
            await rejects(`${name} gain map scale 0`, () => encode({gainMap: {scale: 0}}), RangeError);
            await rejects(`${name} gain map quality "90"`, () => encode({gainMap: {quality: '90'}}), TypeError);
            // (also for an image without a map)
            await rejects(`${name} gain map quality -1 without a map`, () => (name === 'jpeg' ? image.encodeJPEG : name === 'avif' ? image.encodeAVIF : image.encodeJXL).call(image, {gainMap: {quality: -1}}), RangeError);
            await encode({gainMap: {quality: 1, scale: 0.5}});
        }
        await rejects('encodeWebP alphaQuality 101', () => image.encodeWebP({alphaQuality: 101}), RangeError);
        await rejects('encodeWebP lossy alphaQuality 101', () => image.encodeWebP({quality: 80, alphaQuality: 101}), RangeError);
        await rejects('encodeWebP alphaQuality -1', () => image.encodeWebP({quality: 80, alphaQuality: -1}), RangeError);
    }

    // boolean options take true or false only: a string like 'yes' is a TypeError, not true
    {
        const png = await image.encodePNG();
        const animation = new Animation([new Frame(image.clone()), new Frame(image.clone().invert())]);
        const booleans = {
            'decode applyOrientation': () => Image.decode(png, {applyOrientation: 'no'}), 'decode applyColorProfile': () => Image.decode(png, {applyColorProfile: 0}),
            'decode gainMap': () => Image.decode(png, {gainMap: 'yes'}), 'Animation.decode applyOrientation': () => Animation.decode(png, {applyOrientation: 'no'}),
            'dominantColor ignoreBlack': () => image.dominantColor({ignoreBlack: 'yes'}), 'dominantColor ignoreWhite': () => image.dominantColor({ignoreWhite: 1}),
            'rotate expand': () => image.clone().rotate(45, {expand: 'no'}), 'transform expand': () => image.clone().transform([1, 0, 0, 1, 0, 0], {expand: 'no'}),
            'dropShadow expand': () => image.clone().dropShadow({expand: 'no'}), 'outline expand': () => image.clone().outline({expand: 'no'}),
            'encodeWebP sharpYuv': () => image.encodeWebP({quality: 80, sharpYuv: 'yes'}), 'encodeWebP lossless sharpYuv': () => image.encodeWebP({sharpYuv: 'yes'}),
            'encodeJPEG gainMap': () => image.encodeJPEG({gainMap: 'yes'}), 'encodeAVIF gainMap': () => image.encodeAVIF({gainMap: 'yes'}), 'encodeJXL gainMap': () => image.encodeJXL({gainMap: 'yes'}),
            'encodeGIF optimize': () => animation.encodeGIF({optimize: 'yes'}), 'encodeAPNG optimize': () => animation.encodeAPNG({optimize: 'yes'}), 'encodeWebP optimize': () => animation.encodeWebP({optimize: 'yes'}),
            'gifEncoder optimize': () => Animation.gifEncoder(8, 8, {optimize: 'yes'}), 'apngEncoder optimize': () => Animation.apngEncoder(8, 8, {optimize: 'yes'}), 'webpEncoder optimize': () => Animation.webpEncoder(8, 8, {optimize: 'yes'}),
            'renderText hinting': async () => Image.renderText('x', {font: await fs.readFile('./tests/fonts/opensans bold.ttf'), size: 12, hinting: 'yes'})
        };
        for (const [name, call] of Object.entries(booleans)) await rejects(name, call, TypeError);
        // (the valid values keep working)
        await Image.decode(png, {applyOrientation: false, applyColorProfile: false, gainMap: false});
        image.dominantColor({ignoreBlack: false, ignoreWhite: false});
        await image.encodeWebP({quality: 80, sharpYuv: true});
        await animation.encodeGIF({optimize: false});
    }

    // the type of an argument that isn't a number is a TypeError (the wrong number of values a RangeError)
    {
        const font = await fs.readFile('./tests/fonts/sourcesans3 regular.otf');
        await rejects('transform string', () => image.clone().transform('matrix(1 0 0 1 0 0)'), TypeError);
        await rejects('transform 5 values', () => image.clone().transform([1, 0, 0, 1, 0]), RangeError);
        await rejects('colorMatrix()', () => image.clone().colorMatrix(), TypeError);
        await rejects('colorMatrix string', () => image.clone().colorMatrix('1 0 0'), TypeError);
        await rejects('colorMatrix 8 values', () => image.clone().colorMatrix([1, 0, 0, 0, 1, 0, 0, 0]), RangeError);
        await rejects('feature "on"', () => Image.renderText('x', {font, size: 12, features: {liga: 'on'}}), TypeError);
        await rejects('feature 300', () => Image.renderText('x', {font, size: 12, features: {liga: 300}}), RangeError);
        await rejects('variation "bold"', () => Image.renderText('x', {font, size: 12, variations: {weight: 'bold'}}), TypeError);
        await rejects('variation NaN', () => Image.renderText('x', {font, size: 12, variations: {weight: NaN}}), RangeError);
        await rejects('linearGradient without options', () => Image.linearGradient(4, 4), TypeError);
        await rejects('radialGradient without options', () => Image.radialGradient(4, 4), TypeError);
        await rejects('linearGradient without stops', () => Image.linearGradient(4, 4, {}), TypeError);
        await rejects('Colors.gradient(5)', () => Colors.gradient(5), TypeError);
        await rejects('metadata title 123', () => image.encodePNG({metadata: {title: 123}}), TypeError);
        await rejects('metadata comment object', () => image.encodeJPEG({metadata: {comment: {}}}), TypeError);
        await image.encodePNG({metadata: {title: '', comment: null}});
    }

    // software: null (and nothing else) writes no Exif block at all, not an empty one
    for (const [name, encode] of Object.entries({jpeg: o => image.encodeJPEG(o), webp: o => image.encodeWebP(o), 'lossy webp': o => image.encodeWebP({quality: 80, ...o}), avif: o => image.encodeAVIF({effort: 0, ...o}), jxl: o => image.encodeJXL(o)})) {
        const bare = await encode({metadata: {software: null}});
        if (has(bare, 'MM\0*')) panic(`${name}: software: null still writes an Exif block`);
        if (!has(await encode({metadata: {software: null, author: 'me'}}), 'me')) panic(`${name}: the Exif block is missing with an author`);
        const decoded = await Image.decode(bare);
        if (decoded.width !== 8) panic(`${name}: the file without Exif doesn't decode`);
    }

    // grayscale images are grayscale JPEGs (one component, a third the data), decoding to the same pixels as the color
    // encoding does
    {
        const gray = new Image(32, 32).fill((x, y) => Colors.fromRGB(x * 8, x * 8, x * 8));
        const encoded = await gray.encodeJPEG({quality: 90});
        const sof = encoded.indexOf(0xc0, 2);
        if (encoded[sof - 1] !== 0xff || encoded[sof + 8] !== 1) panic(`a gray image should be a one component JPEG, got ${encoded[sof + 8]} components`);
        const decoded = await Image.decode(encoded);
        for (let i = 0; i < decoded.bitmap.length; i += 4)
            if (decoded.bitmap[i] !== decoded.bitmap[i + 1] || decoded.bitmap[i] !== decoded.bitmap[i + 2] || Math.abs(decoded.bitmap[i] - gray.bitmap[i]) > 4) panic('the grayscale JPEG decodes to other pixels');
        const color = gray.clone();
        color.setPixelAt(0, 0, 0xff0000ff);
        const colorSof = (await color.encodeJPEG()).indexOf(0xc0, 2);
        if ((await color.encodeJPEG())[colorSof + 8] !== 3) panic('an image with a colored pixel should be a 3 component JPEG');
        // (translucent gray pixels on a black background stay gray)
        const translucent = gray.clone().opacity(0.5);
        const t = await translucent.encodeJPEG();
        if (t[t.indexOf(0xc0, 2) + 8] !== 1) panic('a translucent gray image on black should be a grayscale JPEG');
    }

    // an SVG with a viewBox and one of width and height: the other follows the viewBox's aspect ratio (like browsers)
    {
        const svg = (attrs) => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><rect width="100" height="60" fill="red"/></svg>`;
        const byWidth = await Image.renderSVG(svg('viewBox="0 0 100 60" width="50"'));
        if (byWidth.width !== 50 || byWidth.height !== 30) panic(`viewBox + width: ${byWidth.width}x${byWidth.height} instead of 50x30`);
        if (byWidth.getPixelAt(49, 29) !== 0xff0000ff || byWidth.getPixelAt(0, 0) !== 0xff0000ff) panic('viewBox + width: the content should fill the image');
        const byHeight = await Image.renderSVG(svg('viewBox="0 0 100 60" height="30"'));
        if (byHeight.width !== 50 || byHeight.height !== 30) panic(`viewBox + height: ${byHeight.width}x${byHeight.height} instead of 50x30`);
        const both = await Image.renderSVG(svg('viewBox="0 0 100 60" width="50" height="60"'));
        if (both.width !== 50 || both.height !== 60) panic('width and height given: both are used');
        const percent = await Image.renderSVG(svg('viewBox="0 0 100 60" width="50%"'));
        if (percent.width !== 50 || percent.height !== 30) panic(`viewBox + width 50%: ${percent.width}x${percent.height} instead of 50x30`);
        const none = await Image.renderSVG(svg('width="50"'));
        if (none.width !== 50 || none.height !== 100) panic('without a viewBox the other side is the default 100');
    }

    // a right-to-left paragraph is aligned to the right by default (the start of its direction), a left-to-right one to
    // the left; horizontalAlign overrides both
    {
        const fonts = await Promise.all(['opensans bold.ttf', 'noto naskh arabic subset.ttf'].map(name => fs.readFile(`./tests/fonts/${name}`)));
        const inkEdges = image => {
            let left = image.width, right = -1;
            for (const [x, , color] of image.pixels()) if (color & 0xff) { left = Math.min(left, x); right = Math.max(right, x); }
            return [left, right];
        };
        const arabic = await Image.renderText('مرحبا بالعالم مرحبا بالعالم مرحبا بالعالم', {font: fonts, size: 24, width: 150});
        const [, arabicRight] = inkEdges(arabic.extract(0, 0, 150, 30)), [arabicLeft] = inkEdges(arabic);
        if (arabicRight < 140) panic(`a right-to-left paragraph should start at the right edge, its first line ends at ${arabicRight}`);
        if (arabicLeft < 2) panic('a wrapped right-to-left paragraph should be ragged on the left');
        const latin = await Image.renderText('Hello world hello world hello world hello', {font: fonts, size: 24, width: 150});
        if (inkEdges(latin.extract(0, 0, 150, 30))[0] > 6) panic('a left-to-right paragraph starts at the left');
        const forcedLeft = await Image.renderText('مرحبا بالعالم', {font: fonts, size: 24, width: 150, horizontalAlign: 'left'});
        if (inkEdges(forcedLeft)[0] > 6) panic('horizontalAlign left places right-to-left text on the left');
        // each paragraph by its own direction
        const mixed = await Image.renderText('Hello\nمرحبا', {font: fonts, size: 24, width: 150});
        const lineHeight = mixed.height / 2;
        if (inkEdges(mixed.extract(0, 0, 150, lineHeight))[0] > 6 || inkEdges(mixed.extract(0, lineHeight, 150, lineHeight))[1] < 140) panic('mixed paragraphs should each start at their own side');
    }
})();
