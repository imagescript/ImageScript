const fs = require('fs').promises;
const crypto = require('crypto');
const {Image} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

// what cjxl -e 1 writes (scripts/jxl-lossless-references.py): on CPUs with AVX2 or NEON (chunks of 16 pixels, what
// encodeJXL writes at effort 0), and without SIMD (chunks of 8); the sizes of cjxl -e 3's files (effort 1's are close)
const references = {
    16: {
        'external.png': '487aec362b353952b9f4c30dbb764293f3f78381e6b3a8372ec9895365a34970',
        'circle.png': 'cef97c2ac1002fb7303dd133b77013bf38d9df094fb68cf5377f9820d165ff45',
        'screen.png': '49e12698c3649bcb01a9886a94818f1ab1538424a8a4696a5bf74555d28124d7',
        'potato.png': 'e5f9166c9468f4477c175238aa0b422db0c785fc23349441d0bb73e0327b7fc3',
        'external.png grey': 'ecfd4f7b64078d48fb28ebd8f569484a6083b0b701633f2d599fe6dbc762eb3c'
    },
    8: {
        'external.png': 'e418c3a2c0aaf113b9af882cc04ae8d9e533b94daed3b46f52398d535c439733',
        'circle.png': '9e50886f2f1cca31d509fc305ffcf1fa90fe80e2c0c0e53ee61f800e319cfe05',
        'screen.png': 'cb6eb7cc0cb64dcd4397a0e8a8ff21482704d6992335040cf761d9eccec042fd',
        'potato.png': 'd0a2806f68b4ee0cc933a1221d46855b15ca23af8a970a227a6c7a00978a8ba1',
        'external.png grey': '51feda0399a3e76d681d671ed5d114b1c852ef23518d54f1f90f0bd7817f6602'
    }
};
const e3Sizes = {'external.png': 312341, 'circle.png': 1889, 'screen.png': 35408, 'potato.png': 4848, 'external.png grey': 164355};

// the samples of the channels encodeJXL picks
const samples = image => {
    const rgba = image.bitmap, n = image.width * image.height;
    let grey = true, opaque = true;
    for (let i = 0; i < 4 * n; i += 4) {
        if (rgba[i] !== rgba[i + 1] || rgba[i] !== rgba[i + 2]) grey = false;
        if (rgba[i + 3] !== 255) opaque = false;
    }
    const channels = [0, ...(grey ? [] : [1, 2]), ...(opaque ? [] : [3])], px = new Uint8Array(n * channels.length);
    for (let i = 0, k = 0; i < n; i++) for (const c of channels) px[k++] = rgba[4 * i + c];
    return [px, channels.length];
};

// the codestream of a container: the content of its last box, jxlc
const codestream = jxl => {
    let o = 0;
    while (o + Buffer.from(jxl).readUInt32BE(o) < jxl.length) o += Buffer.from(jxl).readUInt32BE(o);
    return jxl.subarray(o + 8);
};

