const {Image, Frame, GainMap, Colors} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};
const check = (condition, message) => {
    if (!condition) panic(message);
};
const throwsA = (fn, type, label) => {
    let error = null;
    try { fn(); } catch (e) { error = e; }
    if (!(error instanceof type)) panic(`${label}: should throw a ${type.name}, got ${error}`);
};
const px = (image, x, y) => Array.from(image.bitmap.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
const same = (a, b) => a.width === b.width && a.height === b.height && Buffer.from(a.bitmap).equals(Buffer.from(b.bitmap));
// an opaque image where every pixel is different
const photo = (width, height) => new Image(width, height).fill((x, y) => Colors.fromRGBA((x * 37 + y * 11) % 256, (x * 5 + y * 91) % 256, (x * y + x) % 256, 255));

(async () => {
    // transform
    {
        const source = photo(13, 9);
        for (const mode of ['nearest-neighbor', 'bilinear', 'bicubic'])
            for (const expand of [true, false])
                check(same(source.clone().transform([1, 0, 0, 1, 0, 0], {mode, expand}), source), `transform: the identity copies (${mode}, expand ${expand})`);

        // flips and quarter turns are exact (the library's rotate() turns counterclockwise)
        check(same(source.clone().transform([-1, 0, 0, 1, 0, 0]), source.clone().flip('horizontal')), 'transform: flipped horizontally');
        check(same(source.clone().transform([1, 0, 0, -1, 0, 0]), source.clone().flip('vertical')), 'transform: flipped vertically');
        check(same(source.clone().transform([0, -1, 1, 0, 0, 0]), source.clone().rotate(90)), 'transform: turned 90 degrees counterclockwise');
        check(same(source.clone().transform([-1, 0, 0, -1, 0, 0]), source.clone().rotate(180)), 'transform: turned 180 degrees');
        check(same(source.clone().transform([0, 1, -1, 0, 0, 0]), source.clone().rotate(270)), 'transform: turned 270 degrees');
        const turned = source.clone().transform([0, -1, 1, 0, 0, 0]);
        check(turned.width === 9 && turned.height === 13, `transform: a quarter turn swaps the size: ${turned.width}x${turned.height}`);

        // any angle: close to rotate() (counterclockwise 30 degrees), on a canvas that keeps its size
        const angle = 30 * Math.PI / 180, big = photo(40, 30);
        const ours = big.clone().transform([Math.cos(angle), -Math.sin(angle), Math.sin(angle), Math.cos(angle), 0, 0], {expand: false});
        const theirs = big.clone().rotate(30, {resize: false});
        let total = 0;
        for (let i = 0; i < ours.bitmap.length; i++) total += Math.abs(ours.bitmap[i] - theirs.bitmap[i]);
        check(ours.width === 40 && ours.height === 30 && total / ours.bitmap.length < 3, `transform: a rotation by any angle is rotate()'s (mean difference ${total / ours.bitmap.length})`);
        const grown = big.clone().transform([Math.cos(angle), -Math.sin(angle), Math.sin(angle), Math.cos(angle), 0, 0]);
        const expected = Math.abs(40 * Math.cos(angle)) + Math.abs(30 * Math.sin(angle));
        check(Math.abs(grown.width - expected) <= 1.5 && grown.height > 30, `transform grows to hold the rotated image: ${grown.width}x${grown.height} for ${expected}`);
        check(px(grown, 0, 0)[3] === 0 && px(grown, grown.width >> 1, grown.height >> 1)[3] === 255, 'transform: the corners are empty, the middle full');

        // shifts only show on a canvas that stays as large
        const shifted = source.clone().transform([1, 0, 0, 1, 2, 3], {expand: false});
        check(shifted.width === 13 && px(shifted, 4, 5).join() === px(source, 2, 2).join() && px(shifted, 1, 5)[3] === 0 && px(shifted, 4, 2)[3] === 0, 'transform: shifted by whole pixels');
        check(same(source.clone().transform([1, 0, 0, 1, 2, 3]), source), 'transform: a shift on a growing canvas is the image');

        // scaling: nearest neighbor makes blocks, around the origin
        const small = photo(5, 4);
        const doubled = small.clone().transform([2, 0, 0, 2, 0, 0], {mode: 'nearest-neighbor'});
        check(doubled.width === 10 && doubled.height === 8, `transform: doubled ${doubled.width}x${doubled.height}`);
        let blocks = true;
        for (let y = 0; y < 8; y++) for (let x = 0; x < 10; x++) blocks = blocks && px(doubled, x, y).join() === px(small, x >> 1, y >> 1).join();
        check(blocks, 'transform: nearest neighbor makes blocks');
        const halved = photo(8, 6).transform([0.5, 0, 0, 0.5, 0, 0], {mode: 'nearest-neighbor'});
        check(halved.width === 4 && halved.height === 3, 'transform: halved');
        const corner = small.clone().transform([2, 0, 0, 2, 0, 0], {expand: false, origin: {x: 0, y: 0}, mode: 'nearest-neighbor'});
        check(corner.width === 5 && px(corner, 3, 3).join() === px(small, 1, 1).join() && px(corner, 0, 0).join() === px(small, 0, 0).join(), 'transform: scaled from the top left corner');
        const centered = new Image(5, 5).fill((x, y) => x === 2 && y === 2 ? 0xff0000ff : 0x000000ff).transform([3, 0, 0, 3, 0, 0], {expand: false, mode: 'nearest-neighbor'});
        check(px(centered, 2, 2).join() === '255,0,0,255' && px(centered, 0, 0).join() === '0,0,0,255', 'transform: scaled around the middle by default');
        // a skew widens the image
        const slanted = photo(10, 10).transform([1, 0, 1, 1, 0, 0]);
        check(slanted.width === 20 && slanted.height === 10, `transform: skewed ${slanted.width}x${slanted.height}`);
        check(px(slanted, 1, 0)[3] === 255 && px(slanted, 19, 0)[3] === 0 && px(slanted, 18, 9)[3] === 255 && px(slanted, 0, 9)[3] === 0 && px(slanted, 0, 0)[3] > 100 && px(slanted, 0, 0)[3] < 160, `transform: the skewed corners (edges fade): ${px(slanted, 0, 0)[3]}`);

        // sampling modes: all stay in range and agree on flat areas
        const flat = new Image(20, 20).fill(0x336699ff);
        for (const mode of ['nearest-neighbor', 'bilinear', 'bicubic']) {
            const turnedFlat = flat.clone().transform([0.9, 0.4, -0.4, 0.9, 0, 0], {mode});
            const middle = px(turnedFlat, turnedFlat.width >> 1, turnedFlat.height >> 1);
            check(middle.join() === '51,102,153,255', `transform (${mode}): flat areas stay as they are: ${middle}`);
        }
        const edge = new Image(20, 20).fill((x) => x < 10 ? 0x000000ff : 0xffffffff);
        // (a slightly turned hard edge: the pixels across it, bicubic has fewer in between than bilinear and overshoots at most a little)
        const across = mode => {
            const turnedEdge = edge.clone().transform([0.99, 0.14, -0.14, 0.99, 0, 0], {mode, expand: false});
            let between = 0;
            for (let x = 0; x < 20; x++) if (px(turnedEdge, x, 10)[0] > 12 && px(turnedEdge, x, 10)[0] < 243) between++;
            return between;
        };
        check(across('nearest-neighbor') === 0 && across('bicubic') <= across('bilinear') && across('bilinear') > 0, `transform: the sampling modes smooth edges differently: ${across('nearest-neighbor')}, ${across('bilinear')}, ${across('bicubic')}`);
        // translucent pixels don't bleed their color
        const glass = new Image(8, 8).fill((x) => x < 4 ? 0xff000000 : 0x0000ffff);
        const glassTurned = glass.clone().transform([1, 0, 0.3, 1, 0, 0]);
        let bleed = 0;
        for (let i = 0; i < glassTurned.bitmap.length; i += 4) if (glassTurned.bitmap[i + 3] > 0 && glassTurned.bitmap[i] > 3) bleed++;
        check(bleed === 0, `transform: transparent pixels don't bleed their color: ${bleed} pixels`);

        // invalid input is refused, before the image changes
        for (const [label, bad, type] of [
            ['five values', [1, 0, 0, 1, 0], RangeError], ['seven values', [1, 0, 0, 1, 0, 0, 0], RangeError], ['null', null, RangeError], ['NaN', [1, 0, 0, NaN, 0, 0], RangeError],
            ['Infinity', [1, 0, 0, 1, Infinity, 0], RangeError], ['a string', [1, 0, 0, 1, 0, '0'], RangeError], ['all zeros', [0, 0, 0, 0, 0, 0], RangeError],
            ['a flat matrix', [1, 2, 2, 4, 0, 0], RangeError], ['a zero scale', [0, 0, 0, 1, 0, 0], RangeError], ['too large', [1e6, 0, 0, 1e6, 0, 0], RangeError]
        ]) {
            const image = photo(5, 5), before = image.bitmap.slice();
            throwsA(() => image.transform(bad), type, `transform with ${label}`);
            check(image.width === 5 && Buffer.from(image.bitmap).equals(Buffer.from(before)), `transform with ${label}: the image should be unchanged`);
        }
        throwsA(() => photo(5, 5).transform([1, 0, 0, 1, 0, 0], {mode: 'area'}), TypeError, 'transform with an unknown mode');
        throwsA(() => photo(5, 5).transform([1, 0, 0, 1, 0, 0], {origin: {x: NaN}}), RangeError, 'transform with a NaN origin');
        throwsA(() => photo(5, 5).transform([1, 0, 0, 1, 0, 0], null), TypeError, 'transform with null options');

        // a frame stays where it is: it grows up and left as far as its offset allows
        const frame = Frame.from(photo(20, 20), {duration: 40, xOffset: 3, yOffset: 50}).transform([Math.cos(Math.PI / 4), Math.sin(Math.PI / 4), -Math.sin(Math.PI / 4), Math.cos(Math.PI / 4), 0, 0]);
        check(frame instanceof Frame && frame.duration === 40 && frame.xOffset === 0 && frame.yOffset >= 45 && frame.yOffset < 50, `Frame.transform: offsets ${frame.xOffset},${frame.yOffset}`);
        const middle = Frame.from(photo(20, 20), {xOffset: 100, yOffset: 100}).transform([1, 0, 0.5, 1, 0, 0]);
        check(middle.width === 30 && middle.xOffset === 95 && middle.yOffset === 100, `Frame.transform with room grows left, its pixels stay where they were: ${middle.width}, offsets ${middle.xOffset},${middle.yOffset}`);

        // gain maps move with the image
        const hdr = photo(20, 10);
        hdr.gainMap = new GainMap(new Image(10, 5).fill((x) => x < 5 ? 0x000000ff : 0xffffffff), {gainMapMin: 0, gainMapMax: 2});
        const flipped = hdr.clone().transform([-1, 0, 0, 1, 0, 0]);
        check(flipped.gainMap && flipped.gainMap.width === 10 && flipped.gainMap.height === 5, 'transform keeps the gain map');
        check(px(flipped.gainMap.image, 0, 2)[0] > 200 && px(flipped.gainMap.image, 9, 2)[0] < 60, 'transform: the gain map is flipped with the image');
        const grownHdr = hdr.clone().transform([1, 0, 1, 1, 0, 0]);
        check(grownHdr.gainMap && Math.abs(grownHdr.gainMap.width / grownHdr.width - 0.5) < 0.1, 'transform: the gain map grows with the image');
        check((await Image.decode(await grownHdr.encodeJPEG())).gainMap, 'transform: the gain map of a transformed image is encoded');
    }
})().catch(error => panic(error.stack || String(error)));
