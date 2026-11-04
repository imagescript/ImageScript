/*!
 * JPEG XL (ISO/IEC 18181): bare codestreams and the container (ISO/IEC 18181-2: jxlc, jxlp boxes), the image header,
 * the frames up to the first one shown (with its orientation); see ./jxl/ for the decoder, ported from jxl-oxide and
 * libjxl (see THIRD_PARTY_NOTICES.md); the encoders' codestreams, with Exif in the container (signature, ftyp, Exif, jxlc
 * boxes)
 */
import { startThreads } from '../util/threads.ts';
import { MAX_PIXELS, checkPixels } from '../util/limits.ts';
import { BitReader } from './jxl/bits.ts';
import {
    CS_GREY, CS_RGB, decodeICC, imageHeader, PRI_BT2100, PRI_CUSTOM, PRI_P3, readICC, TF_DCI, TF_HLG, TF_LINEAR, TF_PQ,
    WP_CUSTOM, WP_DCI, WP_E, type ColourEncoding, type ImageHeader
} from './jxl/headers.ts';
import { frameHeader, toc } from './jxl/frame-header.ts';
import { decodeFrame, DecoderState, type FrameThreads } from './jxl/frame.ts';
import { ColorOutput } from './jxl/color.ts';
import { ToneMapping } from './hdr.ts';
import { encodeRGBA } from './jxl/fast-lossless.ts';
import { encodeVarDCT } from './jxl/vardct-enc.ts';
import { concat } from '../util/mem.ts';
import { srgbDecode, type Curve } from '../util/icc.ts';

const CONTAINER = [0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a];

/** Whether the data starts like a JPEG XL: a codestream (ff 0a) or the container's signature box */
export function isJXL(d: Uint8Array): boolean {
    if (d.length >= 2 && d[0] === 0xff && d[1] === 0x0a) return true;
    return d.length >= 12 && CONTAINER.every((v, i) => d[i] === v);
}

/**
 * Encodes RGBA pixels as a JPEG XL, lossless or lossy (with a Butteraugli distance above 0, and an effort 0-2): the
 * codestream, in the container if there is Exif data (a TIFF header and IFDs); lossy with up to threads worker threads
 */
export async function encode(rgba: Uint8Array, width: number, height: number, exif?: Uint8Array, distance = 0, effort = 1, threads = 1): Promise<Uint8Array> {
    const stream = distance > 0 ? await encodeVarDCT(rgba, width, height, { distance, effort, threads }) : encodeRGBA(rgba, width, height);
    if (!exif?.length) return stream;
    // (ftyp: brand jxl, minor version 0, compatible jxl; Exif: the offset of the TIFF header, 0, then the TIFF data)
    const jxl = [0x6a, 0x78, 0x6c, 0x20];
    return concat([CONTAINER, ...box('ftyp', jxl, [0, 0, 0, 0], jxl), ...box('Exif', [0, 0, 0, 0], exif), ...box('jxlc', stream)]);
}

// a box: its header and content
const box = (type: string, ...content: ArrayLike<number>[]): ArrayLike<number>[] => {
    const size = 8 + content.reduce((n, c) => n + c.length, 0);
    return [[size >>> 24, size >> 16 & 255, size >> 8 & 255, size & 255, ...Array.from(type, c => c.charCodeAt(0))], ...content];
};

const fourcc = (d: Uint8Array, o: number): string => String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3]);

/** The codestream of a file: itself, or the container's jxlc box or jxlp boxes joined */
function codestream(d: Uint8Array): Uint8Array {
    if (d[0] === 0xff) return d;
    const view = new DataView(d.buffer, d.byteOffset, d.byteLength), parts: Uint8Array[] = [];
    for (let o = 0; o + 8 <= d.length;) {
        let size = view.getUint32(o), header = 8;
        const type = fourcc(d, o + 4);
        if (size === 1) {
            if (o + 16 > d.length) throw new Error('JPEG XL: truncated box');
            size = view.getUint32(o + 8) * 2 ** 32 + view.getUint32(o + 12);
            header = 16;
        } else if (size === 0) size = d.length - o;
        if (size < header || o + size > d.length) throw new Error(`JPEG XL: invalid ${type} box`);
        if (type === 'jxlc') return d.subarray(o + header, o + size);
        // (jxlp: a 4-byte index, then a part)
        if (type === 'jxlp') parts.push(d.subarray(o + header + 4, o + size));
        o += size;
    }
    if (!parts.length) throw new Error('JPEG XL: no codestream');
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}

/** A color space given by its primaries and white (xy: red, green, blue, white; null for gray) and tone curve */
export interface ColorSpace {
    xy: number[][] | null;
    curve: Curve;
}

// the xy chromaticities of the enumerated white points and primaries (red, green, blue)
const WHITE_D65 = [0.3127, 0.3290];
const PRIMARIES: Record<number, number[][]> = {
    [PRI_BT2100]: [[0.708, 0.292], [0.170, 0.797], [0.131, 0.046]],
    [PRI_P3]: [[0.680, 0.320], [0.265, 0.690], [0.150, 0.060]],
};

