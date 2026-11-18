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
})();
