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
})().catch(error => panic(error.stack || String(error)));
