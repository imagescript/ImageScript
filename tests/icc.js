const fs = require('fs').promises;
const {Image, Animation} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};

// the largest difference between two images' channels
const difference = (a, b) => {
    if (a.width !== b.width || a.height !== b.height) return Infinity;
    let max = 0;
    for (let i = 0; i < a.bitmap.length; i++) max = Math.max(max, Math.abs(a.bitmap[i] - b.bitmap[i]));
    return max;
};

// images with embedded ICC profiles converted to sRGB like LittleCMS does (scripts/icc-fixtures.py), within 1 of it
// (2 for JPEG and AVIF, where its references come from Pillow's decoders)
(async () => {
    const cases = [
        ['display-p3.png', 'display-p3.ref.png', 1], ['adobe-rgb.png', 'adobe-rgb.ref.png', 1], ['p3-table.png', 'p3-table.ref.png', 1],
        ['rec2020.png', 'rec2020.ref.png', 1], ['srgb.png', 'srgb.ref.png', 1], ['gray.png', 'gray.ref.png', 1],
        ['display-p3.webp', 'display-p3.ref.png', 1], ['display-p3.tiff', 'display-p3.ref.png', 1],
        ['display-p3.jpg', 'display-p3.jpg.ref.png', 2], ['display-p3.avif', 'display-p3.avif.ref.png', 2],
        ['display-p3.jxl', 'display-p3.ref.png', 1], ['gray.jxl', 'gray.ref.png', 1],
        // (AVIFs without a profile, their nclx box's color primaries: Display P3, BT.2020)
        ['display-p3-nclx.avif', 'display-p3.ref.png', 1], ['bt2020-nclx.avif', 'bt2020-nclx.ref.png', 1],
    ];
    for (const [file, reference, tolerance] of cases) {
        const data = await fs.readFile(`./tests/icc/${file}`), ref = await Image.decode(await fs.readFile(`./tests/icc/${reference}`));
        const image = await Image.decode(data);
        const d = difference(image, ref);
        if (d > tolerance) panic(`${file}: differs from LittleCMS by ${d}`);
        // (and without it, the stored colors)
        const raw = await Image.decode(data, {applyColorProfile: false});
        if (file !== 'srgb.png' && difference(raw, ref) <= tolerance) panic(`${file}: applyColorProfile: false should keep the stored colors`);
    }
    // (a gray profile of a color image isn't applied)
    const color = await Image.decode(await fs.readFile('./tests/icc/gray-on-rgb.png'));
    if (difference(color, await Image.decode(await fs.readFile('./tests/icc/gray-on-rgb.png'), {applyColorProfile: false})) !== 0) panic('a gray profile of a color image should be ignored');
    // (a lossy JPEG XL's profile is only what the image was: XYB decodes to sRGB, without it)
    const xyb = await fs.readFile('./tests/icc/rec2020-xyb.jxl');
    if (difference(await Image.decode(xyb), await Image.decode(xyb, {applyColorProfile: false})) !== 0) panic('the profile of an XYB JPEG XL should be ignored');
    // (lossy, so close to the sRGB reference on average, over the opaque pixels: 2.8 apart, the unconverted values 5.1)
    const decoded = (await Image.decode(xyb)).bitmap, ref = (await Image.decode(await fs.readFile('./tests/icc/rec2020.ref.png'))).bitmap;
    let sum = 0, n = 0;
    for (let i = 0; i < ref.length; i += 4) if (ref[i + 3] >= 192) for (let c = 0; c < 3; c++, n++) sum += Math.abs(decoded[i + c] - ref[i + c]);
    if (sum / n > 4) panic(`the XYB JPEG XL is ${(sum / n).toFixed(2)} from its sRGB reference on average`);
    // (an sRGB profile leaves the pixels as they are)
    const srgb = await fs.readFile('./tests/icc/srgb.png');
    if (difference(await Image.decode(srgb), await Image.decode(srgb, {applyColorProfile: false})) !== 0) panic('an sRGB profile should leave the pixels as they are');

    const animation = await Animation.decode(await fs.readFile('./tests/icc/display-p3-animated.webp'));
    for (const i of [0, 1]) {
        const ref = await Image.decode(await fs.readFile(`./tests/icc/display-p3-animated-${i + 1}.ref.png`));
        if (difference(animation[i], ref) > 1) panic(`animated WebP frame ${i + 1}: differs from LittleCMS`);
    }
    // (JPEG XLs through Animation.decode too)
    const jxlFrames = await Animation.decode(await fs.readFile('./tests/icc/display-p3.jxl'));
    if (difference(jxlFrames[0], await Image.decode(await fs.readFile('./tests/icc/display-p3.ref.png'))) > 1) panic('JPEG XL through Animation.decode: differs from LittleCMS');

    // lossless JPEG XLs in an enumerated color space (no ICC profile, like cjxl writes Display P3): converted to sRGB
    // like an embedded profile. The Display P3 values, losslessly encoded, with the image header's color encoding
    // replaced by Display P3's (D65, P3 primaries, the sRGB transfer function)
    const p3 = await Image.decode(await fs.readFile('./tests/icc/display-p3.png'), {applyColorProfile: false});
    const bare = new Image(p3.width, p3.height);
    bare.bitmap.set(p3.bitmap);
    const enumerated = withColourEncoding(jxlc(await bare.encodeJXL()), p3.width, p3.height, true, [
        [1, 0], [1, 0], [2, 0], [2, 1], [2, 2], [4, 11 - 2], [1, 0], [2, 2], [4, 13 - 2], [2, 1],
    ]);
    const p3Ref = await Image.decode(await fs.readFile('./tests/icc/display-p3.ref.png'));
    const p3Decoded = await Image.decode(enumerated);
    if (difference(p3Decoded, p3Ref) > 1) panic(`enumerated Display P3 JPEG XL: differs from LittleCMS by ${difference(p3Decoded, p3Ref)}`);
    if (difference(await Image.decode(enumerated, {applyColorProfile: false}), p3) !== 0) panic('enumerated Display P3 JPEG XL, applyColorProfile: false: should keep the stored colors');
    if (difference((await Animation.decode(enumerated))[0], p3Ref) > 1) panic('enumerated Display P3 JPEG XL through Animation.decode: differs from LittleCMS');
})();

