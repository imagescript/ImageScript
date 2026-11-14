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
    const two = new Animation([new Frame(photo.clone(), {duration: 50}), new Frame(photo.clone().invert(), {duration: 70})]);

    // a cut-off animation (GIF, APNG, WebP, JPEG XL) has the frames that arrived whole and nothing else: no frame of it
    // is a partly decoded one (its pixels are those of the full file's), and fewer bytes never give more frames
    {
        const make = (format, options) => {
            const frames = Array.from({length: 6}, (_, i) => new Frame(new Image(64, 64).fill((x, y) => ((x * 4 + i * 30 & 255) << 24 | (y * 4 & 255) << 16 | (x ^ y) * 4 << 8 | 255) >>> 0), {duration: 40}));
            return new Animation(frames)[`encode${format}`](options);
        };
        const inputs = {
            GIF: await fs.readFile('./bench/inputs/animation.gif'), 'WebP lossless': await make('WebP'), 'WebP lossy': await make('WebP', {quality: 80}), APNG: await make('APNG'),
            'JPEG XL': await fs.readFile('./tests/jxl/animation-lossy.jxl'), 'JPEG XL lossless': await fs.readFile('./tests/jxl/animation.jxl')
        };
        for (const [name, data] of Object.entries(inputs)) {
            const full = await Animation.decode(data);
            let decoded = 0, previous = 0;
            for (let cut = Math.floor(data.length / 16); cut < data.length; cut += Math.max(1, data.length >> 7)) {
                const part = await Animation.decode(data.subarray(0, cut)).catch(() => null);
                if (!part) continue;
                decoded++;
                if (part.length > full.length || part.length < previous) panic(`${name} cut at ${cut}: ${part.length} frames of ${full.length} (before: ${previous})`);
                previous = part.length;
                part.frames.forEach((frame, i) => {
                    if (sha256(frame.image.bitmap) !== sha256(full.frames[i].image.bitmap)) panic(`${name} cut at ${cut}: frame ${i} differs from the full file's`);
                });
            }
            if (name !== 'JPEG XL' && name !== 'JPEG XL lossless' && decoded < 3) panic(`${name}: only ${decoded} cuts decoded`);
        }
    }

    // an APNG that is cut off keeps the frames that arrived whole, like a GIF does; one that ends properly with fewer
    // frames than it announces, or has no whole frame, doesn't (the default image shows, or it throws)
    {
        const frames = [0xff0000ff, 0x00ff00ff, 0x0000ffff, 0xffff00ff].map(color => new Frame(new Image(48, 48).fill((x, y) => (color ^ (x * 0x01000000 + y * 0x00010000)) >>> 0 | 0xff), {duration: 40}));
        const apng = await new Animation(frames).encodeAPNG({compression: 0});
        const complete = await Animation.decode(apng);
        if (complete.length !== 4) panic(`the APNG should have 4 frames, got ${complete.length}`);
        const counts = [];
        for (let cut = apng.length - 12; cut > apng.length / 3; cut -= 997) {
            const decoded = await Animation.decode(apng.subarray(0, cut)).catch(() => null);
            if (!decoded) continue;
            counts.push(decoded.length);
            decoded.frames.forEach((frame, i) => { if (sha256(frame.image.bitmap) !== sha256(complete.frames[i].image.bitmap)) panic(`a frame of the APNG cut at ${cut} differs from the whole file's`); });
        }
        if (!counts.includes(2) && !counts.includes(3)) panic(`cut APNGs should decode with the frames that arrived whole, got ${counts}`);
        if (counts.some((n, i) => i && n > counts[i - 1])) panic('more frames from less data');
        await throwsA(() => Animation.decode(apng.subarray(0, 60)), Error, 'an APNG cut before its first frame');
    }

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

    // a file with one frame is an Animation only when the format signals animation
    const single = new Animation([new Frame(new Image(12, 8).fill((x, y) => Colors.fromRGBA(x * 20, y * 30, 90, 255)), {duration: 90, xOffset: 0, yOffset: 0})]);
    for (const [format, bytes] of [['GIF', await single.encodeGIF()], ['APNG', await single.encodeAPNG()], ['WebP', await single.encodeWebP({quality: 90})]]) {
        const decoded = await decode(bytes);
        if (!(decoded instanceof Animation) || decoded.length !== 1) panic(`single frame ${format}: got ${decoded.constructor.name}`);
        if (format === 'GIF' && decoded.loopCount !== Infinity) panic(`single-frame GIF loop count: ${decoded.loopCount}`);
        const reference = (await Animation.decode(bytes)).frames[0].image;
        const image = decoded instanceof Animation ? decoded.frames[0].image : decoded;
        if (image.width !== reference.width || image.height !== reference.height) panic(`single frame ${format}: ${image.width}x${image.height} instead of ${reference.width}x${reference.height}`);
        if (sha256(image.bitmap) !== sha256(reference.bitmap)) panic(`single frame ${format}: pixels differ from Animation.decode's first frame`);
    }

    // a single-frame animated GIF keeps its canvas and frame metadata
    const offset = await new Animation([new Frame(new Image(4, 3).fill(0xff0000ff), {xOffset: 2, yOffset: 1, duration: 40})]).encodeGIF({optimize: false});
    const offsetAnimation = await decode(offset);
    if (!(offsetAnimation instanceof Animation) || offsetAnimation.width !== 6 || offsetAnimation.height !== 4 || offsetAnimation.frames[0].duration !== 40)
        panic(`single frame with an offset: ${offsetAnimation.constructor.name}`);
    const stillGif = await decode(await new Animation([single.frames[0].clone()], {loopCount: 0}).encodeGIF());
    if (stillGif instanceof Animation || !(stillGif instanceof Image)) panic('one-frame GIF without a loop extension should be an Image');

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

    // options pass through: Image.decode gives the first frame as an Image, maxPixels applies to both kinds
    const first = await Image.decode(gif);
    if (first instanceof Animation || !(first instanceof Image)) panic('Image.decode: expected an Image');
    if (sha256(first.bitmap) !== sha256((await Animation.decode(gif)).frames[0].image.bitmap)) panic('Image.decode: wrong frame');
    await throwsA(() => decode(gif, {maxPixels: 100}), RangeError, 'maxPixels on a GIF');
    const jpeg = await fs.readFile('./tests/targets/external.jpg');
    await throwsA(() => decode(jpeg, {maxPixels: 100}), RangeError, 'maxPixels on a JPEG');
    if ((await decode(gif, {threads: 2})).length !== 30) panic('threads: frames changed');

    // Animation.decode wraps still images too; top-level decode uses explicit animation markers
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

    // a one-frame APNG cut from a two-frame file, with its play count retained
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
        const actlView = new DataView(actl.buffer);
        actlView.setUint32(0, 1);
        actlView.setUint32(4, 3);
        parts.push(pngChunk('acTL', actl));
    }
    parts.push(pngChunk('IEND', new Uint8Array(0)));
    const oneApng = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
    for (let at = 0, i = 0; i < parts.length; i++) { oneApng.set(parts[i], at); at += parts[i].length; }
    if (!chunks.some(c => c.type === 'acTL')) panic('the two-frame APNG has no acTL');

    const oneAnimation = await Animation.decode(oneApng);
    if (!(oneAnimation instanceof Animation) || oneAnimation.length !== 1) panic(`one-frame APNG with acTL: Animation.decode gives ${oneAnimation.constructor.name} with ${oneAnimation.length} frames`);
    if (oneAnimation.loopCount !== 2) panic(`one-frame APNG: loop count ${oneAnimation.loopCount} instead of 2`);
    if (sha256(oneAnimation.frames[0].image.bitmap) !== sha256((await Animation.decode(apng)).frames[0].image.bitmap)) panic('one-frame APNG with acTL: the frame differs from the first frame of the two-frame file');
    const oneImage = await decode(oneApng);
    if (!(oneImage instanceof Animation) || oneImage.length !== 1 || oneImage.loopCount !== 2) panic('one-frame APNG with acTL: decode() should preserve the Animation');
    if (sha256(oneImage.frames[0].image.bitmap) !== sha256(oneAnimation.frames[0].image.bitmap)) panic('one-frame APNG with acTL: decode() pixels differ from Animation.decode');

    // Image.decode of an animation is its first frame, an Image composed like Animation.decode's first frame: frames that
    // differ, with offsets and disposal modes, from our encoders (GIF, APNG, animated WebP, lossless and lossy)
    const moving = new Animation([
        new Frame(new Image(12, 8).fill((x, y) => Colors.fromRGBA(x * 20, y * 30, 90, 255)), {duration: 50}),
        new Frame(new Image(5, 4).fill((x, y) => Colors.fromRGBA(255, x * 50, y * 60, 128)), {duration: 70, xOffset: 3, yOffset: 2, disposalMode: 'background'}),
        new Frame(new Image(6, 3).fill(0x00ff00ff), {duration: 40, xOffset: 1, yOffset: 4, disposalMode: 'previous'}),
        new Frame(new Image(4, 4).fill((x, y) => Colors.fromRGBA(y * 90, 0, 200, 255 - x * 60)), {duration: 60, xOffset: 8, yOffset: 4})
    ]);
    const movingFiles = {
        GIF: await moving.encodeGIF(),
        'GIF without optimization': await moving.encodeGIF({optimize: false}),
        APNG: await moving.encodeAPNG(),
        'APNG without optimization': await moving.encodeAPNG({optimize: false}),
        'animated WebP': await moving.encodeWebP(),
        'lossy animated WebP': await moving.encodeWebP({quality: 80})
    };
    for (const [name, bytes] of Object.entries(movingFiles)) {
        const image = await Image.decode(bytes);
        if (image.constructor !== Image) panic(`${name}: Image.decode gives ${image.constructor.name}, not an Image`);
        const frames = (await Animation.decode(bytes)).frames;
        if (frames.length !== 4) panic(`${name}: ${frames.length} frames instead of 4`);
        const reference = frames[0].image;
        if (image.width !== reference.width || image.height !== reference.height) panic(`${name}: ${image.width}x${image.height} instead of ${reference.width}x${reference.height}`);
        if (sha256(image.bitmap) !== sha256(reference.bitmap)) panic(`${name}: Image.decode is not the first frame of Animation.decode`);
        if (sha256(image.bitmap) === sha256(frames[1].image.bitmap)) panic(`${name}: the frames should differ`);
    }
    // options apply to the first frame: maxPixels counts the canvas
    await throwsA(() => Image.decode(movingFiles.GIF, {maxPixels: 10}), RangeError, 'Image.decode maxPixels of an animated GIF');
    if ((await Image.decode(movingFiles.GIF, {maxPixels: 96})).width !== 12) panic('Image.decode: a GIF whose canvas fits maxPixels should decode');

    // an APNG whose default image (IDAT) isn't part of the animation: Image.decode gives that image, what viewers without
    // APNG support show, and Animation.decode only the frames of the animation
    const pngList = bytes => {
        const list = [], view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let at = 8; at < bytes.length;) {
            const length = view.getUint32(at);
            list.push({type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)), data: bytes.subarray(at + 8, at + 8 + length)});
            at += 12 + length;
        }
        return list;
    };
    // (more colors than a palette holds, so both are truecolor PNGs without a PLTE chunk to copy)
    const defaultPNG = new Uint8Array(await new Image(32, 32).fill((x, y) => Colors.fromRGBA(x * 7, y * 7, (x * y) & 255, 255)).encodePNG());
    const framePNG = new Uint8Array(await new Image(32, 32).fill((x, y) => Colors.fromRGBA(0, x * 7, y * 7, 255)).encodePNG());
    const ihdr = pngList(defaultPNG).find(c => c.type === 'IHDR').data;
    const defaultIDAT = pngList(defaultPNG).find(c => c.type === 'IDAT').data;
    const frameIDAT = pngList(framePNG).find(c => c.type === 'IDAT').data;
    const actl = new Uint8Array(8);
    new DataView(actl.buffer).setUint32(0, 1); // one frame in the animation, which the IDAT isn't part of
    const fcTL = new Uint8Array(26), fcView = new DataView(fcTL.buffer);
    fcView.setUint32(0, 0); // sequence number
    fcView.setUint32(4, 32); // width
    fcView.setUint32(8, 32); // height
    fcView.setUint16(20, 100); // delay: 100/1000 s
    fcView.setUint16(22, 1000);
    const fdAT = new Uint8Array(4 + frameIDAT.length);
    new DataView(fdAT.buffer).setUint32(0, 1); // sequence number
    fdAT.set(frameIDAT, 4);
    const separate = Buffer.concat([
        defaultPNG.subarray(0, 8), pngChunk('IHDR', ihdr), pngChunk('acTL', actl), pngChunk('IDAT', defaultIDAT),
        pngChunk('fcTL', fcTL), pngChunk('fdAT', fdAT), pngChunk('IEND', new Uint8Array(0))
    ]);
    const shown = await Image.decode(separate);
    if (shown.constructor !== Image || sha256(shown.bitmap) !== sha256((await Image.decode(defaultPNG)).bitmap)) panic('APNG with a separate default image: Image.decode should give the default image');
    const animated = await Animation.decode(separate);
    if (animated.length !== 1 || sha256(animated.frames[0].image.bitmap) !== sha256((await Image.decode(framePNG)).bitmap)) panic('APNG with a separate default image: Animation.decode should give only the animation\'s frame');

    // a large animation: Image.decode stops after its first frame, so it takes a fraction of the time of all 50 frames
    const many = new Animation(Array.from({length: 50}, (_, i) => new Frame(new Image(480, 360).fill((x, y) => Colors.fromRGBA((x * 7 + i * 13) & 255, (y * 5 + x * i) & 255, (x ^ y) & 255, 255)), {duration: 40})));
    const large = await many.encodeGIF();
    const median = async fn => {
        const times = [];
        for (let i = 0; i < 3; i++) {
            const start = process.hrtime.bigint();
            await fn();
            times.push(Number(process.hrtime.bigint() - start) / 1e6);
        }
        return times.sort((a, b) => a - b)[1];
    };
    const firstMs = await median(() => Image.decode(large));
    const allMs = await median(() => Animation.decode(large));
    if (firstMs * 3 > allMs) panic(`Image.decode of 50 frames took ${firstMs.toFixed(1)} ms, Animation.decode ${allMs.toFixed(1)} ms: not a third`);
})().catch(error => panic(error.stack || String(error)));