/**
 * The color space the decoded pixels are in when the codestream gives it by its enumerated encoding and it isn't
 * sRGB: undefined for XYB images (which decode to sRGB), ones with an ICC profile, HDR ones (PQ, HLG: these become sRGB
 * in ColorOutput) and unknown color spaces. Like CICP's (see cicpTransform), BT.709's transfer is taken as sRGB's
 */
export function colorSpace(image: ImageHeader): ColorSpace | undefined {
    const c: ColourEncoding = image.colour;
    if (image.xybEncoded || c.wantICC || (c.colourSpace !== CS_RGB && c.colourSpace !== CS_GREY)) return;
    if (c.transfer === TF_PQ || c.transfer === TF_HLG) return;
    const curve: Curve | null = c.transfer === -1 ? (c.gamma > 0 ? v => v ** (1 / c.gamma) : null)
        : c.transfer === TF_LINEAR ? v => v : c.transfer === TF_DCI ? v => v ** 2.6 : null;
    const white = c.whitePoint === WP_CUSTOM ? c.white : c.whitePoint === WP_E ? [1 / 3, 1 / 3] : c.whitePoint === WP_DCI ? [0.314, 0.351] : null;
    const primaries = c.colourSpace === CS_GREY ? null : c.primaries === PRI_CUSTOM
        ? [0, 2, 4].map(i => c.primariesXY.slice(i, i + 2)) : PRIMARIES[c.primaries] ?? null;
    // (sRGB: nothing to convert; gray only by its curve)
    if (c.colourSpace === CS_GREY) return curve ? { xy: null, curve } : undefined;
    if (!curve && !white && !primaries) return;
    return { xy: [...primaries ?? [[0.64, 0.33], [0.30, 0.60], [0.15, 0.06]], white ?? WHITE_D65], curve: curve ?? srgbDecode };
}

/** The frames shown (composited, as RGBA), their durations in milliseconds */
export async function* frames(data: Uint8Array, maxPixels = MAX_PIXELS, toneMapping: ToneMapping = 'reinhard', threads = 1): AsyncGenerator<{ width: number, height: number, pixels: Uint8Array, duration: number, orientation: number, loopCount: number, icc?: Uint8Array, colorSpace?: ColorSpace }> {
    const d = codestream(data);
    const r = new BitReader(d);
    const image = imageHeader(r);
    checkPixels(image.width, image.height, maxPixels);
    // the embedded ICC profile: what the pixels are in unless they're XYB (which decodes to sRGB here; its profile only
    // says what the image was before)
    const stream = image.colour.wantICC ? readICC(r) : null;
    const icc = stream && !image.xybEncoded ? decodeICC(stream) ?? undefined : undefined;
    // (without one: the enumerated color space, if it isn't sRGB)
    const space = icc ? undefined : colorSpace(image);
    r.zeroPadToByte();
    let at = r.bytePosition;
    if (image.preview) {
        // (the preview frame, which is skipped, has the preview's size)
        const pr = new BitReader(d, at);
        at = toc(pr, frameHeader(pr, { ...image, ...image.preview })).end;
    }
    const state: DecoderState = {
        image, output: new ColorOutput(image, toneMapping), references: [null, null, null, null], referenceIsXYB: [false, false, false, false],
        lfFrames: [null, null, null, null], visible: 0, invisible: 0
    };
    const a = image.animation, tick = a ? 1000 * a.tpsDenominator / a.tpsNumerator : 0;
    // (threads for the frames' groups and filters, see decodeFrame: at most one per 2 megapixels for XYB images (lossy),
    // from 1.5 megapixels and 512 KiB on one per 512K pixels for others (lossless: they take about as long as they're
    // large, smaller ones like few colors' decode faster than threads start), more take longer to start and warm up
    // than they save; measured with 1-8 threads on 0.25-8 megapixels of photos, screenshots and few colors)
    const pixels = image.width * image.height;
    const n = Math.min(threads, image.xybEncoded ? Math.floor(pixels / (2 << 20)) : pixels >= 1536 << 10 && d.length >= 512 << 10 ? Math.floor(pixels / (512 << 10)) : 1);
    const pool: FrameThreads = { threads: n > 1 ? startThreads(n) : null, data: null };
    try {
        let shown = 0;
        for (; ;) {
            if (at >= d.length) {
                if (shown) return;
                throw new Error('JPEG XL: no frame shown');
            }
            const frame = await decodeFrame(d, new BitReader(d, at), state, at, pool);
            at = frame.end;
            if (frame.canvas && (frame.header.isLast || frame.header.duration !== 0)) {
                shown++;
                yield {
                    width: image.width, height: image.height, pixels: state.output.toRGBA(frame.canvas), duration: frame.header.duration * tick,
                    orientation: image.orientation, loopCount: a ? a.numLoops : 1, icc, colorSpace: space
                };
            }
            if (frame.header.isLast) return;
        }
    } finally {
        if (pool.threads) for (const t of pool.threads) t.terminate();
    }
}

/** Decodes the first frame shown */
export async function decode(data: Uint8Array, maxPixels = MAX_PIXELS, toneMapping: ToneMapping = 'reinhard', threads = 1): Promise<{ width: number, height: number, pixels: Uint8Array, orientation: number, icc?: Uint8Array, colorSpace?: ColorSpace }> {
    for await (const frame of frames(data, maxPixels, toneMapping, threads)) return frame;
    throw new Error('JPEG XL: no frame shown');
}
