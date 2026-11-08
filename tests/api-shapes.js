const {Image, Frame, Animation, GainMap, Colors} = require('..');

const assert = (condition, message) => {
    if (condition) return;
    console.error(message);
    process.exit(1);
};
const throws = (call, type, message) => {
    let error = null;
    try { call(); } catch (e) { error = e; }
    assert(error instanceof type, `${message}: should throw a ${type.name}, got ${error}`);
};

(async () => {
    const photo = () => new Image(40, 20).fill((x, y) => Colors.fromRGBA(x * 6, y * 12, 128, 255));

    // contain() pads to the box (transparent, or the background color); resize({ fit: 'inside' }) only resizes
    {
        const padded = photo().contain(30, 30);
        assert(padded.width === 30 && padded.height === 30, `contain: ${padded}`);
        assert(padded.getPixelAt(0, 0) === 0 && padded.getPixelAt(15, 15) >>> 0 !== 0, 'contain: transparent bars, the image in the middle');
        const black = photo().contain(30, 30, {background: 0x000000ff});
        assert(black.getPixelAt(0, 0) === 0x000000ff, 'contain: background color in the bars');
        const inside = photo().resize({width: 30, height: 30, fit: 'inside'});
        assert(inside.width === 30 && inside.height === 15, `resize fit inside: ${inside}`);
        const filled = photo().resize({width: 30, height: 30});
        assert(filled.width === 30 && filled.height === 30, 'resize: fill is the default');
        throws(() => photo().resize({width: 30, height: 30, fit: 'contain'}), TypeError, 'resize: unknown fit');
        throws(() => photo().contain(30, 30, {background: NaN}), RangeError, 'contain: NaN background');
        const frame = Frame.from(photo(), {xOffset: 10, yOffset: 4});
        frame.resize({width: 20, height: 20, fit: 'inside'});
        assert(frame.width === 20 && frame.height === 10 && frame.xOffset === 5 && frame.yOffset === 2, `Frame.resize fit inside: ${frame} ${frame.xOffset},${frame.yOffset}`);
    }

    // Frame duration and offsets are checked when they are set, and keep their value when the check fails
    {
        const frame = new Frame(4, 4, {duration: 50, xOffset: 1, yOffset: 2});
        throws(() => { frame.duration = -1; }, RangeError, 'frame.duration = -1');
        throws(() => { frame.duration = NaN; }, RangeError, 'frame.duration = NaN');
        throws(() => { frame.xOffset = Infinity; }, RangeError, 'frame.xOffset = Infinity');
        throws(() => { frame.yOffset = NaN; }, RangeError, 'frame.yOffset = NaN');
        assert(frame.duration === 50 && frame.xOffset === 1 && frame.yOffset === 2, 'frame: a failed set keeps the value');
        frame.duration = '40';
        assert(frame.duration === 40, 'frame.duration: numeric strings are converted');
        const copy = frame.clone();
        assert(copy.duration === 40 && copy.xOffset === 1 && copy.yOffset === 2, 'Frame.clone keeps duration and offsets');
    }

    // an animation's canvas: its own size once set, frames outside it are clipped when encoding
    {
        const red = Frame.from(new Image(10, 10).fill(0xff0000ff), {xOffset: 5, yOffset: 5});
        const auto = new Animation([red.clone()]);
        assert(auto.width === 15 && auto.height === 15, `auto canvas: ${auto}`);
        const sized = new Animation([red.clone()], {width: 30, height: 20});
        assert(sized.width === 30 && sized.height === 20, `canvas option: ${sized}`);
        throws(() => new Animation([], {width: 30}), TypeError, 'canvas: width without height');
        throws(() => new Animation([], {width: 0, height: 10}), RangeError, 'canvas: 0 wide');
        for (const encode of ['encodeGIF', 'encodeAPNG', 'encodeWebP']) {
            const decoded = await Animation.decode(await sized[encode]());
            assert(decoded.width === 30 && decoded.height === 20, `${encode}: the canvas should be kept, got ${decoded}`);
        }
        // a frame partly outside: only the part inside is encoded
        const over = new Animation([Frame.from(new Image(10, 10).fill(0x00ff00ff), {xOffset: 25, yOffset: 15}), Frame.from(new Image(2, 2).fill(0xff0000ff), {xOffset: 40, yOffset: 40})], {width: 30, height: 20});
        const back = await Animation.decode(await over.encodeAPNG({optimize: false}));
        assert(back.width === 30 && back.height === 20 && back.length === 2, `clipped frames: ${back} ${back.length}`);
        // (optimized, the empty second frame merges into the first)
        const merged = await Animation.decode(await over.encodeAPNG());
        assert(merged.length === 1 && merged.duration === 200, `clipped frames, optimized: ${merged} ${merged.length}`);
        assert(back.frames[0].getPixelAt(29, 19) === 0x00ff00ff && back.frames[0].getPixelAt(24, 19) === 0, 'clipped frames: the part inside the canvas');
        assert(over.frames[0].width === 10, 'encoding should not change the frames');
        // decoded animations keep the file's canvas, even when the frames would say otherwise
        const decoded = await Animation.decode(await sized.encodeGIF());
        decoded.frames[0].crop(0, 0, 5, 5);
        assert(decoded.width === 30 && decoded.height === 20, 'decoded canvas stays');
    }

    // Animation.clone, crop, contain, cover and resize({ fit: 'inside' })
    {
        const make = () => new Animation([
            Frame.from(new Image(20, 10).fill(0xff0000ff), {duration: 50}),
            Frame.from(new Image(10, 10).fill(0x0000ffff), {xOffset: 10, duration: 70})
        ], {width: 20, height: 10, loopCount: 3});
        const original = make(), copy = original.clone();
        copy.frames[0].fill(0x00ff00ff);
        copy.frames[1].xOffset = 0;
        assert(original.frames[0].getPixelAt(0, 0) === 0xff0000ff && original.frames[1].xOffset === 10, 'clone: independent frames');
        assert(copy.loopCount === 3 && copy.width === 20 && copy.height === 10 && copy.frames[1].duration === 70, 'clone: loop count, canvas, durations');

        const cropped = make().crop(5, 2, 10, 6);
        assert(cropped.width === 10 && cropped.height === 6, `crop: canvas ${cropped}`);
        assert(cropped.frames[0].width === 10 && cropped.frames[0].xOffset === 0 && cropped.frames[1].xOffset === 5 && cropped.frames[1].width === 5, 'crop: frames cut and moved');
        throws(() => make().crop(30, 0, 5, 5), RangeError, 'crop outside the canvas');

        const contained = make().contain(40, 40);
        assert(contained.width === 40 && contained.height === 40 && contained.frames[0].width === 40 && contained.frames[0].yOffset === 10, `contain: ${contained} ${contained.frames[0]} ${contained.frames[0].yOffset}`);
        const withBackground = make().contain(40, 40, {background: 0xffffffff});
        assert(withBackground.frames.every(f => f.width === 40 && f.height === 40 && f.getPixelAt(0, 0) === 0xffffffff), 'contain: background frames');
        assert(withBackground.frames[1].getPixelAt(30, 20) === 0x0000ffff && withBackground.frames[1].getPixelAt(5, 20) === 0xff0000ff, 'contain: background frames show the composited animation');
        assert(withBackground.frames.map(f => f.duration).join() === '50,70', 'contain: durations kept');

        const covered = make().cover(10, 10);
        assert(covered.width === 10 && covered.height === 10, `cover: ${covered}`);
        const inside = make().resize({width: 10, height: 10, fit: 'inside'});
        assert(inside.width === 10 && inside.height === 5, `Animation.resize fit inside: ${inside}`);
    }

    // GainMap parameters: min and max, checked on set, copies on get
    {
        const map = new GainMap(new Image(4, 4).fill(0x808080ff), {min: -1, max: [2, 3, 4]});
        assert(map.min.join() === '-1,-1,-1' && map.max.join() === '2,3,4' && map.hdrCapacityMax === 4, 'GainMap: min/max options');
        map.max[0] = 99;
        assert(map.max[0] === 2, 'GainMap: getters return copies');
        throws(() => { map.max = NaN; }, RangeError, 'GainMap max = NaN');
        throws(() => { map.min = [1, 2]; }, RangeError, 'GainMap min of 2 values');
        throws(() => { map.gamma = 0; }, RangeError, 'GainMap gamma = 0');
        throws(() => { map.hdrCapacityMin = -1; }, RangeError, 'GainMap hdrCapacityMin = -1');
        throws(() => { map.useBaseColorSpace = 1; }, TypeError, 'GainMap useBaseColorSpace = 1');
        assert(map.max.join() === '2,3,4' && map.gamma.join() === '1,1,1' && map.hdrCapacityMin === 0, 'GainMap: a failed set keeps the value');
        map.max = 5;
        assert(map.max.join() === '5,5,5', 'GainMap: one number for all channels');
    }

    // JPEG chroma subsampling: the default by quality, or as given
    {
        const image = photo().resize(160, 80);
        const at80 = await image.encodeJPEG({quality: 80, metadata: {creationTime: 0, software: ''}});
        const at80sub = await image.encodeJPEG({quality: 80, subsampling: '4:2:0', metadata: {creationTime: 0, software: ''}});
        const at80full = await image.encodeJPEG({quality: 80, subsampling: '4:4:4', metadata: {creationTime: 0, software: ''}});
        assert(Buffer.from(at80).equals(Buffer.from(at80sub)), 'JPEG: 4:2:0 is the default up to quality 90');
        assert(!Buffer.from(at80).equals(Buffer.from(at80full)), 'JPEG: 4:4:4 at quality 80');
        const at95 = await image.encodeJPEG({quality: 95, metadata: {creationTime: 0, software: ''}});
        const at95full = await image.encodeJPEG({quality: 95, subsampling: '4:4:4', metadata: {creationTime: 0, software: ''}});
        assert(Buffer.from(at95).equals(Buffer.from(at95full)), 'JPEG: 4:4:4 is the default above quality 90');
        let error = null;
        try { await image.encodeJPEG({subsampling: '4:2:2'}); } catch (e) { error = e; }
        assert(error instanceof TypeError, 'JPEG: unknown subsampling');
        const decoded = await Image.decode(at80full);
        assert(decoded.width === 160, 'JPEG 4:4:4 decodes');
    }

    // hues are in degrees; gradients take arrays
    {
        assert(Colors.fromHSL(120, 1, 0.5) === 0x00ff00ff && Colors.fromHSL(240, 1, 0.5) === 0x0000ffff && Colors.fromHSL(360, 1, 0.5) === 0xff0000ff, 'fromHSL: degrees');
        assert(Colors.fromHSLA(-120, 1, 0.5, 0.5) === 0x0000ff80, 'fromHSLA: negative degrees wrap');
        assert(Math.round(Colors.toHSLA(0x0000ffff)[0]) === 240, 'toHSLA: degrees');
        const gradient = Colors.gradient([0x000000ff, 0xffffffff]);
        assert(gradient(0) === 0x000000ff && gradient(1) === 0xffffffff && gradient(0.5) === 0x7f7f7fff, `gradient of an array: ${gradient(0.5).toString(16)}`);
        assert(Colors.gradient([0xff0000ff])(0.3) === 0xff0000ff, 'gradient of one color');
    }

    // renamed parameters and the American spelling
    {
        const gray = new Image(1, 1).fill(0xff0000ff).grayscale();
        assert(gray.getPixelAt(0, 0) === 0x4c4c4cff, `grayscale: ${gray.getPixelAt(0, 0).toString(16)}`);
        assert(new Image(1, 1).greyscale === undefined && new Image(1, 1).drawBox === undefined && new Image(1, 1).fit === undefined, 'removed methods');
    }
})();
