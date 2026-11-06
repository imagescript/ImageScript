// One adapter per library, all with the same operations. Operations take a decoded image and return a new one
// (libraries that change images in place clone first), so every run starts from the same input. Missing operations
// are ones the library doesn't have.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);

// IMAGESCRIPT=local measures this checkout (npm run build first) instead of the version from npm
const ImageScript = await import(process.env.IMAGESCRIPT === 'local' ? '../dist/index.js' : 'imagescript');
const { Jimp, ResizeStrategy } = await import('jimp');
const sharp = (await import('sharp')).default;
// (as many threads as ImageScript uses by default: sharp's default on glibc Linux without jemalloc, like CI's, is one)
sharp.concurrency(Math.min(os.availableParallelism(), 8));
const canvas = await import('@napi-rs/canvas');
const imageJS = await import('image-js');
const photon = require('@silvia-odwyer/photon-node');
const { createImageLibrary } = await import('purejsimage');
const { allCodecs } = await import('purejsimage/codecs/all');
const pureJsImage = createImageLibrary(allCodecs);
// jsquash: Squoosh's libavif and libjxl builds (their threaded builds are off in Node: one thread), the modules given
const jsquash = {};
for (const [name, file] of [['avif/encode', 'avif/codec/enc/avif_enc.wasm'], ['avif/decode', 'avif/codec/dec/avif_dec.wasm'],
    ['jxl/encode', 'jxl/codec/enc/jxl_enc.wasm'], ['jxl/decode', 'jxl/codec/dec/jxl_dec.wasm']]) {
    const codec = await import(`@jsquash/${name}.js`);
    await codec.init(await WebAssembly.compile(fs.readFileSync(new URL(`./node_modules/@jsquash/${file}`, import.meta.url))));
    jsquash[name] = codec.default;
}

/** libavif's or libjxl's RGBA of an AVIF or JPEG XL (for the quality of the encoded files) */
export const referenceDecode = async (data, format) => (await jsquash[`${format}/decode`](data)).data;

// lossy WebP, AVIF and JPEG XL at the same nominal quality in every library (their scales differ: the file sizes come
// with their PSNR)
export const WEBP_QUALITY = 80, AVIF_QUALITY = 60, JXL_QUALITY = 90;
// libjxl (jsquash) at the effort ImageScript's default matches: cjxl -e 5 lossy, -e 3 lossless (its own default is 7)
const JXL_EFFORT = 5, JXL_LOSSLESS_EFFORT = 3;

// the same work in every library: halve the size (bilinear where it can be chosen, and bicubic), a 400×400 thumbnail
// covering it (cropping the sides off, bilinear), rotate by 30° (growing the image to fit) and by 90°, mirror it, blur
// with a radius/sigma of 5, sharpen (unsharp mask of radius/sigma 1, or the library's sharpen), place a
// semi-transparent overlay, cut out a quarter, greyscale, brightness and contrast up 20%
const RESIZE = [960, 540], THUMB = 400, ANGLE = 30, BLUR = 5, AT = [100, 100], CROP = [480, 270, 960, 540], ADJUST = 1.2;

