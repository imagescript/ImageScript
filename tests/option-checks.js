const {Image, Frame, Animation} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};

// invalid options throw a RangeError (or TypeError) naming them, before any work, instead of failing somewhere inside
// an encoder or being ignored
const rejects = async (name, fn, Type, pattern) => {
    try {
        await fn();
    } catch (error) {
        if (!(error instanceof Type) || !pattern.test(error.message)) panic(`${name}: wrong error ${error?.constructor?.name}: ${error?.message}`);
        return;
    }
    panic(`${name}: accepted`);
};

(async () => {
    const image = new Image(8, 8).fill(0x336699ff);
    const animation = () => new Animation([new Frame(8, 8, {duration: 100}).fill(0xff0000ff), new Frame(8, 8, {duration: 100}).fill(0x00ff00ff)]);
    const encoded = async (encoder) => {
        await encoder.add(new Frame(8, 8).fill(0xff0000ff));
        return encoder.finish();
    };

    for (const effort of [-1, 3, 1.5, NaN, '1', null]) {
        await rejects(`encodeAVIF effort ${effort}`, () => image.encodeAVIF({effort}), RangeError, /effort must be an integer 0-2/);
        await rejects(`encodeJXL effort ${effort}`, () => image.encodeJXL({effort}), RangeError, /effort must be an integer 0-2/);
    }
    for (const effort of [-1, 7, 1.5, NaN]) {
        // (lossless WebP doesn't use it, but checks it)
        await rejects(`encodeWebP lossless effort ${effort}`, () => image.encodeWebP({effort}), RangeError, /effort must be an integer 0-6/);
        await rejects(`encodeWebP effort ${effort}`, () => image.encodeWebP({quality: 80, effort}), RangeError, /effort must be an integer 0-6/);
        await rejects(`Animation.encodeWebP effort ${effort}`, () => animation().encodeWebP({effort}), RangeError, /effort must be an integer 0-6/);
        await rejects(`webpEncoder effort ${effort}`, () => encoded(Animation.webpEncoder(8, 8, {effort})), RangeError, /effort must be an integer 0-6/);
    }
    for (const quality of [-1, 101, NaN]) {
        await rejects(`encodeAVIF quality ${quality}`, () => image.encodeAVIF({quality}), RangeError, /quality/);
        await rejects(`encodeAVIF alphaQuality ${quality}`, () => image.encodeAVIF({alphaQuality: quality}), RangeError, /alphaQuality/);
    }
    for (const subsampling of ['4:2:2', '', null])
        await rejects(`encodeAVIF subsampling ${subsampling}`, () => image.encodeAVIF({subsampling}), TypeError, /subsampling must be/);

    // GIF quality and APNG compression are clamped (like PNG's), but have to be numbers
    await rejects('encodeGIF quality NaN', () => animation().encodeGIF({quality: NaN}), RangeError, /quality/);
    await rejects('gifEncoder quality NaN', () => encoded(Animation.gifEncoder(8, 8, {quality: NaN})), RangeError, /quality/);
    await rejects('encodeAPNG compression NaN', () => animation().encodeAPNG({compression: NaN}), RangeError, /compression level/);
    await rejects('apngEncoder compression NaN', () => encoded(Animation.apngEncoder(8, 8, {compression: NaN})), RangeError, /compression level/);
    if (!(await animation().encodeGIF({quality: 1000})).length || !(await animation().encodeAPNG({compression: 12})).length) panic('clamped values rejected');

    await rejects('Animation loopCount 1.5', () => new Animation([new Frame(8, 8)], {loopCount: 1.5}), RangeError, /loop count/);
    await rejects('dominantColor threshold NaN', () => image.dominantColor({threshold: NaN}), RangeError, /threshold/);
    await rejects('renderSVG size NaN', () => Image.renderSVG('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>', {size: NaN}), RangeError, /SVG size/);
    await rejects('renderText size -1', () => Image.renderText(new Uint8Array(0), -1, 'x'), RangeError, /font size/);
    const png = await image.encodePNG();
    for (const maxPixels of [NaN, -1, 0]) {
        await rejects(`Image.decode maxPixels ${maxPixels}`, () => Image.decode(png, {maxPixels}), RangeError, /maxPixels/);
        await rejects(`Animation.decode maxPixels ${maxPixels}`, () => Animation.decode(png, {maxPixels}), RangeError, /maxPixels/);
    }
    await rejects('Animation.decode threads 0', () => Animation.decode(png, {threads: 0}), RangeError, /threads must be/);

    // GIFs are refused by Image.decode() with a hint at Animation.decode()
    const gif = await new Animation([new Frame(4, 4).fill(0xff0000ff)]).encodeGIF();
    await rejects('Image.decode GIF', () => Image.decode(gif), Error, /Animation\.decode\(\)/);

    // valid values keep working
    for (const effort of [0, 1, 2]) await image.encodeAVIF({effort});
    for (const subsampling of ['4:4:4', '4:2:0']) await image.encodeAVIF({quality: 50, subsampling});
    await image.encodeWebP({effort: 6});
    await Image.decode(png, {maxPixels: Infinity});
})();
