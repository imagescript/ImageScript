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
})();
