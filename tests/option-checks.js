const {Image, Frame, Animation, LimitError} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};

// invalid options throw a RangeError (or TypeError), before any work, instead of failing somewhere inside
// an encoder or being ignored
const rejects = async (name, fn, Type) => {
    try {
        await fn();
    } catch (error) {
        if (!(error instanceof Type)) panic(`${name}: wrong error ${error?.constructor?.name}: ${error?.message}`);
        return;
    }
    panic(`${name}: accepted`);
};

(async () => {
    const image = new Image(8, 8).fill(0x336699ff);
    const animation = () => new Animation([new Frame(new Image(8, 8).fill(0xff0000ff), {duration: 100}), new Frame(new Image(8, 8).fill(0x00ff00ff), {duration: 100})]);
    const encoded = async (encoder, options) => {
        await encoder.add(new Frame(new Image(8, 8).fill(0xff0000ff)), options);
        return encoder.finish();
    };

    for (const effort of [-1, 3, 1.5, NaN, '1', null]) {
        // (what isn't a number is a TypeError)
        const type = typeof effort === 'number' ? RangeError : TypeError;
        await rejects(`encodeAVIF effort ${effort}`, () => image.encodeAVIF({effort}), type);
        await rejects(`encodeJXL effort ${effort}`, () => image.encodeJXL({effort}), type);
    }
    for (const effort of [-1, 7, 1.5, NaN]) {
        // (lossless WebP doesn't use it, but checks it)
        await rejects(`encodeWebP lossless effort ${effort}`, () => image.encodeWebP({effort}), RangeError);
        await rejects(`encodeWebP effort ${effort}`, () => image.encodeWebP({quality: 80, effort}), RangeError);
        await rejects(`Animation.encodeWebP effort ${effort}`, () => animation().encodeWebP({effort}), RangeError);
        await rejects(`webpEncoder effort ${effort}`, () => encoded(Animation.webpEncoder(8, 8, {effort})), RangeError);
    }
    // (out-of-range JPEG qualities throw, they aren't clamped)
    for (const quality of [-5, 101, 1000, NaN, Infinity]) {
        await rejects(`encodeJPEG quality ${quality}`, () => image.encodeJPEG({quality}), RangeError);
    }
    for (const quality of [0, 1, 100]) await image.encodeJPEG({quality});
    for (const quality of [-1, 101, NaN]) {
        await rejects(`encodeAVIF quality ${quality}`, () => image.encodeAVIF({quality}), RangeError);
        await rejects(`encodeAVIF alphaQuality ${quality}`, () => image.encodeAVIF({alphaQuality: quality}), RangeError);
    }
    for (const subsampling of ['4:2:2', '', null])
        await rejects(`encodeAVIF subsampling ${subsampling}`, () => image.encodeAVIF({subsampling}), TypeError);

    // GIF quality and APNG compression are clamped (like PNG's), but have to be numbers
    await rejects('encodeGIF colors NaN', () => animation().encodeGIF({colors: NaN}), RangeError);
    await rejects('gifEncoder colors NaN', () => encoded(Animation.gifEncoder(8, 8, {colors: NaN})), RangeError);
    await rejects('encodeGIF colors 1', () => animation().encodeGIF({colors: 1}), RangeError);
    await rejects('encodeGIF dither', () => animation().encodeGIF({dither: 'random'}), TypeError);
    await rejects('encodeAPNG compression NaN', () => animation().encodeAPNG({compression: NaN}), RangeError);
    await rejects('apngEncoder compression NaN', () => encoded(Animation.apngEncoder(8, 8, {compression: NaN})), RangeError);
    await rejects('encodeAPNG compression 12', () => animation().encodeAPNG({compression: 12}), RangeError);

    await rejects('Animation loopCount 1.5', () => new Animation([new Frame(new Image(8, 8))], {loopCount: 1.5}), RangeError);
    await rejects('dominantColor threshold NaN', () => image.dominantColor({threshold: NaN}), RangeError);
    await rejects('renderSVG scale NaN', () => Image.renderSVG('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>', {scale: NaN}), RangeError);
    await rejects('renderSVG maxPixels 0', () => Image.renderSVG('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>', {maxPixels: 0}), RangeError);
    await rejects('renderSVG maxPixels names the render options', () => Image.renderSVG('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>', {maxPixels: 15}), LimitError);
    await rejects('renderSVG maxPixels exceeded', () => Image.renderSVG('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>', {maxPixels: 15}), RangeError);
    if ((await Image.renderSVG('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>', {maxPixels: 16})).width !== 4)
        panic('renderSVG: maxPixels should allow an output that fits');
    await rejects('renderText size -1', () => Image.renderText('x', { font: new Uint8Array(0), size: -1 }), RangeError);
    if (new Image(2.9, 1).width !== 2) panic('Image constructor: fractional dimensions should still be truncated');
    await rejects('Image width wraps to small positive dimension', () => new Image(2 ** 32 + 2, 1), RangeError);
    const png = await image.encodePNG();
    for (const maxPixels of [NaN, -1, 0]) {
        await rejects(`Image.decode maxPixels ${maxPixels}`, () => Image.decode(png, {maxPixels}), RangeError);
        await rejects(`Animation.decode maxPixels ${maxPixels}`, () => Animation.decode(png, {maxPixels}), RangeError);
    }
    await rejects('Animation.decode threads 0', () => Animation.decode(png, {threads: 0}), RangeError);
    // (the shared checks of the limits and of threads: every option that takes one says so by its name)
    {
        const map = await new Image(8, 8).fill(0x808080ff).encodeJPEG();
        for (const bad of [0, -1, NaN]) await rejects(`GainMap.decode maxPixels ${bad}`, () => require('..').GainMap.decode(map, {maxPixels: bad}), RangeError);
        for (const threads of [0, -1, 1.5, NaN])
            for (const [name, call] of Object.entries({'Image.decode': () => Image.decode(png, {threads}), 'encodeWebP': () => image.encodeWebP({threads}), 'encodeAVIF': () => image.encodeAVIF({threads}), 'encodeJXL': () => image.encodeJXL({threads})}))
                await rejects(`${name} threads ${threads}`, call, RangeError);
    }

    // a value outside a fixed set of choices is a TypeError
    await rejects('resize mode', () => image.clone().resize(4, 4, {mode: 'lanczos'}), TypeError);
    await rejects('scale mode', () => image.clone().scale(2, {mode: 'lanczos'}), TypeError);
    await rejects('blend mode', () => image.clone().composite(image, {mode: 'nope'}), TypeError);
    for (const source of [undefined, null, {}, 5, new Frame(image)]) await rejects(`composite source ${String(source)}`, () => image.clone().composite(source), TypeError);

    // scale() doesn't shrink a side below one pixel, like resize({ width }) keeping the aspect ratio
    {
        const thin = new Image(7, 1).scale(0.5);
        if (thin.width !== 3 || thin.height !== 1) panic(`new Image(7, 1).scale(0.5) is ${thin.width}x${thin.height}`);
        const tiny = new Image(10, 3).scale(0.01);
        if (tiny.width !== 1 || tiny.height !== 1) panic(`scale(0.01) is ${tiny.width}x${tiny.height}`);
        for (const factor of [0, -1, NaN]) await rejects(`scale(${factor})`, () => image.clone().scale(factor), RangeError);
    }
    await rejects('flip direction', () => image.clone().flip('diagonal'), TypeError);
    await rejects('disposal mode', () => new Frame(image, {disposalMode: 'none'}), TypeError);
    await rejects('wrapStyle', () => Image.renderText('hi', {font: new Uint8Array(4), size: 8, wrapStyle: 'line'}), TypeError);
    // (an invalid mode is found before anything changes: a frame's offsets stay)
    {
        const frame = new Frame(new Image(100, 50), {xOffset: 10, yOffset: 10});
        await rejects('cover mode', () => frame.resize({width: 20, height: 20, fit: 'cover', mode: 'lanczos'}), TypeError);
        if (frame.xOffset !== 10 || frame.yOffset !== 10 || frame.width !== 100) panic('an invalid cover mode moved the frame');
    }

    // compression levels are integers 0-9, like efforts (out of range ones aren't clamped)
    for (const compression of [-1, 10, 99, 4.5, NaN, '4', null]) {
        const type = typeof compression === 'number' ? RangeError : TypeError;
        await rejects(`encodePNG compression ${compression}`, () => image.encodePNG({compression}), type);
        await rejects(`encodeAPNG compression ${compression}`, () => animation().encodeAPNG({compression}), type);
    }

    // colors are integers from -2^31 (what bitwise operators return) to 2^32 - 1: others throw instead of wrapping
    for (const color of [2 ** 32, 2 ** 32 + 5, -(2 ** 31) - 1, 1.5, NaN, Infinity]) {
        await rejects(`setPixelAt color ${color}`, () => image.clone().setPixelAt(0, 0, color), RangeError);
        await rejects(`fill color ${color}`, () => image.clone().fill(color), RangeError);
        await rejects(`fill function color ${color}`, () => image.clone().fill(() => color), RangeError);
    }
    // values that do nothing useful throw: a negative radius, a fisheye strength that leaves an empty image
    await rejects('roundCorners radius -1', () => image.clone().roundCorners({radius: -1}), RangeError);
    await rejects('fisheye strength -1', () => image.clone().fisheye({strength: -1}), RangeError);
    await rejects('fisheye strength 0', () => image.clone().fisheye({strength: 0}), RangeError);
    image.clone().roundCorners({radius: 0});
    image.clone().roundCorners({radius: 1e6});
    await rejects('fill function without a color', () => image.clone().fill(() => undefined), TypeError);
    if (new Image(1, 1).setPixelAt(0, 0, 0xff << 24 | 0xff).getPixelAt(0, 0) !== 0xff0000ff) panic('a negative (signed) color should be read as unsigned');
    if (new Image(1, 1).fill(-1).getPixelAt(0, 0) !== 0xffffffff) panic('fill(-1) should be white');

    // coordinates are truncated like sizes, without wrapping around at 2^32
    await rejects('getPixelAt 2^32', () => image.getPixelAt(2 ** 32, 0), RangeError);
    await rejects('setPixelAt 2^32 + 1', () => image.clone().setPixelAt(2 ** 32 + 1, 0, 0), RangeError);
    {
        const canvas = new Image(4, 1);
        canvas.composite(new Image(1, 1).fill(0xffffffff), {x: 2 ** 32 + 1});
        if (canvas.getPixelAt(1, 0) !== 0) panic('composite at x = 2^32 + 1 drew at x = 1');
        await rejects('crop at 2^32', () => new Image(4, 4).crop(2 ** 32, 0, 2, 2), RangeError);
    }

    // a gradient position that isn't a number throws, whatever the number of stops; stops at one position are an edge
    {
        const {Colors} = require('..');
        await rejects('gradient of 2 at NaN', () => Colors.gradient([0xff0000ff, 0x0000ffff])(NaN), RangeError);
        await rejects('gradient of 3 at NaN', () => Colors.gradient([0xff0000ff, 0x00ff00ff, 0x0000ffff])(NaN), RangeError);
        await rejects('gradient of 1 at NaN', () => Colors.gradient([0xff0000ff])(NaN), RangeError);

        // colors blend premultiplied, like CSS: what fades out leaves no dark color behind
        const fade = Colors.gradient([0x00000000, 0xff0000ff]);
        const [fr, fg, fb, fa] = Colors.toRGBA(fade(0.5));
        if (fr !== 255 || fg !== 0 || fb !== 0 || Math.abs(fa - 127.5) > 1) panic(`transparent to red at the middle: ${[fr, fg, fb, fa]}, CSS gives 255,0,0,~128`);
        if (fade(0) !== 0 || fade(1) !== 0xff0000ff) panic('a gradient should start and end with its colors');
        const [gr, gg, gb] = Colors.toRGBA(Colors.gradient([0xff0000ff, 0x0000ff00])(0.5));
        if (gr !== 255 || gg !== 0 || gb !== 0) panic(`red to transparent blue at the middle: ${[gr, gg, gb]}, the invisible end shouldn't tint it`);
        if (Colors.gradient([0xff0000ff, 0x0000ffff])(0.5) !== 0x7f007fff) panic('opaque colors blend as they did');
        const edge = Colors.gradient({0: 0xff0000ff, 0.5: 0x00ff00ff, '0.50': 0x0000ffff, 1: 0xffffffff});
        if ([0.25, 0.5, 0.75].some(p => Number.isNaN(edge(p)))) panic('a gradient with two stops at one position');
        const single = Colors.gradient({0.5: 0xff0000ff, '0.50': 0x00ff00ff, '5e-1': 0x0000ffff});
        if (single(0.2) !== 0xff0000ff || single(0.8) !== 0x0000ffff) panic('a gradient with all stops at one position');
    }

    // bitmaps are used without copying, so they have to start at a byte offset divisible by 4
    {
        const target = new Image(2, 2);
        await rejects('unaligned bitmap', () => { target.bitmap = new Uint8Array(17).subarray(1); }, TypeError);
        const aligned = new Uint8Array(20).subarray(4);
        target.bitmap = aligned;
        aligned[0] = 7;
        if (target.bitmap[0] !== 7) panic('an aligned bitmap should be used without copying');
    }

    // frame offsets are truncated to integers, like image sizes
    {
        const frame = new Frame(new Image(1, 1), {xOffset: 2.7, yOffset: -0.5});
        if (frame.xOffset !== 2 || !Object.is(frame.yOffset, 0)) panic(`frame offsets should be truncated, got ${frame.xOffset}, ${frame.yOffset}`);
        frame.xOffset = -3.9;
        if (frame.xOffset !== -3) panic(`frame.xOffset = -3.9 should be -3, got ${frame.xOffset}`);
    }

    // frame durations a format can't store throw, like loop counts (and frames merged for being unchanged are split)
    {
        const long = duration => new Animation([new Frame(new Image(2, 2).fill(0xff0000ff), {duration})]);
        for (const [format, max] of [['GIF', 655350], ['APNG', 655350], ['WebP', 0xffffff]]) {
            await rejects(`encode${format} duration ${max + 1}`, () => long(max + 1)[`encode${format}`](), RangeError);
            await rejects(`${format} encoder duration ${max + 1}`, () => encoded(Animation[`${format.toLowerCase()}Encoder`](8, 8, {}), {duration: max + 1}), RangeError);
            await long(max)[`encode${format}`]();
            const frames = () => [1, 2, 3].map(() => new Frame(new Image(2, 2).fill(0xff0000ff), {duration: 400000}));
            const decoded = await Animation.decode(await new Animation(frames())[`encode${format}`]());
            if (decoded.duration !== 1200000 || decoded.frames.some(f => f.duration > max)) panic(`${format}: merged frames should be split at the limit, got ${decoded.frames.map(f => f.duration)}`);
        }
        await rejects('encodeGIF without frames', () => new Animation([]).encodeGIF(), Error);
    }

    // a shadow or outline too large for an image fails with a LimitError, before it allocates
    {
        const {LimitError} = require('..');
        const small = new Image(10, 10).fill(0xff0000ff);
        await rejects('dropShadow blur 1e5', () => small.clone().dropShadow({blur: 1e5}), LimitError);
        await rejects('dropShadow x 1e9', () => small.clone().dropShadow({x: 1e9}), LimitError);
        await rejects('outline width 1e5', () => small.clone().outline({width: 1e5}), LimitError);
    }

    // a canvas the format can't store throws instead of wrapping (GIF stores 16 bits, an empty one has nothing to store)
    {
        const wide = new Animation([new Frame(new Image(2, 1).fill(0xff0000ff))], {width: 70000, height: 1});
        await rejects('encodeGIF canvas 70000 wide', () => wide.encodeGIF(), RangeError);
        await rejects('gifEncoder canvas 70000 wide', () => encoded(Animation.gifEncoder(70000, 1)), RangeError);
        const empty = new Animation([new Frame(new Image(4, 4).fill(0xff0000ff), {xOffset: -10, yOffset: -10})]);
        for (const format of ['GIF', 'APNG', 'WebP']) await rejects(`encode${format} canvas without area`, () => empty[`encode${format}`](), RangeError);
        const decoded = await Animation.decode(await wide.clone().resize(65535, 1).encodeGIF());
        if (decoded.width !== 65535) panic(`GIF at the largest canvas: width ${decoded.width}`);
    }

    // valid values keep working
    for (const effort of [0, 1, 2]) await image.encodeAVIF({effort});
    for (const subsampling of ['4:4:4', '4:2:0']) await image.encodeAVIF({quality: 50, subsampling});
    await image.encodeWebP({effort: 6});
    await Image.decode(png, {maxPixels: Infinity});
})();
