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
const IDENTITY = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

(async () => {
    // colorMatrix
    {
        const source = new Image(3, 2).fill((x, y) => [0x0a141ec8, 0x64c8ffff, 0xff000000, 0x00ff0080, 0x336699ff, 0xffffffff][y * 3 + x]);
        check(same(source.clone().colorMatrix(IDENTITY), source), 'colorMatrix: the identity changes nothing');
        check(same(source.clone().colorMatrix([1, 0, 0, 0, 1, 0, 0, 0, 1]), source), 'colorMatrix: the 3x3 identity changes nothing');
        check(same(source.clone().colorMatrix(new Float32Array(IDENTITY)), source), 'colorMatrix: typed arrays are values too');
        // red and blue swapped, the alpha as it is
        const swapped = source.clone().colorMatrix([0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0]);
        check(px(swapped, 0, 0).join() === '30,20,10,200', `colorMatrix: swapped channels ${px(swapped, 0, 0)}`);
        check(same(source.clone().colorMatrix([0, 0, 1, 0, 1, 0, 1, 0, 0]), source.clone().colorMatrix([0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0])), 'colorMatrix: nine values are twenty with the alpha left alone');
        // offsets are 0 to 1, the alpha row can set the alpha
        check(px(source.clone().colorMatrix([1, 0, 0, 0, 0.2, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]), 0, 0).join() === '61,20,30,200', 'colorMatrix: offsets are 0 to 1');
        check(px(source.clone().colorMatrix([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]), 2, 0).join() === '255,0,0,255', 'colorMatrix: an offset in the alpha row makes it opaque');
        check(px(source.clone().colorMatrix([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0.5, 0]), 1, 0)[3] === 128, 'colorMatrix: the alpha is scaled');
        // greyscale by the luminance: 0.2126 * 100 + 0.7152 * 150 + 0.0722 * 200 = 143
        const luma = [0.2126, 0.7152, 0.0722, 0, 0];
        const grey = new Image(1, 1).fill(0x6496c8ff).colorMatrix([...luma, ...luma, ...luma, 0, 0, 0, 1, 0]);
        check(px(grey, 0, 0).join() === '143,143,143,255', `colorMatrix: greyscale ${px(grey, 0, 0)}`);
        // results are clamped
        check(px(new Image(1, 1).fill(0x6496c8ff).colorMatrix([3, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]), 0, 0).join() === '255,0,200,255', 'colorMatrix: clamped');
        // the sepia() of the library is such a matrix
        const sepia = [0.393, 0.769, 0.189, 0, 0, 0.349, 0.686, 0.168, 0, 0, 0.272, 0.534, 0.131, 0, 0, 0, 0, 0, 1, 0];
        check(same(photo(20, 15).colorMatrix(sepia), photo(20, 15).sepia()), 'colorMatrix: the sepia matrix is sepia()');

        for (const [label, bad] of Object.entries({
            'eight values': new Array(8).fill(1), 'twenty-one values': new Array(21).fill(0), 'none': [], 'a number': 5, 'null': null, 'NaN': [...IDENTITY.slice(0, 19), NaN],
            'a string': [...IDENTITY.slice(0, 19), '1'], 'Infinity': [Infinity, ...IDENTITY.slice(1)]
        })) {
            const image = photo(4, 4), before = image.bitmap.slice();
            throwsA(() => image.colorMatrix(bad), RangeError, `colorMatrix with ${label}`);
            check(Buffer.from(image.bitmap).equals(Buffer.from(before)), `colorMatrix with ${label}: the image should be unchanged`);
        }

        const frame = new Frame(photo(4, 4).colorMatrix(sepia), {duration: 40, xOffset: 2, yOffset: 3});
        check(frame instanceof Frame && frame.duration === 40 && frame.xOffset === 2 && frame.yOffset === 3 && same(frame.image, photo(4, 4).sepia()), 'colorMatrix on a frame');

        const hdr = photo(8, 8);
        hdr.gainMap = new GainMap(new Image(4, 4).fill(0xc0c0c0ff), {min: 0, max: 2});
        hdr.colorMatrix(sepia);
        check(hdr.gainMap && hdr.gainMap.width === 4 && hdr.gainMap.height === 4, 'colorMatrix with a gain map keeps it');
        check((await Image.decode(await hdr.encodeJPEG())).gainMap, 'colorMatrix: the gain map is still encoded');
    }
})().catch(error => panic(error.stack || String(error)));
