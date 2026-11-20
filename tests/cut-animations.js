const fs = require('fs').promises;
const crypto = require('crypto');
const {Image, Frame, Animation} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};
const sha256 = bytes => crypto.createHash('sha256').update(new Uint8Array(bytes)).digest('hex');

(async () => {
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
            for (let cut = Math.floor(data.length / 16); cut < data.length; cut += Math.max(1, data.length >> 5)) {
                const part = await Animation.decode(data.subarray(0, cut)).catch(() => null);
                if (!part) continue;
                decoded++;
                if (part.length > full.length || part.length < previous) panic(`${name} cut at ${cut}: ${part.length} frames of ${full.length} (before: ${previous})`);
                previous = part.length;
                part.frames.forEach((frame, i) => {
                    if (sha256(frame.image.bitmap) !== sha256(full.frames[i].image.bitmap)) panic(`${name} cut at ${cut}: frame ${i} differs from the full file's`);
                });
            }
            if (name !== "JPEG XL" && name !== "JPEG XL lossless" && decoded < 3) panic(`${name}: only ${decoded} cuts decoded`);
        }
    }
})();
