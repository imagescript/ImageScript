const {Image, Frame, Animation, LimitError} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};

// every frame of an animation counts as at least 1024 pixels of maxPixels: a frame takes memory however small it is
// (200000 frames of 1x1, a 4.6 MB GIF, took 720 MB), so maxPixels bounds the memory of tiny frames too
(async () => {
    const frames = count => Array.from({length: count}, (_, i) => new Frame(new Image(1, 1).fill((i * 0x01030507 | 0xff) >>> 0), {duration: 10}));
    for (const format of ['GIF', 'APNG', 'WebP']) {
        const encode = animation => format === 'GIF' ? animation.encodeGIF({optimize: false}) : format === 'APNG' ? animation.encodeAPNG({optimize: false}) : animation.encodeWebP({optimize: false, quality: 100});
        const few = await encode(new Animation(frames(99)));
        const many = await encode(new Animation(frames(101)));
        const fewDecoded = await Animation.decode(few, {maxPixels: 1024 * 100});
        if (fewDecoded.length !== 99) panic(`${format}: ${fewDecoded.length} frames decoded, expected 99`);
        let error = null;
        try { await Animation.decode(many, {maxPixels: 1024 * 100}); } catch (err) { error = err; }
        if (!(error instanceof LimitError)) panic(`${format}: 101 frames of 1x1 with maxPixels 102400 should throw a LimitError, got ${error}`);
        // a single image isn't charged for it
        await Image.decode(many, {maxPixels: 1});
    }

    // the floor applies while the frames are decoded, not after all of them: 1000000 frames of 1x1 (23 MB) took 77 s and
    // 1.8 GB before the LimitError
    {
        const frame = Buffer.from([0x21, 0xf9, 4, 0, 1, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0]);
        const header = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255]);
        const gif = Buffer.concat([header, Buffer.alloc(frame.length * 200000).map((_, i) => frame[i % frame.length]), Buffer.from([0x3b])]);
        const start = Date.now();
        let error = null;
        try { await Animation.decode(gif, {maxPixels: 1024 * 1000}); } catch (err) { error = err; }
        if (!(error instanceof LimitError) || Date.now() - start > 1000) panic(`200000 GIF frames of 1x1 with room for 1000: ${error} after ${Date.now() - start} ms, expected a LimitError at once`);
    }
})();
