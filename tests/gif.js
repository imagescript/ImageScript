const fs = require('fs').promises;
const crypto = require('crypto');
const {Image, Frame, Animation, Colors} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};

(async () => {
    const frames = [];
    for (let i = 0; i < 30; i++) {
        const frame = new Frame(new Image(256, 256));
        frame.image.fill(x => Colors.fromHSL((x / frame.width + i / 30) * 360, 1, 0.5));
        frames.push(frame);
    }

    const gif = new Animation(frames);

    if (process.env.OVERWRITE_TEST)
        await fs.writeFile('./tests/targets/gif.gif', await gif.encodeGIF({colors: 8}));

    {
        const binary = await fs.readFile('./tests/targets/gif.gif');
        const decoded = await Animation.decode(binary);
        if (decoded.width !== gif.width)
            panic('decode: incorrect width');
        if (decoded.height !== gif.height)
            panic('decode: incorrect height');
        if (decoded.length !== gif.length)
            panic('decode: incorrect frame count');

        for (let i = 0; i < gif.length; i++) {
            if (gif.frames[i].image.bitmap.length !== decoded.frames[i].image.bitmap.length)
                panic('decode: incorrect frame bitmap length');
        }

        const first = await Image.decode(binary);
        if (first.constructor !== Image)
            panic('decode: Image.decode should return the first frame as an Image');
    }

    {
        // frames with <= 256 colors survive a roundtrip losslessly
        const decoded = await Animation.decode(await gif.encodeGIF());
        for (let i = 0; i < gif.length; i++)
            if (!Buffer.from(decoded.frames[i].image.bitmap).equals(Buffer.from(gif.frames[i].image.bitmap)))
                panic(`roundtrip: frame ${i} differs`);
        if (decoded.frames[0].duration !== gif.frames[0].duration)
            panic('roundtrip: incorrect duration');
        if (decoded.loopCount !== Infinity)
            panic('roundtrip: incorrect loop count');
    }

    {
        // offsets, transparency, disposal modes and finite loop counts
        const black = Colors.fromRGBA(0, 0, 0, 255);
        const white = Colors.fromRGBA(255, 255, 255, 255);

        const background = new Frame(new Image(4, 4), {duration: 100});
        background.image.fill(black);
        const dot = new Frame(new Image(1, 1), {duration: 100, xOffset: 1, yOffset: 1, disposalMode: 'previous'});
        dot.image.fill(white);
        const hole = new Frame(new Image(2, 2), {duration: 100, xOffset: 2, yOffset: 2, disposalMode: 'background'});
        hole.image.fill((x, y) => x === y ? white : 0);
        const last = new Frame(new Image(1, 1), {duration: 100, xOffset: 0, yOffset: 0});
        last.image.fill(white);

        const decoded = await Animation.decode(await new Animation([background, dot, hole, last], {loopCount: 2}).encodeGIF());
        if (decoded.loopCount !== 2)
            panic('disposal: incorrect loop count');

        const expect = (frame, pixels) => {
            for (let y = 0; y < 4; y++)
                for (let x = 0; x < 4; x++) {
                    const want = pixels[y * 4 + x];
                    const got = decoded.frames[frame].image.getPixelAt(x, y);
                    if (want === 'B' ? got !== black : want === 'W' ? got !== white : got !== 0)
                        panic(`disposal: frame ${frame} pixel ${x},${y} is ${got.toString(16)}`);
                }
        };

        expect(0, 'BBBBBBBBBBBBBBBB');
        expect(1, 'BBBBBWBBBBBBBBBB'); // dot is restored afterwards
        expect(2, 'BBBBBBBBBBWBBBBW'); // transparent pixels keep the background
        expect(3, 'WBBBBBBBBB__BB__'); // hole is cleared to transparent
    }

    // interlaced: written by Pillow (scripts/gif-fixtures.py), the sha256 of its RGBA pixels as Pillow decodes them
    {
        const [frame] = (await Animation.decode(await fs.readFile('./tests/gifs/interlaced.gif'))).frames;
        if (frame.width !== 80 || frame.height !== 37) panic('interlaced: dimensions don\'t match');
        if (crypto.createHash('sha256').update(new Uint8Array(frame.image.bitmap)).digest('hex') !== '854e5e98f2124a6009d5bc28748772ede25af244a2503021ef4f52e323309d46')
            panic('interlaced: pixels don\'t match');
    }

    // damaged files keep the frames decoded so far: cut off, or an unknown block before the trailer
    {
        const binary = await fs.readFile('./tests/targets/gif.gif');
        const cut = await Animation.decode(binary.subarray(0, binary.length >> 1));
        if (!cut.length || cut.length >= 30) panic(`truncated: ${cut.length} frames decoded`);

        const unknown = await Animation.decode(Buffer.concat([binary.subarray(0, -1), Buffer.from([0x99, 0x3b])]));
        if (unknown.length !== 30) panic(`unknown block: ${unknown.length} frames decoded`);

        // a screen of no pixels is a decoding error, not a RangeError from making an image of it
        const flat = Buffer.from(binary);
        flat.writeUInt16LE(0, 8);
        for (const [name, decode] of [['Animation.decode', () => Animation.decode(flat)], ['Image.decode', () => Image.decode(flat)]]) {
            if (!await decode().then(() => false, error => error.constructor === Error)) panic(`${name} of a GIF without height should throw an Error`);
        }

        // cut off before the first frame is whole: there is no image, not a blank one
        for (const length of [13, 20, 40]) {
            for (const [name, decode] of [['Animation.decode', () => Animation.decode(binary.subarray(0, length))], ['Image.decode', () => Image.decode(binary.subarray(0, length))]]) {
                if (!await decode().then(() => false, error => error instanceof Error)) panic(`${name} of ${length} bytes should throw`);
            }
        }
    }
})();
