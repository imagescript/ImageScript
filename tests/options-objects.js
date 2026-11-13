const fs = require('fs').promises;
const {Image, Frame, Animation, GainMap, decode} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};

// the options of every method that takes them must be an object (or left out): a stray number, string, boolean or null,
// or positional values, is a call in a form that doesn't exist, so it throws a TypeError instead of being ignored
const refuses = async (label, call) => {
    let error = null;
    try { await call(); } catch (e) { error = e; }
    if (!(error instanceof TypeError)) panic(`${label}: should throw a TypeError, got ${error}`);
    return error;
};

const sameImage = (image, reference, label) => {
    if (image.width !== reference.width || image.height !== reference.height || !Buffer.from(image.bitmap).equals(Buffer.from(reference.bitmap)))
        panic(`${label}: the image should be unchanged`);
};

(async () => {
    const photo = new Image(20, 12).fill((x, y) => 0x336699ff + x * 0x01000000 + y * 0x00010000 >>> 0);
    const font = await fs.readFile('./tests/fonts/opensans bold.ttf');

    // resize, scale and the frames' resize take the sampling mode in the options only
    for (const [label, mode] of Object.entries({'a mode name': 'area', 'a string': 'bilinear', 'an unknown mode': 'Area', 'null': null})) {
        const image = photo.clone();
        await refuses(`resize(10, 6, ${label})`, () => image.resize(10, 6, mode));
        sameImage(image, photo, `resize(10, 6, ${label})`);
        const scaled = photo.clone();
        await refuses(`scale(0.5, ${label})`, () => scaled.scale(0.5, mode));
        sameImage(scaled, photo, `scale(0.5, ${label})`);
        const resizedFrame = new Frame(new Image(20, 12), {duration: 50});
        await refuses(`Frame.resize(10, 6, ${label})`, () => resizedFrame.resize(10, 6, mode));
        if (resizedFrame.width !== 20 || resizedFrame.height !== 12) panic(`Frame.resize(10, 6, ${label}): the frame should keep its size`);
        const animation = new Animation([new Frame(new Image(20, 12))]);
        await refuses(`Animation.resize(10, 6, ${label})`, () => animation.resize(10, 6, mode));
        if (animation.frames[0].width !== 20 || animation.frames[0].height !== 12) panic(`Animation.resize(10, 6, ${label}): the frames should keep their size`);
    }

    // the image operations take their values in the options object only
    const patch = new Image(2, 2).fill(0xff0000ff);
    const positional = {
        'composite(patch, 3, 4)': image => image.composite(patch, 3, 4),
        'composite(patch, 3)': image => image.composite(patch, 3),
        'composite(patch, 3, 4, { opacity: 0.5 })': image => image.composite(patch, 3, 4, {opacity: 0.5}),
        'trim(0xffffffff)': image => image.trim(0xffffffff),
        'trim(0xffffffff, { tolerance: 0.1 })': image => image.trim(0xffffffff, {tolerance: 0.1}),
        'colorToAlpha(0xffffffff)': image => image.colorToAlpha(0xffffffff),
        'colorToAlpha(0xffffffff, { opacityThreshold: 0.5 })': image => image.colorToAlpha(0xffffffff, {opacityThreshold: 0.5}),
        'sharpen(2, 3)': image => image.sharpen(2, 3),
        'sharpen(2)': image => image.sharpen(2),
        'dominantColor(true)': image => image.dominantColor(true),
        'dominantColor(true, false, 4)': image => image.dominantColor(true, false, 4),
        'rotate(45, false)': image => image.rotate(45, false),
        'rotate(45, true)': image => image.rotate(45, true),
        'roundCorners(3)': image => image.roundCorners(3),
        'fisheye(3)': image => image.fisheye(3)
    };
    for (const [label, call] of Object.entries(positional)) {
        const image = photo.clone();
        await refuses(label, () => call(image));
        sameImage(image, photo, label);
    }
    {
        const frame = new Frame(new Image(20, 12), {xOffset: 4, yOffset: 5});
        await refuses('Frame.trim(0xffffffff)', () => frame.trim(0xffffffff));
        if (frame.xOffset !== 4 || frame.yOffset !== 5 || frame.width !== 20) panic('Frame.trim(0xffffffff): the frame should be unchanged');
    }
    const solid = new Image(6, 6).fill(0xffffffff).composite(new Image(2, 2).fill(0x000000ff), {x: 2, y: 2});
    if (solid.clone().trim({color: 0xffffffff}).width !== 2) panic('trim({ color }) should trim the color');
    if (solid.clone().composite(patch, {x: 1, y: 1}).getPixelAt(1, 1) !== 0xff0000ff) panic('composite(patch, { x, y }) should place the patch');
    if (solid.clone().sharpen({amount: 0}).getPixelAt(2, 2) !== 0x000000ff) panic('sharpen({ amount: 0 }) should not change the pixels');
    if (solid.clone().roundCorners({radius: 0}).getPixelAt(0, 0) !== 0xffffffff) panic('roundCorners({ radius: 0 }) should not change the pixels');
    if (solid.clone().rotate(90, {expand: false}).width !== 6) panic('rotate(90, { expand: false })');

    // the encoders take their values in the options object only; the metadata goes in { metadata }
    const makeAnimation = () => new Animation([new Frame(new Image(4, 4))]);
    const gainMap = new GainMap(new Image(4, 4).fill(0x808080ff), {min: 0, max: 2});
    for (const [label, call] of Object.entries({
        'encodePNG(1)': () => photo.encodePNG(1),
        'encodePNG(1, { author })': () => photo.encodePNG(1, {author: 'me'}),
        'encodeJPEG(80)': () => photo.encodeJPEG(80),
        'encodeGIF(10)': () => makeAnimation().encodeGIF(10),
        'encodeAPNG(9)': () => makeAnimation().encodeAPNG(9),
        'GainMap.encodeJPEG(70)': () => gainMap.encodeJPEG(70)
    })) await refuses(label, call);
    if (!Buffer.from(await photo.encodePNG({compression: 1, metadata: {author: 'me'}})).includes('me')) panic('encodePNG({ metadata }): the metadata is missing');
    if (!(await photo.encodeJPEG({quality: 80})).length || !(await makeAnimation().encodeGIF({colors: 16})).length) panic('encoders with options');
    if (!(await gainMap.encodeJPEG({quality: 70})).length || !(await gainMap.encodeJPEG()).length) panic('GainMap.encodeJPEG with options');

    // renderSVG takes its size and mode in the options object only
    const svgSource = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>';
    for (const [label, call] of Object.entries({
        'renderSVG(svg, 2)': () => Image.renderSVG(svgSource, 2),
        'renderSVG(svg, 2, width)': () => Image.renderSVG(svgSource, 2, 'width'),
        'renderSVG(svg, width)': () => Image.renderSVG(svgSource, 'width')
    })) await refuses(label, call);
    if ((await Image.renderSVG(svgSource, {scale: 2})).width !== 20) panic('renderSVG(svg, { scale }) should scale');
    const byWidth = await Image.renderSVG(svgSource, {width: 30});
    if (byWidth.width !== 30 || byWidth.height !== 30) panic(`renderSVG(svg, { width }): ${byWidth.width}x${byWidth.height}`);

    // frames and animations take their duration, offsets, disposal mode and loop count in the options object only
    const frame = new Frame(new Image(4, 4), {duration: 40, xOffset: 2, yOffset: 3, disposalMode: 'background'});
    if (frame.duration !== 40 || frame.xOffset !== 2 || frame.yOffset !== 3 || frame.disposalMode !== 'background') panic('new Frame(new Image(width, height), options)');
    if (new Frame(photo.clone(), {duration: 40, xOffset: 2}).xOffset !== 2 || new Frame(photo.clone()).duration !== 100) panic('new Frame(image.clone(), options)');
    if (new Animation([new Frame(new Image(4, 4))], {loopCount: 2}).loopCount !== 2 || new Animation([new Frame(new Image(4, 4))]).loopCount !== Infinity) panic('new Animation(frames, options)');
    const encodedGIF = await makeAnimation().encodeGIF();
    if (!((await Image.decode(encodedGIF)) instanceof Image)) panic('Image.decode(data) should return the first frame as an Image');
    for (const [label, call] of Object.entries({
        'new Frame(new Image(4, 4), 100)': () => new Frame(new Image(4, 4), 100),
        'new Frame(new Image(4, 4), 100, 1, 1, "keep")': () => new Frame(new Image(4, 4), 100, 1, 1, 'keep'),
        'new Frame(photo.clone(), 100)': () => new Frame(photo.clone(), 100),
        'new Frame(photo.clone(), 100, 1, 1, "keep")': () => new Frame(photo.clone(), 100, 1, 1, 'keep'),
        'new Animation([frame], 2)': () => new Animation([frame], 2),
        'new Animation([frame], Infinity)': () => new Animation([frame], Infinity),
        'Animation.decode(gif, true)': () => Animation.decode(encodedGIF, true),
        'decode(gif, true)': () => decode(encodedGIF, true)
    })) await refuses(label, call);

    let nanError = null;
    try { photo.clone().resize(NaN, 6); } catch (e) { nanError = e; }
    if (!(nanError instanceof RangeError)) panic(`resize(NaN, 6) should throw a RangeError, got ${nanError}`);

    // the options form still resizes; undefined stays fine
    if (photo.clone().resize(10, 6, {mode: 'area'}).width !== 10) panic('resize(10, 6, { mode })');
    if (photo.clone().resize(10, 6).height !== 6) panic('resize(10, 6)');
    if (photo.clone().resize(10, 6, undefined).height !== 6) panic('resize(10, 6, undefined)');
    if (photo.clone().scale(0.5, {mode: 'area'}).width !== 10) panic('scale(0.5, { mode })');
    if (photo.clone().resize({width: 10, height: 10, fit: 'inside', mode: 'area'}).width !== 10) panic('resize({ width, height, fit: \'inside\', mode })');
    if (photo.clone().resize({width: 10, height: 10, fit: 'contain', mode: 'area'}).height !== 10) panic('resize({ fit: \'contain\', mode })');
    if (photo.clone().resize({width: 10, height: 10, fit: 'cover', mode: 'area'}).width !== 10) panic('resize({ fit: \'cover\', mode })');
    if (new Frame(new Image(20, 12)).resize(10, 6, {mode: 'area'}).width !== 10) panic('Frame.resize(10, 6, { mode })');
    if (new Animation([new Frame(new Image(20, 12))]).resize(10, 6, {mode: 'area'}).frames[0].width !== 10) panic('Animation.resize(10, 6, { mode })');

    // cropCircle takes its size and feathering in the options object only
    for (const [label, bad] of Object.entries({'true': true, 'false': false, 'a number': 0.5, 'a string': 'cover', 'null': null, 'a typed array': new Uint8Array(2)})) {
        const image = photo.clone();
        await refuses(`cropCircle(${label})`, () => image.cropCircle(bad));
        sameImage(image, photo, `cropCircle(${label})`);
    }
    for (const fine of [undefined, {}, {size: 'cover'}, {size: 'contain', feathering: 0.1}]) photo.clone().cropCircle(fine);
    await refuses('cropCircle with an unknown size', () => photo.clone().cropCircle({size: 'huge'}));

    // renderText(text, { font, size, ... }) is the only form: the font first is refused too
    const ok = await Image.renderText('Hi', {font, size: 24});
    if (ok.width < 4 || ok.height < 4) panic(`renderText: ${ok.width}x${ok.height}`);
    for (const [label, call] of Object.entries({
        'the font first': () => Image.renderText(font, 32, 'Hi'),
        'no options': () => Image.renderText('Hi'),
        'null options': () => Image.renderText('Hi', null),
        'a size instead of options': () => Image.renderText('Hi', 32),
        'a number as the text': () => Image.renderText(5, {font, size: 10})
    })) await refuses(`renderText with ${label}`, call);
    await refuses('renderText without a font', () => Image.renderText('Hi', {size: 10}));

    // the methods that only take options, with every value that isn't one
    const still = new Frame(photo.clone());
    const calls = {
        'quantize': bad => photo.clone().quantize(bad),
        'transform': bad => photo.clone().transform([1, 0, 0, 1, 0, 0], bad),
        'dropShadow': bad => photo.clone().dropShadow(bad),
        'outline': bad => photo.clone().outline(bad),
        'Image.linearGradient': bad => Image.linearGradient(8, 8, bad),
        'Image.radialGradient': bad => Image.radialGradient(8, 8, bad),
        'Image.decode': async bad => Image.decode(await photo.encodePNG(), bad),
        'encodeWebP': bad => photo.encodeWebP(bad),
        'encodeAVIF': bad => photo.encodeAVIF(bad),
        'encodeJXL': bad => photo.encodeJXL(bad),
        'encodeTGA': bad => photo.encodeTGA(bad),
        'Animation.encodeWebP': bad => new Animation([still]).encodeWebP(bad),
        'Animation.webpEncoder': bad => Animation.webpEncoder(8, 8, bad),
        'Animation.gifEncoder': bad => Animation.gifEncoder(8, 8, bad),
        'Animation.apngEncoder': bad => Animation.apngEncoder(8, 8, bad),
        'AnimationEncoder.add': async bad => { const encoder = Animation.gifEncoder(20, 12); await encoder.add(photo, bad); },
        'new GainMap': bad => new GainMap(new Image(2, 2), bad)
    };
    for (const [name, call] of Object.entries(calls))
        for (const [label, bad] of Object.entries({'a number': 80, 'a string': 'fast', 'true': true, 'null': null}))
            await refuses(`${name}(${label})`, () => call(bad));

    // refused calls leave the image as it was
    const image = photo.clone();
    for (const [label, call] of Object.entries({
        'quantize(16)': () => image.quantize(16),
        'dropShadow(8)': () => image.dropShadow(8),
        'outline(2)': () => image.outline(2),
        'transform(..., "bicubic")': () => image.transform([1, 0, 0, 1, 0, 0], 'bicubic')
    })) await refuses(label, call);
    sameImage(image, photo, 'a refused call');

    // the options forms (and no options at all) still work
    photo.clone().quantize().quantize({colors: 4});
    photo.clone().dropShadow().outline({width: 1});
    if ((await photo.encodeWebP({quality: 50})).length < 10 || (await photo.encodeWebP()).length < 10) panic('encodeWebP with and without options');
    if (new GainMap(new Image(4, 3).fill(0x808080ff), {max: 2}).width !== 4) panic('GainMap options');
})().catch(error => panic(error.stack || String(error)));
