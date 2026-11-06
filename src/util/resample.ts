/*!
 * The filter coefficients and the box, bilinear and bicubic filters are translated from Pillow's
 * src/libImaging/Resample.c (precompute_coeffs, box_filter, bilinear_filter, bicubic_filter). Copyright © 1997-2011 by
 * Secret Labs AB, © 1995-2011 by Fredrik Lundh and contributors, © 2010 by Jeffrey 'Alex' Clark and contributors,
 * MIT-CMU License (see THIRD_PARTY_NOTICES.md)
 */

// separable convolution resampling (the approach of Pillow's resample.c): the filter is stretched by the
// downscaling factor, so shrinking averages every source pixel instead of skipping most of them.
// The arithmetic is integer (weights are fixed point numbers), and the vertical pass runs first: its weights are the
// same for a whole row, so it's the cheaper pass to run on the larger image

import { littleEndian, isOpaque, premultiply8, unpremultiply8 } from './alpha.ts';

export interface Filter {
    /** radius of the filter at scale 1 */
    support: number;
    weight: (x: number) => number;
}

export const BOX: Filter = { support: 0.5, weight: x => x >= -0.5 && x < 0.5 ? 1 : 0 };

export const TRIANGLE: Filter = { support: 1, weight: x => Math.max(0, 1 - Math.abs(x)) };

// Keys' cubic convolution with a = -0.5 (Catmull-Rom)
export const CUBIC: Filter = {
    support: 2,
    weight: x => {
        const a = -0.5;
        x = Math.abs(x);
        if (x < 1) return ((a + 2) * x - (a + 3)) * x * x + 1;
        if (x < 2) return (((x - 5) * x + 8) * x - 4) * a;
        return 0;
    }
};

/** fractional bits of the weights */
const BITS = 14;
const ONE = 1 << BITS;

interface Coefficients {
    /** first source index per output index */
    start: Int32Array;
    /** weights with `bits` fractional bits, `taps` per output index (summing to 1) */
    weights: Int32Array;
    taps: number;
}

function coefficients(inSize: number, outSize: number, filter: Filter, bits: number, pad = false): Coefficients {
    const scale = inSize / outSize;
    const filterScale = Math.max(1, scale);
    const support = filter.support * filterScale;
    const one = 1 << bits;

    const mins = new Int32Array(outSize), maxs = new Int32Array(outSize);
    let taps = 0;
    for (let i = 0; i < outSize; i++) {
        const center = (i + 0.5) * scale;
        mins[i] = Math.max(0, Math.floor(center - support + 0.5));
        maxs[i] = Math.min(inSize, Math.floor(center + support + 0.5));
        taps = Math.max(taps, maxs[i] - mins[i]);
    }
    // padded to the unrolled counts (zero weights for the extra pixels)
    if (pad) taps = Math.min(inSize, taps <= 2 ? 2 : taps <= 4 ? 4 : taps);

    // every output index gets `taps` weights, so the passes can unroll by the count: a shorter range starts earlier
    // (zero weights for the pixels before it) where it would read past the end
    const start = new Int32Array(outSize);
    const weights = new Int32Array(outSize * taps);
    const w = new Float64Array(taps);
    for (let i = 0; i < outSize; i++) {
        const center = (i + 0.5) * scale, min = mins[i], n = maxs[i] - min;
        let total = 0;
        for (let k = 0; k < n; k++) total += w[k] = filter.weight((min + k - center + 0.5) / filterScale);

        const shift = Math.max(0, min + taps - inSize), o = i * taps + shift;
        start[i] = min - shift;
        // the rounded weights still sum to one: the largest takes the difference. Without any weight (the box filter
        // when enlarging, with the pixel right on its edge) the pixel in range is used
        let sum = 0, largest = 0;
        for (let k = 0; k < n; k++) {
            sum += weights[o + k] = Math.round(total ? w[k] / total * one : 0);
            if (Math.abs(w[k]) > Math.abs(w[largest])) largest = k;
        }
        if (n) weights[o + largest] += one - sum;
    }

    return { start, weights, taps };
}