(async () => {
    const {encode} = await import('../dist/codecs/jxl/fast-lossless.js');
    for (const [name, grey] of [['external.png'], ['circle.png'], ['screen.png'], ['potato.png'], ['external.png', true]]) {
        const key = name + (grey ? ' grey' : '');
        const image = await Image.decode(await fs.readFile(`./tests/targets/${name}`));
        // (grey: the red channel)
        if (grey) for (let i = 0; i < image.bitmap.length; i += 4) image.bitmap[i + 1] = image.bitmap[i + 2] = image.bitmap[i];
        const jxl = await image.encodeJXL({effort: 0});
        if (sha256(codestream(jxl)) !== references[16][key]) panic(`${key}: not what cjxl -e 1 writes`);
        const [px, channels] = samples(image);
        if (sha256(encode(px, image.width, image.height, channels, 8)) !== references[8][key]) panic(`${key}: not what cjxl -e 1 writes without SIMD`);
        const decoded = await Image.decode(jxl);
        if (Buffer.compare(Buffer.from(decoded.bitmap), Buffer.from(image.bitmap)) !== 0) panic(`${key}: not lossless`);
        // effort 1 (the default): like cjxl -e 3, within 2% (and some bytes of headers)
        const e1 = codestream(await image.encodeJXL());
        if (e1.length > e3Sizes[key] * 1.02 + 64) panic(`${key}, effort 1: ${e1.length} B, cjxl -e 3 ${e3Sizes[key]} B`);
        if (Buffer.compare(Buffer.from((await Image.decode(e1)).bitmap), Buffer.from(image.bitmap)) !== 0) panic(`${key}, effort 1: not lossless`);
    }

    // effort 1's transforms: a palette of all channels (or the colors without alpha), palettes of channels with few of
    // their values (with YCoCg after them), YCoCg alone, grey with alpha, frequent colors of the implicit palette; one
    // group (all in the global stream) and several, a pixel; the same with threads
    {
        const photo = (await Image.decode(await fs.readFile('./tests/targets/external.png'))).resize(300, 211);
        const few = new Image(300, 260);
        for (let y = 0; y < few.height; y++) for (let x = 0; x < few.width; x++) few.setPixelAt(x, y, [0xff0000ff, 0x00ff00ff, 0x123456ff, 0xffffff80][(x >> 4 ^ y >> 3) & 3]);
        const fewOpaque = few.clone();
        for (let i = 3; i < fewOpaque.bitmap.length; i += 4) fewOpaque.bitmap[i] = 255;
        const quantized = photo.clone(), alpha = photo.clone(), greyAlpha = photo.clone(), cube = new Image(64, 64).fill(0x000000ff);
        for (let i = 0; i < quantized.bitmap.length; i += 4) {
            quantized.bitmap[i] &= 0xe0;
            quantized.bitmap[i + 1] &= 0xf0;
            alpha.bitmap[i + 3] = (i >> 2) % 300;
            greyAlpha.bitmap[i] = greyAlpha.bitmap[i + 2] = greyAlpha.bitmap[i + 1];
            greyAlpha.bitmap[i + 3] = (i >> 4) & 255;
        }
        for (let x = 0; x < 64; x++) for (let y = 0; y < 8; y++) cube.setPixelAt(x, y, x & 1 ? 0xff3f00ff : y ? 0x7fbf3fff : 0x123456ff);
        // (a rare color of the implicit palette: by its implicit index)
        for (let x = 0; x < 3; x++) cube.setPixelAt(x, 63, 0x00ff00ff);
        const fewAlpha = few.clone();
        for (let i = 3; i < fewAlpha.bitmap.length; i += 4) fewAlpha.bitmap[i] = (i >> 2) % 251;
        const cases = {photo, few, fewOpaque, fewAlpha, quantized, alpha, greyAlpha, cube, pixel: new Image(1, 1).fill(0x336699ff)};
        for (const [name, image] of Object.entries(cases)) {
            const jxl = await image.encodeJXL({threads: 1, metadata: {creationTime: 0}});
            if (Buffer.compare(Buffer.from((await Image.decode(jxl)).bitmap), Buffer.from(image.bitmap)) !== 0) panic(`effort 1, ${name}: not lossless`);
            if (jxl.length > (await image.encodeJXL({effort: 0, metadata: {creationTime: 0}})).length) panic(`effort 1, ${name}: larger than effort 0`);
        }
        const large = photo.clone().resize(800, 660);
        for (let i = 3; i < large.bitmap.length; i += 4) large.bitmap[i] = (i >> 2) % large.width & 255;
        const one = await large.encodeJXL({threads: 1, metadata: {creationTime: 0}}), four = await large.encodeJXL({threads: 4, metadata: {creationTime: 0}});
        if (Buffer.compare(Buffer.from(one), Buffer.from(four))) panic('lossless threads: not the same file');
        if (Buffer.compare(Buffer.from((await Image.decode(four)).bitmap), Buffer.from(large.bitmap))) panic('lossless threads: not lossless');
    }

    // two colors of the same hash in the palette detection's chunk of 8 pixels (libjxl misses that, losing a color)
    const image = new Image(16, 16).fill(0xc86432ff);
    image.setPixelAt(1, 1, 0x010000ff);
    image.setPixelAt(2, 1, 0x76c500ff);
    const decoded = await Image.decode(await image.encodeJXL({effort: 0}));
    if (decoded.getPixelAt(1, 1) !== 0x010000ff || decoded.getPixelAt(2, 1) !== 0x76c500ff) panic('colors of the same hash');
    // a pixel; transparent grey
    for (const [w, h, color] of [[1, 1, 0x123456ff], [5, 3, 0x80808040]]) {
        const small = new Image(w, h).fill(color);
        const back = await Image.decode(await small.encodeJXL({effort: 0}));
        if (back.width !== w || back.height !== h || back.getPixelAt(0, 0) !== color) panic(`${w}x${h}: not lossless`);
    }

    // lossy: better and larger with the quality, alpha lossless (in the global stream for one group, else in the
    // groups'), sizes of several groups and partial blocks; 100 is lossless
    const psnr = (a, b) => {
        let se = 0, n = 0;
        for (let i = 0; i < a.bitmap.length; i++) if ((i & 3) !== 3) {
            se += (a.bitmap[i] - b.bitmap[i]) ** 2;
            n++;
        }
        return 10 * Math.log10(255 * 255 * n / se);
    };
    const photo = (await Image.decode(await fs.readFile('./tests/targets/external.png'))).resize(300, 211);
    let last = 0, lastPsnr = 0;
    for (const quality of [30, 75, 95]) {
        const jxl = await photo.encodeJXL({quality, effort: 0});
        const p = psnr(photo, await Image.decode(jxl));
        if (jxl.length <= last || p <= lastPsnr) panic(`quality ${quality}: not larger and better (${jxl.length} B, ${p.toFixed(2)} dB)`);
        if (p < {30: 29, 75: 32, 95: 38.5}[quality]) panic(`quality ${quality}: ${p.toFixed(2)} dB`);
        last = jxl.length;
        lastPsnr = p;
    }
    for (const [w, h] of [[300, 211], [100, 60]]) {
        const image = photo.clone().crop(0, 0, w, h);
        for (let i = 3; i < image.bitmap.length; i += 4) image.bitmap[i] = (i >> 2) % 251;
        const back = await Image.decode(await image.encodeJXL({quality: 90, effort: 0}));
        for (let i = 3; i < image.bitmap.length; i += 4) if (back.bitmap[i] !== image.bitmap[i]) panic(`${w}x${h}: lossy alpha`);
    }
    // efforts: the varblock search (every transform at effort 2) for no worse files; a screenshot's large flat areas
    const shot = (await Image.decode(await fs.readFile('./tests/targets/screen.png'))).crop(0, 0, 256, 128);
    let effort0 = 0;
    for (const effort of [0, 1, 2]) {
        const jxl = await shot.encodeJXL({quality: 90, effort});
        const p = psnr(shot, await Image.decode(jxl));
        if (p < 31) panic(`effort ${effort}: ${p.toFixed(2)} dB`);
        if (effort === 0) effort0 = jxl.length;
        else if (jxl.length > effort0 * 1.02) panic(`effort ${effort}: ${jxl.length} B, effort 0 ${effort0} B`);
    }
    for (const effort of [-1, 3, 1.5]) if (!await shot.encodeJXL({quality: 90, effort}).then(() => false, e => e instanceof RangeError)) panic(`effort ${effort} should throw`);
    // threads (XYB, the quantization field, the varblock search, the coefficients and their tokens in parallel): the
    // same files as without; at effort 0 from 1024x1024 pixels on, with alpha
    {
        const big = photo.clone().resize(640, Image.RESIZE_AUTO), large = photo.clone().resize(1024, 1032);
        for (let i = 3; i < large.bitmap.length; i += 4) large.bitmap[i] = (i >> 2) % large.width & 255;
        for (const [image, effort] of [[big, 1], [big, 2], [large, 0]]) {
            const one = await image.encodeJXL({quality: 85, effort, threads: 1, metadata: {creationTime: 0}});
            const four = await image.encodeJXL({quality: 85, effort, threads: 4, metadata: {creationTime: 0}});
            if (Buffer.compare(Buffer.from(one), Buffer.from(four))) panic(`threads, effort ${effort}: not the same file`);
        }
        for (const threads of [0, 2.5]) if (!await big.encodeJXL({quality: 85, threads}).then(() => false, e => e instanceof RangeError)) panic(`threads ${threads} should throw`);
    }
    // patches (effort 2): repeated glyphs of text on a flat background are found, stored in a reference frame and
    // added back
    {
        const text = await Image.renderText(await fs.readFile('./tests/fonts/opensans bold.ttf'), 18, 'abba cabbage\nbeach bag cab\nabba cabbage', 0x202020ff);
        const page = new Image(text.width + 16, text.height + 16).fill(0xf4f4f4ff).composite(text, 8, 8);
        const {findPatches} = await import('../dist/codecs/jxl/patches-enc.js');
        const w = page.width, h = page.height, planes = [0, 1, 2].map(c => Float32Array.from({length: w * h}, (_, i) => page.bitmap[i * 4 + c] / 255));
        if (!findPatches(planes, w, w, h, 1, 0)) panic('patches: none found in text');
        const jxl = await page.encodeJXL({quality: 90, effort: 2});
        const p = psnr(page, await Image.decode(jxl));
        if (p < 35) panic(`patches: ${p.toFixed(2)} dB`);
    }
    const pixel = await Image.decode(await new Image(1, 1).fill(0x336699ff).encodeJXL({quality: 90}));
    if (pixel.width !== 1 || Math.abs((pixel.getPixelAt(0, 0) >>> 24) - 0x33) > 2) panic('1x1 lossy');
    const lossless = await Image.decode(await photo.encodeJXL({quality: 100}));
    if (Buffer.compare(Buffer.from(lossless.bitmap), Buffer.from(photo.bitmap))) panic('quality 100 isn\'t lossless');
    for (const quality of [-1, 101, NaN]) if (!await photo.encodeJXL({quality}).then(() => false, e => e instanceof RangeError)) panic(`quality ${quality} should throw`);
})();