// rendering: one line of text in Source Sans 3 at 64px, white; tests/svgs/features.svg (240×160) scaled to 1920 wide
export const FONT_FILE = new URL('../tests/fonts/sourcesans3 regular.otf', import.meta.url);
export const SVG_FILE = new URL('../tests/svgs/features.svg', import.meta.url);
export const TEXT = 'The quick brown fox jumps over the lazy dog, 0123456789', TEXT_SIZE = 64, SVG_WIDTH = 1920;
const font = fs.readFileSync(FONT_FILE), svg = fs.readFileSync(SVG_FILE, 'utf8');
const svgScale = SVG_WIDTH / Number(svg.match(/<svg[^>]*\swidth="(\d+)/)[1]);
const svgAtWidth = svg.replace(/<svg[^>]*>/, tag => tag.replace(/\s(width|height)="(\d+)"/g, (_, name, value) => ` ${name}="${Math.round(value * svgScale)}"`));

const imageScript = IS => ({
    name: 'ImageScript', package: 'imagescript', kind: 'JavaScript',
    decodes: ['avif', 'jxl'],
    decode: data => IS.Image.decode(data),
    encode: {
        png: image => image.encode(),
        jpeg: image => image.encodeJPEG(80),
        webp: image => image.encodeWebP(),
        webpLossy: image => image.encodeWebP({ quality: WEBP_QUALITY }),
        avif: image => image.encodeAVIF({ quality: AVIF_QUALITY }),
        jxl: image => image.encodeJXL({ quality: JXL_QUALITY }),
        jxlLossless: image => image.encodeJXL()
    },
    resize: image => image.clone().resize(...RESIZE, IS.Image.RESIZE_BILINEAR),
    resizeBicubic: image => image.clone().resize(...RESIZE, IS.Image.RESIZE_BICUBIC),
    cover: image => image.clone().cover(THUMB, THUMB, IS.Image.RESIZE_BILINEAR),
    rotate: image => image.clone().rotate(ANGLE),
    rotate90: image => image.clone().rotate(90),
    flip: image => image.clone().flip('horizontal'),
    blur: image => image.clone().blur(BLUR),
    sharpen: image => image.clone().sharpen(1, 1),
    composite: (image, overlay) => image.clone().composite(overlay, ...AT),
    crop: image => image.clone().crop(...CROP),
    greyscale: image => image.clone().greyscale(),
    adjust: image => image.clone().brightness(ADJUST).contrast(ADJUST),
    // an Ultra HDR photo to a thumbnail that stays HDR: decoded, covered and encoded with its gain map
    hdrThumbnail: async data => (await IS.Image.decode(data)).cover(THUMB, THUMB, IS.Image.RESIZE_BILINEAR).encodeJPEG(80),
    text: () => IS.Image.renderText(font, TEXT_SIZE, TEXT),
    svg: () => IS.Image.renderSVG(svg, SVG_WIDTH, IS.Image.SVG_MODE_WIDTH),
    animation: {
        decode: data => IS.Animation.decode(data),
        encode: animation => animation.encodeGIF(),
        encodeWebP: animation => animation.encodeWebP({ quality: WEBP_QUALITY })
    }
});

// sharp works on pipelines: a decoded image is its raw pixels, every operation runs a pipeline back to raw pixels
const raw = (data, info) => ({ data, width: info.width, height: info.height });
const pipeline = image => sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } });
const toRaw = async p => { const { data, info } = await p.raw().toBuffer({ resolveWithObject: true }); return raw(data, info); };

// canvas: a decoded image is a canvas
const drawn = (width, height, draw) => {
    const c = canvas.createCanvas(width, height);
    const ctx = c.getContext('2d');
    draw(ctx);
    ctx.getImageData(0, 0, 1, 1); // Skia draws lazily: reading a pixel makes it actually render inside the measured call
    return c;
};

