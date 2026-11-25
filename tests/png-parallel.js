const zlib = require('zlib');
const {Image} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};

// PNGs of more than 2 MiB of filtered data are compressed in 1 MiB pieces in parallel: the IDAT data still has to be
// one complete zlib stream (a final block, the Adler-32 of all data), and decode to the same pixels

function idat(png) {
    const parts = [];
    for (let offset = 8; offset < png.length;) {
        const length = png.readUInt32BE(offset);
        if (png.toString('latin1', offset + 4, offset + 8) === 'IDAT') parts.push(png.subarray(offset + 8, offset + 8 + length));
        offset += 12 + length;
    }
    return Buffer.concat(parts);
}

(async () => {
    // 1100x700 RGBA: 3.08 MB filtered (4 pieces, the last one short), with structure the matches can reach across pieces for
    const image = new Image(1100, 700);
    for (let y = 0; y < 700; y++)
        for (let x = 0; x < 1100; x++) {
            const i = (y * 1100 + x) * 4;
            image.bitmap[i] = x * 7 ^ y;
            image.bitmap[i + 1] = (x >> 3) * (y >> 4);
            image.bitmap[i + 2] = y % 37 * 7;
            image.bitmap[i + 3] = 255 - (x + y) % 211;
        }

    for (const compression of [0, 1, 6, 9]) {
        const png = Buffer.from(await image.encodePNG({ compression }));
        const data = idat(png);
        // the default finish flush: throws without a final block, or on a wrong Adler-32
        let raw;
        try {
            raw = zlib.inflateSync(data);
        } catch (error) {
            panic(`compression ${compression}: ${error.message}`);
        }
        if (raw.length !== 700 * (1 + 1100 * 4)) panic(`compression ${compression}: ${raw.length} bytes inflated`);
        if (((data[0] << 8) | data[1]) % 31 !== 0) panic(`compression ${compression}: bad zlib header`);

        const decoded = await Image.decode(png);
        if (!Buffer.from(decoded.bitmap).equals(Buffer.from(image.bitmap))) panic(`compression ${compression}: different pixels`);
    }
})();
