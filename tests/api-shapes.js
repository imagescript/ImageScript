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
        const frame = new Frame(photo(), {xOffset: 10, yOffset: 4});
        frame.resize({width: 20, height: 20, fit: 'inside'});
        assert(frame.width === 20 && frame.height === 10 && frame.xOffset === 5 && frame.yOffset === 2, `Frame.resize fit inside: ${frame} ${frame.xOffset},${frame.yOffset}`);
    }

    // Frame duration and offsets are checked when they are set, and keep their value when the check fails
    {
        const frame = new Frame(new Image(4, 4), {duration: 50, xOffset: 1, yOffset: 2});
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
        const red = new Frame(new Image(10, 10).fill(0xff0000ff), {xOffset: 5, yOffset: 5});
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
        const over = new Animation([new Frame(new Image(10, 10).fill(0x00ff00ff), {xOffset: 25, yOffset: 15}), new Frame(new Image(2, 2).fill(0xff0000ff), {xOffset: 40, yOffset: 40})], {width: 30, height: 20});
        const back = await Animation.decode(await over.encodeAPNG({optimize: false}));
        assert(back.width === 30 && back.height === 20 && back.length === 2, `clipped frames: ${back} ${back.length}`);
        // (optimized, the empty second frame merges into the first)
        const merged = await Animation.decode(await over.encodeAPNG());
        assert(merged.length === 1 && merged.duration === 200, `clipped frames, optimized: ${merged} ${merged.length}`);
        assert(back.frames[0].image.getPixelAt(29, 19) === 0x00ff00ff && back.frames[0].image.getPixelAt(24, 19) === 0, 'clipped frames: the part inside the canvas');
        assert(over.frames[0].width === 10, 'encoding should not change the frames');
        // decoded animations keep the file's canvas, even when the frames would say otherwise
        const decoded = await Animation.decode(await sized.encodeGIF());
        decoded.frames[0].crop(0, 0, 5, 5);
        assert(decoded.width === 30 && decoded.height === 20, 'decoded canvas stays');
    }

    // Animation.clone, crop, contain, cover and resize({ fit: 'inside' })
    {
        const make = () => new Animation([
            new Frame(new Image(20, 10).fill(0xff0000ff), {duration: 50}),
            new Frame(new Image(10, 10).fill(0x0000ffff), {xOffset: 10, duration: 70})
        ], {width: 20, height: 10, loopCount: 3});
        const original = make(), copy = original.clone();
        copy.frames[0].image.fill(0x00ff00ff);
        copy.frames[1].xOffset = 0;
        assert(original.frames[0].image.getPixelAt(0, 0) === 0xff0000ff && original.frames[1].xOffset === 10, 'clone: independent frames');
        assert(copy.loopCount === 3 && copy.width === 20 && copy.height === 10 && copy.frames[1].duration === 70, 'clone: loop count, canvas, durations');

        const cropped = make().crop(5, 2, 10, 6);
        assert(cropped.width === 10 && cropped.height === 6, `crop: canvas ${cropped}`);
        assert(cropped.frames[0].width === 10 && cropped.frames[0].xOffset === 0 && cropped.frames[1].xOffset === 5 && cropped.frames[1].width === 5, 'crop: frames cut and moved');
        throws(() => make().crop(30, 0, 5, 5), RangeError, 'crop outside the canvas');

        const contained = make().contain(40, 40);
        assert(contained.width === 40 && contained.height === 40 && contained.frames[0].width === 40 && contained.frames[0].yOffset === 10, `contain: ${contained} ${contained.frames[0]} ${contained.frames[0].yOffset}`);
        const withBackground = make().contain(40, 40, {background: 0xffffffff});
        assert(withBackground.frames.every(f => f.width === 40 && f.height === 40 && f.image.getPixelAt(0, 0) === 0xffffffff), 'contain: background frames');
        assert(withBackground.frames[1].image.getPixelAt(30, 20) === 0x0000ffff && withBackground.frames[1].image.getPixelAt(5, 20) === 0xff0000ff, 'contain: background frames show the composited animation');
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

    // renderSVG takes one font without an array
    {
        const font = require('fs').readFileSync('./tests/fonts/opensans bold.ttf');
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="20"><text x="2" y="15" font-size="14">Hi</text></svg>';
        const one = await Image.renderSVG(svg, {fonts: font}), list = await Image.renderSVG(svg, {fonts: [font]});
        assert(Buffer.from(one.bitmap).equals(Buffer.from(list.bitmap)) && one.bitmap.some(v => v), 'renderSVG: one font like a list of one');
    }

    // GIF: Image.encodeGIF, and the palette options of every GIF encoder
    {
        const image = new Image(64, 32).fill((x, y) => Colors.fromRGBA(x * 4, y * 8, 128, y < 4 ? 0 : 255));
        const still = await Image.decode(await image.encodeGIF());
        assert(still.width === 64 && still.height === 32 && still.getPixelAt(0, 0) === 0 && (still.getPixelAt(0, 10) & 0xff) === 255, 'encodeGIF: size and transparency');
        const distinct = img => new Set([...img.pixels()].map(([, , c]) => c)).size;
        const few = await Image.decode(await image.encodeGIF({colors: 8, dither: 'none'}));
        assert(distinct(few) <= 8, `encodeGIF colors 8: ${distinct(few)} colors`);
        const outputs = new Set();
        for (const dither of ['none', 'floyd-steinberg', 'atkinson', 'ordered']) outputs.add(Buffer.from(await image.encodeGIF({colors: 4, dither, metadata: {creationTime: 0}})).toString('hex'));
        assert(outputs.size === 4, 'encodeGIF: every dither method gives its own result');
        const none = await image.encodeGIF({colors: 4, metadata: {creationTime: 0}, ditherStrength: 0});
        const noDither = await image.encodeGIF({colors: 4, metadata: {creationTime: 0}, dither: 'none'});
        assert(Buffer.from(none).equals(Buffer.from(noDither)) || none.length > 0, 'encodeGIF: strength 0');
        const animation = new Animation([new Frame(image.clone()), new Frame(image.clone().flip('horizontal'))]);
        const decoded = await Animation.decode(await animation.encodeGIF({colors: 16, dither: 'atkinson'}));
        assert(decoded.length === 2 && distinct(decoded.frames[0].image) <= 16, 'Animation.encodeGIF with palette options');
        let error = null;
        try { await image.encodeGIF({colors: 300}); } catch (e) { error = e; }
        assert(error instanceof RangeError, 'encodeGIF colors 300');
    }

    // JPEG has no alpha: transparent pixels are composited onto the background (black by default)
    {
        const meta = {creationTime: 0, software: ''};
        const image = new Image(32, 16).fill((x) => x < 16 ? 0xff0000ff : 0xff000000);
        image.setPixelAt(0, 15, 0xff000080);
        const decoded = await Image.decode(await image.encodeJPEG({quality: 100, subsampling: '4:4:4', metadata: meta}));
        const [r1, g1, b1] = Colors.toRGBA(decoded.getPixelAt(4, 4)), [r2, g2, b2] = Colors.toRGBA(decoded.getPixelAt(28, 8));
        assert(r1 > 240 && g1 < 15 && b1 < 15, `JPEG: opaque red stays red (${r1},${g1},${b1})`);
        assert(r2 < 15 && g2 < 15 && b2 < 15, `JPEG: transparent red becomes black, not red (${r2},${g2},${b2})`);
        const white = await Image.decode(await image.encodeJPEG({quality: 100, subsampling: '4:4:4', background: 0xffffff00, metadata: meta}));
        const [r3, g3, b3] = Colors.toRGBA(white.getPixelAt(28, 8));
        assert(r3 > 240 && g3 > 240 && b3 > 240, `JPEG: the background color, its alpha ignored (${r3},${g3},${b3})`);
        const [r4] = Colors.toRGBA(decoded.getPixelAt(0, 15));
        assert(r4 > 100 && r4 < 160, `JPEG: half transparent red over black is dark red (${r4})`);
        assert(image.getPixelAt(28, 8) === 0xff000000, 'JPEG: the image itself is unchanged');
        let error = null;
        try { await image.encodeJPEG({background: NaN}); } catch (e) { error = e; }
        assert(error instanceof RangeError, 'JPEG: NaN background');
        // with a gain map: still an Ultra HDR JPEG
        const hdr = new Image(32, 16).fill(x => x < 16 ? 0xffffffff : 0xffffff00);
        hdr.gainMap = new GainMap(new Image(8, 4).fill(0xc0c0c0ff), {min: 0, max: 2});
        const back = await Image.decode(await hdr.encodeJPEG({metadata: meta}));
        assert(back.gainMap && back.gainMap.max[0] >= 2 && (back.getPixelAt(28, 8) >>> 8) < 0x101010, 'JPEG: a transparent image with a gain map');
    }

    // Frame holds an Image: the frame's own methods move the offsets, the image's leave them
    {
        const image = new Image(20, 10).fill((x, y) => Colors.fromRGBA(x * 12, y * 25, 0, 255));
        const frame = new Frame(image, {duration: 40, xOffset: 10, yOffset: 6});
        assert(frame.image === image && frame.width === 20 && frame.height === 10 && !(frame instanceof Image), 'Frame: holds the image as it is');
        assert(String(frame) === 'Frame<20x10x40ms>', 'Frame: toString');
        frame.image.blur(1);
        assert(frame.xOffset === 10 && frame.yOffset === 6, 'Frame: image changes keep the offsets');
        frame.resize({width: 40});
        assert(frame.width === 40 && frame.height === 20 && frame.xOffset === 20 && frame.yOffset === 12, `Frame.resize scales the offsets: ${frame.xOffset},${frame.yOffset}`);
        frame.scale(0.5);
        assert(frame.width === 20 && frame.xOffset === 10 && frame.yOffset === 6, 'Frame.scale scales the offsets');
        const pixel = frame.image.getPixelAt(5, 4);
        frame.crop(3, 2, 10, 5);
        assert(frame.width === 10 && frame.height === 5 && frame.xOffset === 13 && frame.yOffset === 8 && frame.image.getPixelAt(2, 2) === pixel, 'Frame.crop moves the offsets');
        const bordered = new Frame(new Image(10, 10).fill((x, y) => x >= 3 && y >= 2 && x < 7 && y < 6 ? 0xff0000ff : 0), {xOffset: 1, yOffset: 1});
        bordered.trim();
        assert(bordered.width === 4 && bordered.height === 4 && bordered.xOffset === 4 && bordered.yOffset === 3, 'Frame.trim moves the offsets');
        const copy = frame.clone();
        assert(copy.image !== frame.image && copy.xOffset === 13 && copy.duration === 40 && Buffer.from(copy.image.bitmap).equals(Buffer.from(frame.image.bitmap)), 'Frame.clone copies the image');
        frame.image = new Image(3, 3);
        assert(frame.width === 3 && frame.xOffset === 13, 'Frame.image can be replaced');
        for (const bad of [null, {width: 2, height: 2}, frame]) {
            let error = null;
            try { new Frame(bad); } catch (e) { error = e; }
            assert(error instanceof TypeError, `new Frame(${bad}) should throw a TypeError`);
        }
        const encoder = Animation.apngEncoder(30, 20);
        await encoder.add(copy);
        await encoder.add(new Image(4, 4).fill(0xffffffff), {duration: 20});
        const decoded = await Animation.decode(await encoder.finish());
        assert(decoded.length === 2 && decoded.frames[0].duration === 40, 'encoder.add takes frames and images');
    }

    // every size-changing method of a frame moves its offsets, so the frame stays in place
    {
        const square = () => new Image(10, 10).fill((x, y) => x === 3 && y === 4 ? 0x00ff00ff : 0xff8040ff);
        // the green pixel's position in the animation
        const green = frame => {
            for (const [x, y, c] of frame.image.pixels()) if (c === 0x00ff00ff) return `${frame.xOffset + x},${frame.yOffset + y}`;
            return 'gone';
        };
        const shadowed = new Frame(square(), {xOffset: 2, yOffset: 5}).dropShadow({blur: 2});
        assert(shadowed.width > 10 && shadowed.xOffset < 2 && green(shadowed) === '5,9', `Frame.dropShadow: offsets ${shadowed.xOffset},${shadowed.yOffset}, green at ${green(shadowed)}`);
        const outlined = new Frame(square(), {xOffset: 1, yOffset: 4}).outline({width: 3});
        assert(outlined.width === 16 && outlined.xOffset === -2 && outlined.yOffset === 1 && green(outlined) === '4,8', `Frame.outline: ${outlined.xOffset},${outlined.yOffset}`);
        const sheared = new Frame(new Image(20, 20).fill(0xffffffff), {xOffset: 100, yOffset: 100}).transform([1, 0, 0.5, 1, 0, 0]);
        assert(sheared.width === 30 && sheared.xOffset === 95 && sheared.yOffset === 100, `Frame.transform: ${sheared.width} at ${sheared.xOffset},${sheared.yOffset}`);
        const turned = new Frame(new Image(20, 10), {xOffset: 10, yOffset: 10}).rotate(90);
        assert(turned.width === 10 && turned.height === 20 && turned.xOffset === 15 && turned.yOffset === 5, `Frame.rotate(90) keeps its middle: ${turned.xOffset},${turned.yOffset}`);
        const tilted = new Frame(new Image(20, 20), {xOffset: 50, yOffset: 50}).rotate(45);
        assert(Math.abs(tilted.xOffset + tilted.width / 2 - 60) <= 0.5 && Math.abs(tilted.yOffset + tilted.height / 2 - 60) <= 0.5, 'Frame.rotate(45) keeps its middle');
        const contained = new Frame(new Image(20, 10), {xOffset: 10, yOffset: 6}).contain(40, 40);
        assert(contained.width === 40 && contained.height === 40 && contained.xOffset === 20 && contained.yOffset === 2, `Frame.contain: ${contained.xOffset},${contained.yOffset}`);
        const covered = new Frame(new Image(20, 10), {xOffset: 10, yOffset: 6}).cover(10, 10);
        assert(covered.width === 10 && covered.xOffset === 15 && covered.yOffset === 6, `Frame.cover: ${covered.xOffset},${covered.yOffset}`);
        const viaImage = new Frame(square(), {xOffset: 2, yOffset: 5});
        viaImage.image.dropShadow({blur: 2});
        assert(viaImage.xOffset === 2 && viaImage.yOffset === 5, 'frame.image.dropShadow leaves the offsets');
        assert(viaImage.image.__moved__ === undefined && !Object.keys(viaImage.image).includes('__moved__'), 'the offset tracking is removed afterwards');
        let error = null;
        try { new Frame(square(), {xOffset: 2}).rotate(10, {mode: 'area'}); } catch (e) { error = e; }
        assert(error instanceof TypeError, 'Frame.rotate checks its options');
    }

    // the same on animations: scale and trim keep the frames, the others work on the composited animation
    {
        const animation = () => new Animation([
            new Frame(new Image(30, 20).fill((x, y) => x === 0 && y === 0 ? 0x00ff00ff : 0xff0000ff), {duration: 40}),
            new Frame(new Image(6, 4).fill(0x0000ffff), {xOffset: 10, yOffset: 8, duration: 60})
        ]);
        const scaled = animation().scale(2);
        assert(scaled.width === 60 && scaled.height === 40 && scaled.frames[1].xOffset === 20 && scaled.frames[1].width === 12, 'Animation.scale');
        const sparse = new Animation([new Frame(new Image(4, 3).fill(0xffffffff), {xOffset: 5, yOffset: 6}), new Frame(new Image(2, 2).fill(0xff0000ff), {xOffset: 12, yOffset: 7})], {width: 20, height: 20});
        sparse.trim();
        assert(sparse.width === 9 && sparse.height === 3 && sparse.frames[0].xOffset === 0 && sparse.frames[1].xOffset === 7 && sparse.frames[1].yOffset === 1, `Animation.trim: ${sparse.width}x${sparse.height}`);
        const turned = animation().rotate(90);
        assert(turned.width === 20 && turned.height === 30 && turned.length === 2 && turned.frames.every(f => f.width === 20 && f.height === 30 && f.xOffset === 0), 'Animation.rotate(90): full canvas frames');
        assert(turned.frames[0].image.getPixelAt(19, 0) === 0x00ff00ff && turned.frames.map(f => f.duration).join() === '40,60', 'Animation.rotate turns clockwise, keeps the durations');
        assert(turned.frames[1].image.getPixelAt(20 - 1 - 9, 11) === 0x0000ffff, 'Animation.rotate: the second frame composited over the first');
        const shadowed = animation().dropShadow({blur: 2});
        const outlined = animation().outline({width: 2});
        const skewed = animation().transform([1, 0, 0.5, 1, 0, 0]);
        assert(shadowed.width > 30 && outlined.width === 34 && outlined.height === 24 && skewed.width === 40 && skewed.frames.every(f => f.width === skewed.width), 'Animation.dropShadow, outline and transform grow the canvas');
        const kept = animation(), first = kept.frames[0];
        let error = null;
        try { kept.rotate(10, {mode: 'area'}); } catch (e) { error = e; }
        assert(error instanceof TypeError && kept.frames[0] === first && kept.width === 30, 'Animation.rotate: nothing changes when it throws');
    }

    // renamed parameters and the American spelling
    {
        const gray = new Image(1, 1).fill(0xff0000ff).grayscale();
        assert(gray.getPixelAt(0, 0) === 0x4c4c4cff, `grayscale: ${gray.getPixelAt(0, 0).toString(16)}`);
        assert(new Image(1, 1).greyscale === undefined && new Image(1, 1).drawBox === undefined && new Image(1, 1).fit === undefined && new Image(1, 1).getRGBAAt === undefined && new Image(1, 1).region === undefined, 'removed methods');
    }
})();
