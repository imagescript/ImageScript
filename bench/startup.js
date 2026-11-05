// Measures one library's startup and memory (node --expose-gc startup.js <name>), in a fresh process that loads
// nothing else, and prints them as JSON: the time until its first image (the import, until it can be used, and a first
// job: a 1920×1080 JPEG decoded, halved and encoded as a JPEG again, nothing compiled or warmed up yet), and the peak
// memory of that job. run.js runs it several times per library and keeps the medians
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const photo = fs.readFileSync(new URL('./inputs/photo.jpg', import.meta.url));
const [W, H] = [960, 540];

// each library: what importing it takes until it can be used, and the job with it (none for jsquash: AVIF and JPEG XL
// only, its codecs compiled for the import)
const LIBRARIES = {
    ImageScript: {
        load: () => import(process.env.IMAGESCRIPT === 'local' ? '../dist/index.js' : 'imagescript'),
        job: async ({ Image }) => (await Image.decode(photo)).resize(W, H).encodeJPEG(80)
    },
    Jimp: {
        load: () => import('jimp'),
        job: async ({ Jimp }) => (await Jimp.fromBuffer(photo)).resize({ w: W, h: H }).getBuffer('image/jpeg', { quality: 80 })
    },
    'image-js': {
        load: () => import('image-js'),
        job: async ({ decode, encodeJpeg }) => encodeJpeg(decode(photo).resize({ width: W, height: H }), { quality: 80 })
    },
    PureJsImage: {
        load: async () => {
            const [{ createImageLibrary }, { allCodecs }] = await Promise.all([import('purejsimage'), import('purejsimage/codecs/all')]);
            return createImageLibrary(allCodecs);
        },
        job: async lib => (await lib.open(photo)).resize({ width: W, height: H, fit: 'fill' }).jpeg({ quality: 80 }).toUint8Array()
    },
    Photon: {
        load: () => require('@silvia-odwyer/photon-node'),
        job: photon => photon.resize(photon.PhotonImage.new_from_byteslice(photo), W, H, photon.SamplingFilter.Triangle).get_bytes_jpeg(80)
    },
    sharp: {
        load: async () => (await import('sharp')).default,
        job: sharp => sharp(photo).resize(W, H, { fit: 'fill' }).jpeg({ quality: 80 }).toBuffer()
    },
    jsquash: {
        load: async () => {
            const codecs = {};
            for (const [name, file] of [['avif/encode', 'avif/codec/enc/avif_enc.wasm'], ['avif/decode', 'avif/codec/dec/avif_dec.wasm'],
                ['jxl/encode', 'jxl/codec/enc/jxl_enc.wasm'], ['jxl/decode', 'jxl/codec/dec/jxl_dec.wasm']]) {
                const codec = await import(`@jsquash/${name}.js`);
                await codec.init(await WebAssembly.compile(fs.readFileSync(new URL(`./node_modules/@jsquash/${file}`, import.meta.url))));
                codecs[name] = codec.default;
            }
            return codecs;
        }
    },
    '@napi-rs/canvas': {
        load: () => import('@napi-rs/canvas'),
        job: async ({ createCanvas, loadImage }) => {
            const image = await loadImage(photo), c = createCanvas(W, H);
            c.getContext('2d').drawImage(image, 0, 0, W, H);
            return c.encode('jpeg', 80);
        }
    }
};

const lib = LIBRARIES[process.argv[2]];
if (!lib) throw new Error(`unknown library ${process.argv[2]}, one of: ${Object.keys(LIBRARIES).join(', ')}`);

// memory: the resident set (V8's heap, WebAssembly memories and native allocations alike). The job's peak is the
// kernel's high-water mark, reset after the import (Linux), over the set before the job: the memory the first job
// takes (a second one would reuse what the first left committed)
const rss = () => process.memoryUsage.rss();
const hwm = () => Number(fs.readFileSync('/proc/self/status', 'utf8').match(/VmHWM:\s+(\d+)/)[1]) * 1024;
const MB = b => Math.round(b / 1e5) / 10;

const t = performance.now();
const mod = await lib.load();
const result = { importMs: Math.round((performance.now() - t) * 10) / 10 };
if (lib.job) {
    globalThis.gc();
    const before = rss();
    fs.writeFileSync('/proc/self/clear_refs', '5');
    const out = await lib.job(mod);
    result.jobMB = MB(hwm() - before);
    // time to first image: the import and the first job, nothing compiled or warmed up yet (but the collection)
    result.firstImageMs = Math.round((performance.now() - t) * 10) / 10;
    if (!out?.length) throw new Error('no output');
}
console.log(JSON.stringify(result));