/** the part of the resized image to produce (in its coordinates): the whole image, or what a crop of it keeps */
export interface Region {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * The coefficients of the output indices `from` to `from + count` of a full pass from `inSize` to `outSize`, their
 * starts relative to `offset` (the same weights as resampling the whole axis, so a region equals that part of the
 * whole result)
 */
function sliced(inSize: number, outSize: number, filter: Filter, bits: number, pad: boolean, from: number, count: number): Coefficients {
    const c = coefficients(inSize, outSize, filter, bits, pad);
    if (from === 0 && count === outSize) return c;
    return { start: c.start.slice(from, from + count), weights: c.weights.slice(from * c.taps, (from + count) * c.taps), taps: c.taps };
}

/**
 * The source columns a horizontal pass reads (`x0` to `x1`), its starts made relative to `x0`; without one (the width
 * stays) the region's own columns
 */
function window(horizontal: Coefficients | null, region: Region): { x0: number, x1: number } {
    if (!horizontal) return { x0: region.x, x1: region.x + region.width };
    const { start, taps } = horizontal, x0 = start[0], x1 = start[start.length - 1] + taps;
    for (let i = 0; i < start.length; i++) start[i] -= x0;
    return { x0, x1 };
}

/** most taps per pass of the fast resampling */
const FAST_TAPS = 4;

/**
 * Resamples RGBA pixels with the given filter, in premultiplied alpha so transparent pixels don't bleed their color
 */
export function resample(src: Uint8ClampedArray, width: number, height: number, outWidth: number, outHeight: number, filter: Filter, out: Uint8ClampedArray, fast = false, region: Region = { x: 0, y: 0, width: outWidth, height: outHeight }): void {
    // a part of the result only reads the source pixels it needs, so whether the image is opaque (which picks the
    // arithmetic) is decided on all of them first, like resampling the whole image would
    const partial = region.width !== outWidth || region.height !== outHeight;
    const opaque = partial ? isOpaque(src) : undefined;
    // opaque pixels don't need premultiplying, and with non-negative weights two channels share a multiplication
    if (littleEndian && filter.support <= 1) {
        if (fast && resampleFast(src, width, height, outWidth, outHeight, filter, out, region, opaque)) return;
        if (opaque !== false && resampleOpaque(src, width, height, outWidth, outHeight, filter, out, region)) return;
    } else if (opaque !== false && resampleOpaqueSigned(src, width, height, outWidth, outHeight, filter, out, region)) return;
    resamplePremultiplied(src, width, height, outWidth, outHeight, filter, out, region);
}

/**
 * Resamples opaque pixels (as 32-bit words, little endian), returns false (without writing anything) if they aren't
 * all opaque. Between the passes, each pixel is two words of two 16-bit lanes, the channels with 8 fractional bits:
 * red and blue in the first, green in the second
 */
function resampleOpaque(src: Uint8ClampedArray, width: number, height: number, outWidth: number, outHeight: number, filter: Filter, out: Uint8ClampedArray, region: Region): boolean {
    const pixels = new Int32Array(src.buffer, src.byteOffset, width * height);
    // transparent images usually show it in the first or last row, before a pass is spent on them
    let all = -1;
    for (let x = 0, last = (height - 1) * width; x < width; x++) all &= pixels[x] & pixels[last + x];
    if (all >>> 24 !== 255) return false;

    // the horizontal pass's coefficients first: they tell which source columns the vertical pass needs (cw of them,
    // from x0; the rows between the passes are cw wide)
    const horizontal = outWidth === width ? null : sliced(width, outWidth, filter, BITS, false, region.x, region.width);
    const { x0, x1 } = window(horizontal, region), cw = x1 - x0;
    const rh = region.height;

    const lanes = new Int32Array(cw * rh * 2);
    if (outHeight === height) {
        for (let y = 0, o = 0; y < rh; y++)
            for (let i = (region.y + y) * width + x0, end = i + cw; i < end; i++, o += 2) {
                const p = pixels[i];
                all &= p;
                lanes[o] = (p & 0xff00ff) << 8;
                lanes[o + 1] = (p & 0xff00) | 0;
            }
    } else {
        // with up to 4 rows (bilinear to half the size, area to a third), 8-bit weights stay within a step of the
        // exact result: then red and blue fit into one multiplication (each lane at most 255 * 256)
        let coefficientsV = sliced(height, outHeight, filter, 8, false, region.y, rh);
        const swar = coefficientsV.taps <= 4;
        if (!swar) coefficientsV = sliced(height, outHeight, filter, BITS, false, region.y, rh);
        const { start, weights, taps } = coefficientsV;
        for (let y = 0, o = 0; y < rh; y++) {
            const w = y * taps, r0 = start[y] * width + x0;
            if (swar && taps === 4) {
                const w0 = weights[w], w1 = weights[w + 1], w2 = weights[w + 2], w3 = weights[w + 3];
                const r1 = r0 + width, r2 = r1 + width, r3 = r2 + width;
                for (let x = 0; x < cw; x++, o += 2) {
                    const p0 = pixels[r0 + x], p1 = pixels[r1 + x], p2 = pixels[r2 + x], p3 = pixels[r3 + x];
                    all &= p0 & p1 & p2 & p3;
                    lanes[o] = Math.imul(p0 & 0xff00ff, w0) + Math.imul(p1 & 0xff00ff, w1) + Math.imul(p2 & 0xff00ff, w2) + Math.imul(p3 & 0xff00ff, w3);
                    lanes[o + 1] = (p0 >> 8 & 255) * w0 + (p1 >> 8 & 255) * w1 + (p2 >> 8 & 255) * w2 + (p3 >> 8 & 255) * w3;
                }
            } else if (swar && taps === 3) {
                const w0 = weights[w], w1 = weights[w + 1], w2 = weights[w + 2], r1 = r0 + width, r2 = r1 + width;
                for (let x = 0; x < cw; x++, o += 2) {
                    const p0 = pixels[r0 + x], p1 = pixels[r1 + x], p2 = pixels[r2 + x];
                    all &= p0 & p1 & p2;
                    lanes[o] = Math.imul(p0 & 0xff00ff, w0) + Math.imul(p1 & 0xff00ff, w1) + Math.imul(p2 & 0xff00ff, w2);
                    lanes[o + 1] = (p0 >> 8 & 255) * w0 + (p1 >> 8 & 255) * w1 + (p2 >> 8 & 255) * w2;
                }
            } else if (swar && taps === 2) {
                const w0 = weights[w], w1 = weights[w + 1], r1 = r0 + width;
                for (let x = 0; x < cw; x++, o += 2) {
                    const p0 = pixels[r0 + x], p1 = pixels[r1 + x];
                    all &= p0 & p1;
                    lanes[o] = Math.imul(p0 & 0xff00ff, w0) + Math.imul(p1 & 0xff00ff, w1);
                    lanes[o + 1] = (p0 >> 8 & 255) * w0 + (p1 >> 8 & 255) * w1;
                }
            } else if (swar) {
                for (let x = 0; x < cw; x++, o += 2) {
                    let rb = 0, g = 0;
                    for (let k = 0, s = r0 + x; k < taps; k++, s += width) {
                        const p = pixels[s], wk = weights[w + k];
                        all &= p;
                        rb += Math.imul(p & 0xff00ff, wk);
                        g += (p >> 8 & 255) * wk;
                    }
                    lanes[o] = rb;
                    lanes[o + 1] = g;
                }
            } else {
                for (let x = 0; x < cw; x++, o += 2) {
                    let r = 0, g = 0, b = 0, k = 0, s = r0 + x;
                    for (; k + 1 < taps; k += 2, s += width * 2) {
                        const p = pixels[s], q = pixels[s + width], w0 = weights[w + k], w1 = weights[w + k + 1];
                        all &= p & q;
                        r += (p & 255) * w0 + (q & 255) * w1;
                        g += (p >> 8 & 255) * w0 + (q >> 8 & 255) * w1;
                        b += (p >> 16 & 255) * w0 + (q >> 16 & 255) * w1;
                    }
                    if (k < taps) {
                        const p = pixels[s], w0 = weights[w + k];
                        all &= p;
                        r += (p & 255) * w0;
                        g += (p >> 8 & 255) * w0;
                        b += (p >> 16 & 255) * w0;
                    }
                    lanes[o] = (r + 32 >> 6) | (b + 32 >> 6) << 16;
                    lanes[o + 1] = g + 32 >> 6;
                }
            }
        }
    }
    if (all >>> 24 !== 255) return false;

    const result = new Int32Array(out.buffer, out.byteOffset, region.width * rh);
    if (!horizontal) {
        for (let i = 0, o = 0; i < result.length; i++, o += 2) {
            const rb = lanes[o], g = lanes[o + 1];
            result[i] = ((rb & 0xffff) + 128 >> 8) | (g + 128 >> 8) << 8 | ((rb >>> 16) + 128 >> 8) << 16 | 0xff000000;
        }
        return true;
    }

    // 8 fractional bits of the lanes and BITS of the weights
    const R = 1 << 7 + BITS, S = 8 + BITS;
    const { start, weights, taps } = horizontal, rw = region.width;
    for (let y = 0, o = 0; y < rh; y++) {
        const row = y * cw * 2;
        if (taps === 4) {
            for (let x = 0; x < rw; x++, o++) {
                const s = row + start[x] * 2, w = x * 4;
                const a0 = lanes[s], a1 = lanes[s + 2], a2 = lanes[s + 4], a3 = lanes[s + 6];
                const w0 = weights[w], w1 = weights[w + 1], w2 = weights[w + 2], w3 = weights[w + 3];
                const r = (a0 & 0xffff) * w0 + (a1 & 0xffff) * w1 + (a2 & 0xffff) * w2 + (a3 & 0xffff) * w3;
                const b = (a0 >>> 16) * w0 + (a1 >>> 16) * w1 + (a2 >>> 16) * w2 + (a3 >>> 16) * w3;
                const g = lanes[s + 1] * w0 + lanes[s + 3] * w1 + lanes[s + 5] * w2 + lanes[s + 7] * w3;
                result[o] = (r + R >> S) | (g + R >> S) << 8 | (b + R >> S) << 16 | 0xff000000;
            }
        } else if (taps === 2) {
            for (let x = 0; x < rw; x++, o++) {
                const s = row + start[x] * 2, w = x * 2;
                const a0 = lanes[s], a1 = lanes[s + 2], w0 = weights[w], w1 = weights[w + 1];
                const r = (a0 & 0xffff) * w0 + (a1 & 0xffff) * w1;
                const b = (a0 >>> 16) * w0 + (a1 >>> 16) * w1;
                const g = lanes[s + 1] * w0 + lanes[s + 3] * w1;
                result[o] = (r + R >> S) | (g + R >> S) << 8 | (b + R >> S) << 16 | 0xff000000;
            }
        } else {
            for (let x = 0; x < rw; x++, o++) {
                let r = 0, g = 0, b = 0, k = 0, s = row + start[x] * 2;
                const w = x * taps;
                for (; k + 1 < taps; k += 2, s += 4) {
                    const a0 = lanes[s], a1 = lanes[s + 2], w0 = weights[w + k], w1 = weights[w + k + 1];
                    r += (a0 & 0xffff) * w0 + (a1 & 0xffff) * w1;
                    b += (a0 >>> 16) * w0 + (a1 >>> 16) * w1;
                    g += lanes[s + 1] * w0 + lanes[s + 3] * w1;
                }
                if (k < taps) {
                    const a0 = lanes[s], w0 = weights[w + k];
                    r += (a0 & 0xffff) * w0;
                    b += (a0 >>> 16) * w0;
                    g += lanes[s + 1] * w0;
                }
                result[o] = (r + R >> S) | (g + R >> S) << 8 | (b + R >> S) << 16 | 0xff000000;
            }
        }
    }
    return true;
}

// sums the words of `taps` pixels `step` apart with 8-bit weights, red and blue, green and alpha as 16-bit lanes (the
// weights sum to 256, so a lane holds at most 255 * 256 plus the rounding), rounded back to a word
function packedSum(pixels: Int32Array, s: number, step: number, weights: Int32Array, w: number, taps: number): number {
    let rb = 0x800080, ga = 0x800080;
    for (let k = 0; k < taps; k++, s += step) {
        const p = pixels[s], wk = weights[w + k];
        rb += Math.imul(p & 0xff00ff, wk);
        ga += Math.imul(p >>> 8 & 0xff00ff, wk);
    }
    return (rb >>> 8 & 0xff00ff) | (ga & 0xff00ff00);
}

// the vertical pass of resampleFast: from `pixels` (`width` wide) into `rows` (a row per coefficient, of the cw columns
// from x0), returns the source pixels and-ed together (their alpha shows whether they're opaque)
function verticalFast(pixels: Int32Array, rows: Int32Array, width: number, x0: number, cw: number, { start, weights, taps }: Coefficients): number {
    let all = -1;
    for (let y = 0, o = 0; y < start.length; y++) {
        const w = y * taps, r0 = start[y] * width + x0;
        if (taps === 4) {
            const w0 = weights[w], w1 = weights[w + 1], w2 = weights[w + 2], w3 = weights[w + 3];
            const r1 = r0 + width, r2 = r1 + width, r3 = r2 + width;
            for (let x = 0; x < cw; x++, o++) {
                const p0 = pixels[r0 + x], p1 = pixels[r1 + x], p2 = pixels[r2 + x], p3 = pixels[r3 + x];
                all &= p0 & p1 & p2 & p3;
                const rb = Math.imul(p0 & 0xff00ff, w0) + Math.imul(p1 & 0xff00ff, w1) + Math.imul(p2 & 0xff00ff, w2) + Math.imul(p3 & 0xff00ff, w3) + 0x800080;
                const ga = Math.imul(p0 >>> 8 & 0xff00ff, w0) + Math.imul(p1 >>> 8 & 0xff00ff, w1) + Math.imul(p2 >>> 8 & 0xff00ff, w2) + Math.imul(p3 >>> 8 & 0xff00ff, w3) + 0x800080;
                rows[o] = (rb >>> 8 & 0xff00ff) | (ga & 0xff00ff00);
            }
        } else if (taps === 2) {
            const w0 = weights[w], w1 = weights[w + 1], r1 = r0 + width;
            for (let x = 0; x < cw; x++, o++) {
                const p0 = pixels[r0 + x], p1 = pixels[r1 + x];
                all &= p0 & p1;
                const rb = Math.imul(p0 & 0xff00ff, w0) + Math.imul(p1 & 0xff00ff, w1) + 0x800080;
                const ga = Math.imul(p0 >>> 8 & 0xff00ff, w0) + Math.imul(p1 >>> 8 & 0xff00ff, w1) + 0x800080;
                rows[o] = (rb >>> 8 & 0xff00ff) | (ga & 0xff00ff00);
            }
        } else {
            for (let x = 0; x < cw; x++, o++) {
                for (let k = 0, s = r0 + x; k < taps; k++, s += width) all &= pixels[s];
                rows[o] = packedSum(pixels, r0 + x, width, weights, w, taps);
            }
        }
    }
    return all;
}

// the horizontal pass of resampleFast: from `rows` (`width` wide) into `result`
function horizontalFast(rows: Int32Array, result: Int32Array, width: number, outWidth: number, outHeight: number, { start, weights, taps }: Coefficients): void {
    for (let y = 0, o = 0; y < outHeight; y++) {
        const row = y * width;
        if (taps === 4) {
            for (let x = 0; x < outWidth; x++, o++) {
                const s = row + start[x], w = x * 4;
                const p0 = rows[s], p1 = rows[s + 1], p2 = rows[s + 2], p3 = rows[s + 3];
                const w0 = weights[w], w1 = weights[w + 1], w2 = weights[w + 2], w3 = weights[w + 3];
                const rb = Math.imul(p0 & 0xff00ff, w0) + Math.imul(p1 & 0xff00ff, w1) + Math.imul(p2 & 0xff00ff, w2) + Math.imul(p3 & 0xff00ff, w3) + 0x800080;
                const ga = Math.imul(p0 >>> 8 & 0xff00ff, w0) + Math.imul(p1 >>> 8 & 0xff00ff, w1) + Math.imul(p2 >>> 8 & 0xff00ff, w2) + Math.imul(p3 >>> 8 & 0xff00ff, w3) + 0x800080;
                result[o] = (rb >>> 8 & 0xff00ff) | (ga & 0xff00ff00);
            }
        } else if (taps === 2) {
            for (let x = 0; x < outWidth; x++, o++) {
                const s = row + start[x], w = x * 2;
                const p0 = rows[s], p1 = rows[s + 1], w0 = weights[w], w1 = weights[w + 1];
                const rb = Math.imul(p0 & 0xff00ff, w0) + Math.imul(p1 & 0xff00ff, w1) + 0x800080;
                const ga = Math.imul(p0 >>> 8 & 0xff00ff, w0) + Math.imul(p1 >>> 8 & 0xff00ff, w1) + 0x800080;
                result[o] = (rb >>> 8 & 0xff00ff) | (ga & 0xff00ff00);
            }
        } else {
            for (let x = 0; x < outWidth; x++, o++) result[o] = packedSum(rows, row + start[x], 1, weights, x * taps, taps);
        }
    }
}

/**
 * Resamples with 8-bit weights in both passes and 8-bit pixels (as 32-bit words, little endian) between them, so two
 * channels share every multiplication. Transparent pixels are premultiplied to 8 bits (as browsers do), which keeps
 * less of the color of pixels that are almost transparent. Returns false (without writing anything) when a pass
 * needs more than {@link FAST_TAPS} pixels: the rounding of the weights adds up
 */
function resampleFast(src: Uint8ClampedArray, width: number, height: number, outWidth: number, outHeight: number, filter: Filter, out: Uint8ClampedArray, region: Region, known?: boolean): boolean {
    const { width: rw, height: rh } = region;
    const vertical = sliced(height, outHeight, filter, 8, true, region.y, rh);
    const horizontal = outWidth === width ? null : sliced(width, outWidth, filter, 8, true, region.x, rw);
    if (vertical.taps > FAST_TAPS || horizontal && horizontal.taps > FAST_TAPS) return false;
    const { x0, x1 } = window(horizontal, region), cw = x1 - x0;

    // transparent images usually show it in the first or last row, otherwise the vertical pass finds out (and runs
    // again on the premultiplied pixels)
    let pixels = new Int32Array(src.buffer, src.byteOffset, width * height), all = -1;
    for (let x = 0, last = (height - 1) * width; x < width; x++) all &= pixels[x] & pixels[last + x];
    let opaque = known ?? (all >>> 24 === 255 && (outHeight !== height || isOpaque(src)));
    const premultiplied = (): Int32Array => {
        const bitmap = new Uint8ClampedArray(src.length);
        premultiply8(src, bitmap);
        return new Int32Array(bitmap.buffer);
    };
    if (!opaque) pixels = premultiplied();

    // the rows between the passes: cw wide, from column x0 (the source itself when neither pass applies to it)
    let rows = pixels;
    if (outHeight !== height) {
        rows = new Int32Array(cw * rh);
        if (verticalFast(pixels, rows, width, x0, cw, vertical) >>> 24 !== 255 && opaque) {
            opaque = false;
            verticalFast(premultiplied(), rows, width, x0, cw, vertical);
        }
    } else if (cw !== width || rh !== height) {
        rows = new Int32Array(cw * rh);
        for (let y = 0; y < rh; y++) rows.set(pixels.subarray((region.y + y) * width + x0, (region.y + y) * width + x1), y * cw);
    }

    const result = new Int32Array(out.buffer, out.byteOffset, rw * rh);
    if (!horizontal) result.set(rows);
    else horizontalFast(rows, result, cw, rw, rh, horizontal);

    if (!opaque) unpremultiply8(out);
    return true;
}

/**
 * Resamples opaque pixels with a filter that has negative weights (bicubic), returns false (without writing anything
 * final) if a pixel it reads isn't opaque. The same arithmetic as {@link resamplePremultiplied} with every alpha 255
 * (so the same result), without the alpha channel: the color channels between the passes are channel * 255
 */
function resampleOpaqueSigned(src: Uint8ClampedArray, width: number, height: number, outWidth: number, outHeight: number, filter: Filter, out: Uint8ClampedArray, region: Region): boolean {
    const pixels = new Int32Array(src.buffer, src.byteOffset, width * height);
    let all = -1;
    for (let x = 0, last = (height - 1) * width; x < width; x++) all &= pixels[x] & pixels[last + x];
    if (all >>> 24 !== 255) return false;

    const horizontal = outWidth === width ? null : sliced(width, outWidth, filter, BITS, false, region.x, region.width);
    const { x0, x1 } = window(horizontal, region), cw = x1 - x0, rh = region.height;
    // three planes of cw * rh: channel * 255 (the premultiplied path's values at alpha 255)
    const R = new Int32Array(cw * rh), G = new Int32Array(cw * rh), B = new Int32Array(cw * rh);
    if (outHeight === height) {
        for (let y = 0, o = 0; y < rh; y++)
            for (let i = (region.y + y) * width + x0, end = i + cw; i < end; i++, o++) {
                const p = pixels[i];
                all &= p;
                R[o] = (p & 255) * 255;
                G[o] = (p >> 8 & 255) * 255;
                B[o] = (p >> 16 & 255) * 255;
            }
    } else {
        const { start, weights, taps } = sliced(height, outHeight, filter, BITS, false, region.y, rh);
        // the premultiplied path sums channel * (weight * 255): here the integer sum of channel * weight (well within
        // 32 bits) times 255, the same number. A row at a time, a source row (tap) at a time: sequential reads
        const H = ONE >> 1;
        for (let y = 0, o = 0; y < rh; y++, o += cw) {
            const w = y * taps;
            // two source rows per sweep (the first sweep sets, the others add), then the odd one
            for (let k = 0; k + 1 < taps; k += 2) {
                const wa = weights[w + k], wb = weights[w + k + 1], ra = (start[y] + k) * width + x0, rb = ra + width;
                if (k === 0) {
                    for (let x = 0; x < cw; x++) {
                        const p = pixels[ra + x], q = pixels[rb + x];
                        all &= p & q;
                        R[o + x] = (p & 255) * wa + (q & 255) * wb;
                        G[o + x] = (p >> 8 & 255) * wa + (q >> 8 & 255) * wb;
                        B[o + x] = (p >> 16 & 255) * wa + (q >> 16 & 255) * wb;
                    }
                } else {
                    for (let x = 0; x < cw; x++) {
                        const p = pixels[ra + x], q = pixels[rb + x];
                        all &= p & q;
                        R[o + x] += (p & 255) * wa + (q & 255) * wb;
                        G[o + x] += (p >> 8 & 255) * wa + (q >> 8 & 255) * wb;
                        B[o + x] += (p >> 16 & 255) * wa + (q >> 16 & 255) * wb;
                    }
                }
            }
            if (taps & 1) {
                const k = taps - 1, wk = weights[w + k], r = (start[y] + k) * width + x0;
                for (let x = 0; x < cw; x++) {
                    const p = pixels[r + x];
                    all &= p;
                    if (k === 0) {
                        R[o + x] = (p & 255) * wk;
                        G[o + x] = (p >> 8 & 255) * wk;
                        B[o + x] = (p >> 16 & 255) * wk;
                    } else {
                        R[o + x] += (p & 255) * wk;
                        G[o + x] += (p >> 8 & 255) * wk;
                        B[o + x] += (p >> 16 & 255) * wk;
                    }
                }
            }
            for (let x = o, end = o + cw; x < end; x++) {
                R[x] = R[x] * 255 + H >> BITS;
                G[x] = G[x] * 255 + H >> BITS;
                B[x] = B[x] * 255 + H >> BITS;
            }
        }
    }
    if (all >>> 24 !== 255) return false;

    // the premultiplied path's unpremultiplying at alpha 255 (its alpha sums to 65025 * ONE)
    const f = 255 / (65025 * ONE), rw = region.width;
    const { start, weights, taps } = horizontal ?? { start: null, weights: null, taps: 0 };
    for (let y = 0, o = 0; y < rh; y++) {
        const row = y * cw;
        if (!start || !weights) {
            for (let x = 0; x < rw; x++, o += 4) {
                const s = row + x;
                out[o] = R[s] * ONE * f;
                out[o + 1] = G[s] * ONE * f;
                out[o + 2] = B[s] * ONE * f;
                out[o + 3] = 255;
            }
            continue;
        }
        for (let x = 0; x < rw; x++, o += 4) {
            let r = 0, g = 0, b = 0, k = 0, s = row + start[x];
            const w = x * taps;
            for (; k + 1 < taps; k += 2, s += 2) {
                const w0 = weights[w + k], w1 = weights[w + k + 1];
                r += R[s] * w0 + R[s + 1] * w1;
                g += G[s] * w0 + G[s + 1] * w1;
                b += B[s] * w0 + B[s + 1] * w1;
            }
            if (k < taps) {
                const w0 = weights[w + k];
                r += R[s] * w0;
                g += G[s] * w0;
                b += B[s] * w0;
            }
            out[o] = r * f;
            out[o + 1] = g * f;
            out[o + 2] = b * f;
            out[o + 3] = 255;
        }
    }
    return true;
}

/**
 * Resamples any pixels, premultiplied: between the passes, the color channels are channel * alpha and the alpha
 * channel is alpha * 255 (0-65025 each, beyond with overshooting filters)
 */
function resamplePremultiplied(src: Uint8ClampedArray, width: number, height: number, outWidth: number, outHeight: number, filter: Filter, out: Uint8ClampedArray, region: Region): void {
    const horizontal = outWidth === width ? null : sliced(width, outWidth, filter, BITS, false, region.x, region.width);
    const { x0, x1 } = window(horizontal, region), cw = x1 - x0, rh = region.height;
    const plane = new Int32Array(cw * rh * 4);
    if (outHeight === height) {
        for (let y = 0, o = 0; y < rh; y++)
            for (let s = ((region.y + y) * width + x0) * 4, end = s + cw * 4; s < end; s += 4, o += 4) {
                const a = src[s + 3];
                plane[o] = src[s] * a;
                plane[o + 1] = src[s + 1] * a;
                plane[o + 2] = src[s + 2] * a;
                plane[o + 3] = a * 255;
            }
    } else {
        const { start, weights, taps } = sliced(height, outHeight, filter, BITS, false, region.y, rh);
        const stride = width * 4, H = ONE >> 1;
        for (let y = 0, o = 0; y < rh; y++) {
            const w = y * taps, r0 = start[y] * stride + x0 * 4;
            for (let x = 0; x < cw * 4; x += 4, o += 4) {
                let r = 0, g = 0, b = 0, a = 0, k = 0, s = r0 + x;
                for (; k + 1 < taps; k += 2, s += stride * 2) {
                    const t = s + stride, wa = weights[w + k] * src[s + 3], wb = weights[w + k + 1] * src[t + 3];
                    r += src[s] * wa + src[t] * wb;
                    g += src[s + 1] * wa + src[t + 1] * wb;
                    b += src[s + 2] * wa + src[t + 2] * wb;
                    a += wa + wb;
                }
                if (k < taps) {
                    const wa = weights[w + k] * src[s + 3];
                    r += src[s] * wa;
                    g += src[s + 1] * wa;
                    b += src[s + 2] * wa;
                    a += wa;
                }
                plane[o] = r + H >> BITS;
                plane[o + 1] = g + H >> BITS;
                plane[o + 2] = b + H >> BITS;
                plane[o + 3] = a * 255 + H >> BITS;
            }
        }
    }

    const { start, weights, taps } = horizontal ?? { start: null, weights: null, taps: 0 };
    for (let y = 0, o = 0; y < rh; y++) {
        const row = y * cw * 4;
        for (let x = 0; x < region.width; x++, o += 4) {
            let r = 0, g = 0, b = 0, a = 0;
            if (!start || !weights) {
                const s = row + x * 4;
                r = plane[s] * ONE;
                g = plane[s + 1] * ONE;
                b = plane[s + 2] * ONE;
                a = plane[s + 3] * ONE;
            } else {
                let k = 0, s = row + start[x] * 4;
                const w = x * taps;
                for (; k + 1 < taps; k += 2, s += 8) {
                    const w0 = weights[w + k], w1 = weights[w + k + 1];
                    r += plane[s] * w0 + plane[s + 4] * w1;
                    g += plane[s + 1] * w0 + plane[s + 5] * w1;
                    b += plane[s + 2] * w0 + plane[s + 6] * w1;
                    a += plane[s + 3] * w0 + plane[s + 7] * w1;
                }
                if (k < taps) {
                    const w0 = weights[w + k];
                    r += plane[s] * w0;
                    g += plane[s + 1] * w0;
                    b += plane[s + 2] * w0;
                    a += plane[s + 3] * w0;
                }
            }

            // a is alpha * 255 with BITS fractional bits: unpremultiply, the clamped output rounds and clamps
            if (a < 127.5 * ONE) {
                out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
                continue;
            }
            const f = 255 / Math.min(a, 65025 * ONE);
            out[o] = r * f;
            out[o + 1] = g * f;
            out[o + 2] = b * f;
            out[o + 3] = a / (255 * ONE);
        }
    }
}