// the codestream of a JPEG XL in the container (our encoder's: one jxlc box)
function jxlc(data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let o = 0; o + 8 <= data.length; o += view.getUint32(o)) {
        if (String.fromCharCode(...data.subarray(o + 4, o + 8)) === 'jxlc') return data.subarray(o + 8, o + view.getUint32(o));
    }
    throw new Error('jxlc: no codestream box');
}

// a lossless JPEG XL codestream of ours (image header: 8-bit, an 8-bit alpha channel if alpha, not XYB, the default
// color encoding) with the image header's color encoding replaced by the given fields ([bits, value], LSB first)
function withColourEncoding(stream, width, height, alpha, fields) {
    const header = colour => {
        const bytes = [];
        let buf = 0, n = 0;
        const write = (count, v) => {
            for (let i = 0; i < count; i++) {
                buf |= (v >>> i & 1) << n++;
                if (n === 8) {
                    bytes.push(buf);
                    buf = n = 0;
                }
            }
        };
        write(16, 0x0aff);
        // (the size: a small one, a square)
        if (width !== height || height > 256 || height % 8) throw new Error('withColourEncoding: small squares only');
        write(1, 1);
        write(5, height / 8 - 1);
        write(3, 1);
        write(1, 0); write(1, 0); write(1, 0); write(2, 0); write(1, 1);
        if (alpha) {
            write(2, 1);
            write(1, 1);
        } else write(2, 0);
        write(1, 0);
        if (colour) for (const [bits, v] of colour) write(bits, v);
        else write(1, 1);
        write(2, 0); write(1, 1);
        if (n) write(8 - n, 0);
        return Uint8Array.from(bytes);
    };
    const original = header(null);
    if (Buffer.compare(Buffer.from(stream.subarray(0, original.length)), Buffer.from(original))) throw new Error('withColourEncoding: unexpected image header');
    return Buffer.concat([header(fields), stream.subarray(original.length)]);
}
