const fs = require('fs').promises;
const crypto = require('crypto');
const {Image, Frame, Animation, Colors, decode} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};
const sha256 = bytes => crypto.createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
const throwsA = async (fn, type, label) => {
    let error = null;
    try { await fn(); } catch (e) { error = e; }
    if (!(error instanceof type)) panic(`${label}: should throw a ${type.name}, got ${error}`);
};

(async () => {
    const photo = new Image(12, 8).fill((x, y) => Colors.fromRGBA(x * 20, y * 30, 90, 255));
    const two = new Animation([Frame.from(photo, {duration: 50}), Frame.from(photo.clone().invert(), {duration: 70})]);

    // multiple frames: an Animation, with every frame
    const gif = await fs.readFile('./tests/targets/gif.gif');
    const gifFrames = await decode(gif);
    if (!(gifFrames instanceof Animation) || gifFrames.length !== 30) panic(`GIF: ${gifFrames.constructor.name} with ${gifFrames.length} frames instead of 30`);
    if ((await Animation.decode(gif)).length !== 30) panic('GIF: Animation.decode frame count changed');

    const apng = await two.encodeAPNG({optimize: false});
    const apngFrames = await decode(apng);
    if (!(apngFrames instanceof Animation) || apngFrames.length !== 2 || apngFrames.frames[1].duration !== 70) panic('APNG: expected an Animation of 2 frames');

    const webp = await fs.readFile('./tests/webp/animated.webp');
    const webpFrames = await decode(webp);
    if (!(webpFrames instanceof Animation) || webpFrames.length !== 4) panic(`animated WebP: ${webpFrames.constructor.name} with ${webpFrames.length} frames instead of 4`);

    // (JPEG XL animations: the frames of the APNG reference)
    const jxlAnimation = await fs.readFile('./tests/jxl/animation.jxl');
    const jxlRef = await Animation.decode(await fs.readFile('./tests/jxl/animation.png'));
    const jxlFrames = await decode(jxlAnimation);
    if (!(jxlFrames instanceof Animation) || jxlFrames.length !== jxlRef.length) panic(`JPEG XL: ${jxlFrames.constructor.name} with ${jxlFrames.length} frames instead of ${jxlRef.length}`);

    // one frame: an Image with the frame's pixels, as Animation.decode's first frame has them
    const single = new Animation([new Frame(12, 8, {duration: 90, xOffset: 0, yOffset: 0}).fill((x, y) => Colors.fromRGBA(x * 20, y * 30, 90, 255))]);
    for (const [format, bytes] of [['GIF', await single.encodeGIF()], ['APNG', await single.encodeAPNG()], ['WebP', await single.encodeWebP({quality: 90})]]) {
        const image = await decode(bytes);
        if (image instanceof Animation || !(image instanceof Image)) panic(`single frame ${format}: ${image.constructor.name} instead of an Image`);
        const reference = (await Animation.decode(bytes)).frames[0];
        if (image.width !== reference.width || image.height !== reference.height) panic(`single frame ${format}: ${image.width}x${image.height} instead of ${reference.width}x${reference.height}`);
        if (sha256(image.bitmap) !== sha256(reference.bitmap)) panic(`single frame ${format}: pixels differ from Animation.decode's first frame`);
    }

    // a single frame with an offset: the image is the canvas, the offset is dropped
    const offset = await new Animation([new Frame(4, 3, {xOffset: 2, yOffset: 1, duration: 40}).fill(0xff0000ff)]).encodeGIF({optimize: false});
    const offsetImage = await decode(offset);
    if (offsetImage instanceof Animation || offsetImage.width !== 6 || offsetImage.height !== 4) panic(`single frame with an offset: ${offsetImage.width}x${offsetImage.height}`);

    // a still JPEG XL is an Image with the pixels Image.decode gives
    const still = await fs.readFile('./tests/jxl/lossy.jxl');
    const stillImage = await decode(still), stillRef = await Image.decode(still);
    if (stillImage instanceof Animation || stillImage.width !== stillRef.width || sha256(stillImage.bitmap) !== sha256(stillRef.bitmap)) panic('still JPEG XL: pixels differ from Image.decode');

    // static formats: always Images, the pixels of Image.decode
    for (const [name, path] of [['PNG', './tests/targets/external.png'], ['JPEG', './tests/targets/external.jpg'], ['still WebP', './tests/webp/lossy.webp']]) {
        const bytes = await fs.readFile(path);
        const image = await decode(bytes), reference = await Image.decode(bytes);
        if (image instanceof Animation || !(image instanceof Image)) panic(`${name}: not an Image`);
        if (sha256(image.bitmap) !== sha256(reference.bitmap)) panic(`${name}: pixels differ from Image.decode`);
    }

    // options pass through: onlyFirstFrame gives the first frame as an Image, maxPixels applies to both kinds
    const first = await decode(gif, {onlyFirstFrame: true});
    if (first instanceof Animation || !(first instanceof Image)) panic('onlyFirstFrame: expected an Image');
    if (sha256(first.bitmap) !== sha256((await Animation.decode(gif, {onlyFirstFrame: true})).frames[0].bitmap)) panic('onlyFirstFrame: wrong frame');
    await throwsA(() => decode(gif, {maxPixels: 100}), RangeError, 'maxPixels on a GIF');
    const jpeg = await fs.readFile('./tests/targets/external.jpg');
    await throwsA(() => decode(jpeg, {maxPixels: 100}), RangeError, 'maxPixels on a JPEG');
    if ((await decode(gif, {threads: 2})).length !== 30) panic('threads: frames changed');

    // Animation.decode returns an Animation for every format, single frames included: only decode() unwraps them
    const alwaysAnimation = async (name, bytes) => {
        const animation = await Animation.decode(bytes);
        if (!(animation instanceof Animation) || animation.length !== 1) panic(`${name}: Animation.decode gives ${animation.constructor.name} with ${animation.length} frames, not an Animation of 1`);
    };
    const stillFiles = {
        PNG: await photo.encodePNG(),
        JPEG: await photo.encodeJPEG(),
        'WebP still': await photo.encodeWebP(),
        AVIF: await photo.encodeAVIF({effort: 0}),
        'JPEG XL': await photo.encodeJXL(),
        TGA: await photo.encodeTGA()
    };
    for (const [name, bytes] of Object.entries(stillFiles)) {
        await alwaysAnimation(name, bytes);
        const image = await decode(bytes);
        if (image instanceof Animation || !(image instanceof Image)) panic(`${name}: decode() should give an Image`);
    }
    const oneFrameFiles = {GIF: await single.encodeGIF(), APNG: await single.encodeAPNG(), 'WebP animation': await single.encodeWebP({quality: 90})};
    for (const [name, bytes] of Object.entries(oneFrameFiles)) await alwaysAnimation(name, bytes);

    // a one-frame APNG that keeps its acTL chunk (the encoder writes none for one frame): the two-frame file cut before
    // its second frame, num_frames patched to 1, every chunk's CRC recomputed
    const crcTable = Array.from({length: 256}, (_, n) => {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
    });
    const crc32 = bytes => {
        let c = 0xffffffff;
        for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    };
    const pngChunk = (type, data) => {
        const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
        view.setUint32(0, data.length);
        for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
        out.set(data, 8);
        view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
        return out;
    };
    const apngBytes = new Uint8Array(apng);
    const apngView = new DataView(apngBytes.buffer, apngBytes.byteOffset, apngBytes.byteLength);
    const chunks = [];
    for (let at = 8; at < apngBytes.length;) {
        const length = apngView.getUint32(at);
        chunks.push({type: String.fromCharCode(...apngBytes.subarray(at + 4, at + 8)), data: apngBytes.subarray(at + 8, at + 8 + length)});
        at += 12 + length;
    }
    let fcTLs = 0;
    const second = chunks.findIndex(c => c.type === 'fcTL' && ++fcTLs === 2);
    if (second < 0) panic('the two-frame APNG has no second fcTL');
    const parts = [apngBytes.subarray(0, 8)];
    for (const c of chunks.slice(0, second)) {
        if (c.type !== 'acTL') { parts.push(pngChunk(c.type, c.data)); continue; }
        const actl = new Uint8Array(c.data);
        new DataView(actl.buffer).setUint32(0, 1);
        parts.push(pngChunk('acTL', actl));
    }
    parts.push(pngChunk('IEND', new Uint8Array(0)));
    const oneApng = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
    for (let at = 0, i = 0; i < parts.length; i++) { oneApng.set(parts[i], at); at += parts[i].length; }
    if (!chunks.some(c => c.type === 'acTL')) panic('the two-frame APNG has no acTL');

    const oneAnimation = await Animation.decode(oneApng);
    if (!(oneAnimation instanceof Animation) || oneAnimation.length !== 1) panic(`one-frame APNG with acTL: Animation.decode gives ${oneAnimation.constructor.name} with ${oneAnimation.length} frames`);
    if (sha256(oneAnimation.frames[0].bitmap) !== sha256((await Animation.decode(apng)).frames[0].bitmap)) panic('one-frame APNG with acTL: the frame differs from the first frame of the two-frame file');
    const oneImage = await decode(oneApng);
    if (oneImage instanceof Animation || !(oneImage instanceof Image)) panic('one-frame APNG with acTL: decode() should give an Image');
    if (sha256(oneImage.bitmap) !== sha256(oneAnimation.frames[0].bitmap)) panic('one-frame APNG with acTL: decode() pixels differ from Animation.decode');
})().catch(error => panic(error.stack || String(error)));