export const libraries = [
    imageScript(ImageScript),
    {
        name: 'Jimp', package: 'jimp', kind: 'JavaScript',
        decode: data => Jimp.fromBuffer(data),
        encode: {
            png: image => image.getBuffer('image/png'),
            jpeg: image => image.getBuffer('image/jpeg', { quality: 80 })
        },
        resize: image => image.clone().resize({ w: RESIZE[0], h: RESIZE[1], mode: ResizeStrategy.BILINEAR }),
        resizeBicubic: image => image.clone().resize({ w: RESIZE[0], h: RESIZE[1], mode: ResizeStrategy.BICUBIC }),
        cover: image => image.clone().cover({ w: THUMB, h: THUMB, mode: ResizeStrategy.BILINEAR }),
        rotate: image => image.clone().rotate(ANGLE),
        rotate90: image => image.clone().rotate(90),
        flip: image => image.clone().flip({ horizontal: true }),
        blur: image => image.clone().gaussian(BLUR),
        composite: (image, overlay) => image.clone().composite(overlay, ...AT),
        crop: image => image.clone().crop({ x: CROP[0], y: CROP[1], w: CROP[2], h: CROP[3] }),
        greyscale: image => image.clone().greyscale(),
        // (its brightness multiplies like the others, its contrast takes -1..1: 0.2 is 20% more)
        adjust: image => image.clone().brightness(ADJUST).contrast(ADJUST - 1)
    },
    {
        name: 'image-js', package: 'image-js', kind: 'JavaScript',
        decode: data => imageJS.decode(data).convertColor('RGBA'),
        encode: {
            png: image => imageJS.encodePng(image),
            jpeg: image => imageJS.encodeJpeg(image, { quality: 80 })
        },
        resize: image => image.resize({ width: RESIZE[0], height: RESIZE[1], interpolationType: 'bilinear' }),
        resizeBicubic: image => image.resize({ width: RESIZE[0], height: RESIZE[1], interpolationType: 'bicubic' }),
        rotate: image => image.transformRotate(ANGLE, { fullImage: true }),
        rotate90: image => image.rotate(90),
        flip: image => image.flip(),
        blur: image => image.gaussianBlur({ sigma: BLUR }),
        composite: (image, overlay) => overlay.copyTo(image.clone(), { origin: { column: AT[0], row: AT[1] } }),
        crop: image => image.crop({ origin: { column: CROP[0], row: CROP[1] }, width: CROP[2], height: CROP[3] }),
        // (to one grey channel and alpha)
        greyscale: image => image.grey({ keepAlpha: true })
    },
    {
        // PureJsImage works on pipelines from encoded data to encoded data, without decoded images: a decoded image is
        // a BMP, its fastest uncompressed format (a BMP to BMP pipeline takes about 40 ms on the photo), and every
        // operation runs a pipeline from it back to a BMP, like sharp's raw pixels
        name: 'PureJsImage', package: 'purejsimage', kind: 'JavaScript', decodes: ['avif', 'jxl'],
        decode: async data => toBmp(await pureJsImage.open(data)),
        encode: {
            png: async image => (await pureJsImage.open(image)).png().toUint8Array(),
            jpeg: async image => (await pureJsImage.open(image)).jpeg({ quality: 80 }).toUint8Array(),
            webp: async image => (await pureJsImage.open(image)).webp({ lossless: true }).toUint8Array(),
            webpLossy: async image => (await pureJsImage.open(image)).webp({ quality: WEBP_QUALITY }).toUint8Array(),
            // (it has no quality option)
            avif: async image => (await pureJsImage.open(image)).avif().toUint8Array()
        },
        resize: async image => toBmp((await pureJsImage.open(image)).resize({ width: RESIZE[0], height: RESIZE[1], kernel: 'bilinear', fit: 'fill' })),
        cover: async image => toBmp((await pureJsImage.open(image)).resize({ width: THUMB, height: THUMB, kernel: 'bilinear', fit: 'cover' })),
        rotate: async image => toBmp((await pureJsImage.open(image)).rotate(ANGLE, { background: 'transparent' })),
        rotate90: async image => toBmp((await pureJsImage.open(image)).rotate(90)),
        flip: async image => toBmp((await pureJsImage.open(image)).flop()),
        crop: async image => toBmp((await pureJsImage.open(image)).crop({ x: CROP[0], y: CROP[1], width: CROP[2], height: CROP[3] }))
    },
    {
        name: 'Photon', package: '@silvia-odwyer/photon-node', kind: 'WebAssembly', collect: true,
        decode: data => photon.PhotonImage.new_from_byteslice(new Uint8Array(data)),
        encode: {
            png: image => image.get_bytes(),
            jpeg: image => image.get_bytes_jpeg(80),
            webp: image => image.get_bytes_webp()
        },
        resize: image => photon.resize(image, ...RESIZE, photon.SamplingFilter.Triangle),
        resizeBicubic: image => photon.resize(image, ...RESIZE, photon.SamplingFilter.CatmullRom),
        rotate: image => photon.rotate(image, ANGLE),
        rotate90: image => photon.rotate(image, 90),
        flip: image => inPlace(image, photon.fliph),
        blur: image => inPlace(image, copy => photon.gaussian_blur(copy, BLUR)),
        // (a 3×3 sharpening kernel)
        sharpen: image => inPlace(image, photon.sharpen),
        composite: (image, overlay) => inPlace(image, copy => photon.watermark(copy, overlay, BigInt(AT[0]), BigInt(AT[1]))),
        crop: image => photon.crop(image, CROP[0], CROP[1], CROP[0] + CROP[2], CROP[1] + CROP[3]),
        greyscale: image => inPlace(image, photon.grayscale),
        // (its brightness adds, 20% of 255; its contrast takes -255..255: 23.4 is a factor of 1.2,
        // 259 (c + 255) / (255 (259 - c)))
        adjust: image => inPlace(image, copy => { photon.adjust_brightness(copy, Math.round(255 * (ADJUST - 1))); photon.adjust_contrast(copy, 23.4); })
    },
    {
        name: 'sharp', package: 'sharp', kind: 'native (libvips)', decodes: ['avif'],
        decode: async data => toRaw(sharp(data).ensureAlpha()),
        encode: {
            png: image => pipeline(image).png().toBuffer(),
            jpeg: image => pipeline(image).jpeg({ quality: 80 }).toBuffer(),
            webp: image => pipeline(image).webp({ lossless: true }).toBuffer(),
            webpLossy: image => pipeline(image).webp({ quality: WEBP_QUALITY }).toBuffer(),
            avif: image => pipeline(image).avif({ quality: AVIF_QUALITY }).toBuffer()
        },
        resize: image => toRaw(pipeline(image).resize(...RESIZE, { kernel: 'linear', fit: 'fill' })),
        resizeBicubic: image => toRaw(pipeline(image).resize(...RESIZE, { kernel: 'cubic', fit: 'fill' })),
        cover: image => toRaw(pipeline(image).resize(THUMB, THUMB, { kernel: 'linear', fit: 'cover' })),
        rotate: image => toRaw(pipeline(image).rotate(ANGLE, { background: { r: 0, g: 0, b: 0, alpha: 0 } })),
        rotate90: image => toRaw(pipeline(image).rotate(90)),
        flip: image => toRaw(pipeline(image).flop()),
        blur: image => toRaw(pipeline(image).blur(BLUR)),
        sharpen: image => toRaw(pipeline(image).sharpen({ sigma: 1 })),
        // (to one grey channel and alpha)
        greyscale: image => toRaw(pipeline(image).greyscale()),
        adjust: image => toRaw(pipeline(image).linear(ADJUST, 0).linear(ADJUST, 128 * (1 - ADJUST))),
        composite: async (image, overlay) => toRaw(pipeline(image).composite([{
            input: overlay.data, raw: { width: overlay.width, height: overlay.height, channels: 4 }, left: AT[0], top: AT[1]
        }])),
        crop: image => toRaw(pipeline(image).extract({ left: CROP[0], top: CROP[1], width: CROP[2], height: CROP[3] })),
        // (withGainMap: an HDR image in floats, and a new gain map made for the JPEG)
        hdrThumbnail: data => sharp(data).withGainMap().resize(THUMB, THUMB, { kernel: 'linear', fit: 'cover' }).jpeg({ quality: 80 }).toBuffer(),
        // pango sizes fonts in points: at 72 dpi a point is a pixel
        text: () => toRaw(sharp({ text: { text: `<span foreground="white">${TEXT}</span>`, font: `Source Sans 3 ${TEXT_SIZE}`, fontfile: fileURLToPath(FONT_FILE), dpi: 72, rgba: true } })),
        svg: () => toRaw(sharp(Buffer.from(svg), { density: 72 * svgScale }).ensureAlpha()),
        animation: {
            decode: async data => { const { data: pixels, info } = await sharp(data, { animated: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { pixels, info }; },
            encode: ({ pixels, info }) => sharp(pixels, { raw: { width: info.width, height: info.height, channels: 4, pageHeight: info.pageHeight } })
                .gif({ delay: info.delay, loop: info.loop }).toBuffer(),
            encodeWebP: ({ pixels, info }) => sharp(pixels, { raw: { width: info.width, height: info.height, channels: 4, pageHeight: info.pageHeight } })
                .webp({ quality: WEBP_QUALITY, delay: info.delay, loop: info.loop }).toBuffer()
        }
    },
    {
        // AVIF and JPEG XL only: a decoded image is an ImageData, made from raw pixels for the other inputs
        name: 'jsquash', package: '@jsquash/avif', packages: ['@jsquash/avif', '@jsquash/jxl'], kind: 'WebAssembly', decodes: ['avif', 'jxl'],
        fromPixels: ({ data, width, height }) => ({ data: new Uint8ClampedArray(data), width, height, colorSpace: 'srgb' }),
        decode: data => data[4] === 0x66 && data[5] === 0x74 ? jsquash['avif/decode'](data) : jsquash['jxl/decode'](data),
        encode: {
            avif: image => jsquash['avif/encode'](image, { quality: AVIF_QUALITY }),
            jxl: image => jsquash['jxl/encode'](image, { quality: JXL_QUALITY, effort: JXL_EFFORT }),
            jxlLossless: image => jsquash['jxl/encode'](image, { lossless: true, effort: JXL_LOSSLESS_EFFORT })
        }
    },
    {
        name: '@napi-rs/canvas', package: '@napi-rs/canvas', kind: 'native (Skia)', collect: true,
        decode: async data => { const image = await canvas.loadImage(data); return drawn(image.width, image.height, ctx => ctx.drawImage(image, 0, 0)); },
        encode: {
            png: c => c.encode('png'),
            jpeg: c => c.encode('jpeg', 80),
            webp: c => c.encode('webp', 100),
            webpLossy: c => c.encode('webp', WEBP_QUALITY)
        },
        resize: c => drawn(...RESIZE, ctx => ctx.drawImage(c, 0, 0, ...RESIZE)),
        // (the middle square of the image, scaled)
        cover: c => { const side = Math.min(c.width, c.height); return drawn(THUMB, THUMB, ctx => ctx.drawImage(c, (c.width - side) / 2, (c.height - side) / 2, side, side, 0, 0, THUMB, THUMB)); },
        rotate: c => {
            const r = ANGLE * Math.PI / 180, w = Math.ceil(c.width * Math.cos(r) + c.height * Math.sin(r)), h = Math.ceil(c.width * Math.sin(r) + c.height * Math.cos(r));
            return drawn(w, h, ctx => { ctx.translate(w / 2, h / 2); ctx.rotate(-r); ctx.drawImage(c, -c.width / 2, -c.height / 2); });
        },
        rotate90: c => drawn(c.height, c.width, ctx => { ctx.translate(c.height, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(c, 0, 0); }),
        flip: c => drawn(c.width, c.height, ctx => { ctx.scale(-1, 1); ctx.drawImage(c, -c.width, 0); }),
        blur: c => drawn(c.width, c.height, ctx => { ctx.filter = `blur(${BLUR}px)`; ctx.drawImage(c, 0, 0); }),
        composite: (c, overlay) => drawn(c.width, c.height, ctx => { ctx.drawImage(c, 0, 0); ctx.drawImage(overlay, ...AT); }),
        crop: c => drawn(CROP[2], CROP[3], ctx => ctx.drawImage(c, -CROP[0], -CROP[1])),
        greyscale: c => drawn(c.width, c.height, ctx => { ctx.filter = 'grayscale(1)'; ctx.drawImage(c, 0, 0); }),
        adjust: c => drawn(c.width, c.height, ctx => { ctx.filter = `brightness(${ADJUST}) contrast(${ADJUST})`; ctx.drawImage(c, 0, 0); }),
        text: () => {
            const measure = canvas.createCanvas(1, 1).getContext('2d');
            measure.font = `${TEXT_SIZE}px "Source Sans 3"`;
            const m = measure.measureText(TEXT);
            return drawn(Math.ceil(m.width), Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent), ctx => {
                ctx.font = measure.font; ctx.fillStyle = '#fff'; ctx.fillText(TEXT, 0, Math.ceil(m.actualBoundingBoxAscent));
            });
        },
        // Skia rasterizes an SVG at its own width and height, so they're set to the output size (the viewBox scales)
        svg: async () => {
            const image = await canvas.loadImage(Buffer.from(svgAtWidth));
            return drawn(image.width, image.height, ctx => ctx.drawImage(image, 0, 0));
        }
    }
];
canvas.GlobalFonts.register(font, 'Source Sans 3');

function toBmp(image) {
    return image.bmp({ alpha: true }).toUint8Array();
}

function clonePhoton(image) {
    return new photon.PhotonImage(image.get_raw_pixels(), image.get_width(), image.get_height());
}

// Photon changes images in place: on a copy
function inPlace(image, fn) {
    const copy = clonePhoton(image);
    fn(copy);
    return copy;
}

