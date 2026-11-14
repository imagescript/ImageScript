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
            await rejects(`${name} gain map quality 0`, () => encode({gainMap: {quality: 0}}), RangeError);
            await rejects(`${name} gain map quality 101`, () => encode({gainMap: {quality: 101}}), RangeError);
            await rejects(`${name} gain map scale 0`, () => encode({gainMap: {scale: 0}}), RangeError);
            await rejects(`${name} gain map quality "90"`, () => encode({gainMap: {quality: '90'}}), TypeError);
            // (also for an image without a map)
            await rejects(`${name} gain map quality 0 without a map`, () => (name === 'jpeg' ? image.encodeJPEG : name === 'avif' ? image.encodeAVIF : image.encodeJXL).call(image, {gainMap: {quality: 0}}), RangeError);
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
})();
