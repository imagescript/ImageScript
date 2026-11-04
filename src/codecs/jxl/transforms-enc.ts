/*!
 * The forward transforms of JPEG XL's varblocks for the encoder: DCTs (the decoder's DCTs forward), the special 8x8
 * transforms (DCT2X2, DCT4X4, IDENTITY, DCT4X8, DCT8X4 and AFV like libjxl's TransformFromPixels,
 * lib/jxl/enc_transforms-inl.h: Copyright (c) the JPEG XL Project Authors, BSD-3-Clause License, see
 * THIRD_PARTY_NOTICES.md), and the LF of the varblocks from their lowest frequencies
 */
import { AFV_BASIS, dct2d, scaleF } from './dct.ts';
import { SIZES, single } from './vardct.ts';
import { fdct8, fdct16, fdct32, fdct64 } from './fdct.ts';

const SEC0 = 0.5411961, SEC1 = 1.306563;
const tmp = new Float32Array(64), block4 = new Float32Array(16);

// the 2x2 sums and differences of the top s x s of a block (libjxl's DCT2TopBlock)
function dct2Top(src: Float32Array, so: number, stride: number, out: Float32Array, size: number): void {
    const n = size / 2;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const o = so + y * 2 * stride + x * 2;
            const c00 = src[o], c01 = src[o + 1], c10 = src[o + stride], c11 = src[o + stride + 1];
            tmp[y * 8 + x] = (c00 + c01 + c10 + c11) * 0.25;
            tmp[y * 8 + n + x] = (c00 + c01 - c10 - c11) * 0.25;
            tmp[(y + n) * 8 + x] = (c00 - c01 + c10 - c11) * 0.25;
            tmp[(y + n) * 8 + n + x] = (c00 - c01 - c10 + c11) * 0.25;
        }
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[y * 8 + x] = tmp[y * 8 + x];
}

// the 2x2 DCT of the top left coefficients
function dct2x2Corner(c: Float32Array): void {
    const b00 = c[0], b01 = c[1], b10 = c[8], b11 = c[9];
    c[0] = (b00 + b01 + b10 + b11) * 0.25;
    c[1] = (b00 + b01 - b10 - b11) * 0.25;
    c[8] = (b00 - b01 + b10 - b11) * 0.25;
    c[9] = (b00 - b01 - b10 + b11) * 0.25;
}

// DCT2X2, DCT4X4 and IDENTITY (libjxl's TransformFromPixels)
function special8x8(type: number, src: Float32Array, so: number, stride: number, c: Float32Array): void {
    if (type === 2) {
        dct2Top(src, so, stride, c, 8);
        dct2Top(c, 0, 8, c, 4);
        dct2Top(c, 0, 8, c, 2);
        return;
    }
    if (type === 3) {
        for (let y = 0; y < 2; y++) {
            for (let x = 0; x < 2; x++) {
                for (let iy = 0; iy < 4; iy++) for (let ix = 0; ix < 4; ix++) block4[iy * 4 + ix] = src[so + (y * 4 + iy) * stride + x * 4 + ix];
                dct4x4(block4);
                // (transposed, like libjxl's scaled DCT of square blocks)
                for (let iy = 0; iy < 4; iy++) for (let ix = 0; ix < 4; ix++) c[(y + iy * 2) * 8 + x + ix * 2] = block4[ix * 4 + iy];
            }
        }
        dct2x2Corner(c);
        return;
    }
    // (IDENTITY)
    for (let y = 0; y < 2; y++) {
        for (let x = 0; x < 2; x++) {
            let dc = 0;
            for (let iy = 0; iy < 4; iy++) for (let ix = 0; ix < 4; ix++) dc += src[so + (y * 4 + iy) * stride + x * 4 + ix];
            const center = src[so + (y * 4 + 1) * stride + x * 4 + 1];
            for (let iy = 0; iy < 4; iy++) {
                for (let ix = 0; ix < 4; ix++) {
                    if (ix === 1 && iy === 1) continue;
                    c[(y + iy * 2) * 8 + x + ix * 2] = src[so + (y * 4 + iy) * stride + x * 4 + ix] - center;
                }
            }
            c[(y + 2) * 8 + x + 2] = c[y * 8 + x];
            c[y * 8 + x] = dc / 16;
        }
    }
    dct2x2Corner(c);
}

// the DCT of a w x h block in place (rows, then columns), unrolled up to 64 points (direct calls, which inline)
function dct2(buf: Float32Array, w: number, h: number): void {
    if (w === 8 && h === 8) {
        for (let y = 0; y < 64; y += 8) fdct8(buf, y, 1);
        for (let x = 0; x < 8; x++) fdct8(buf, x, 8);
        return;
    }
    if (w > 64 || h > 64) {
        dct2d({ buf, offset: 0, stride: w, w, h }, false);
        return;
    }
    for (let y = 0; y < h; y++) fdct(buf, y * w, 1, w);
    for (let x = 0; x < w; x++) fdct(buf, x, w, h);
}

function fdct(buf: Float32Array, o: number, step: number, n: number): void {
    if (n === 8) fdct8(buf, o, step);
    else if (n === 16) fdct16(buf, o, step);
    else if (n === 32) fdct32(buf, o, step);
    else fdct64(buf, o, step);
}

const half = new Float32Array(32), quarter = new Float32Array(16), corner = new Float64Array(16);

// the forward 4-point DCT of buf[o + k * step] in place (dct.ts's)
function fdct4(buf: Float32Array, o: number, step: number): void {
    const i0 = buf[o], i1 = buf[o + step], i2 = buf[o + 2 * step], i3 = buf[o + 3 * step];
    const sum03 = i0 + i3, sum12 = i1 + i2, t0 = (i0 - i3) * SEC0, t1 = (i1 - i2) * SEC1;
    const out0 = (t0 + t1) / 4, out1 = (t0 - t1) / 4;
    buf[o] = (sum03 + sum12) / 4;
    buf[o + step] = out0 * Math.SQRT2 + out1;
    buf[o + 2 * step] = (sum03 - sum12) / 4;
    buf[o + 3 * step] = out1;
}

// the 2D DCTs of 8x4 and 4x4 blocks (rows, then columns: like dct2d)
function dct8x4(buf: Float32Array): void {
    for (let y = 0; y < 32; y += 8) fdct8(buf, y, 1);
    for (let x = 0; x < 8; x++) fdct4(buf, x, 8);
}

function dct4x4(buf: Float32Array): void {
    for (let y = 0; y < 16; y += 4) fdct4(buf, y, 1);
    for (let x = 0; x < 4; x++) fdct4(buf, x, 4);
}

// DCT4X8 (two 8x4 DCTs of the top and bottom half, interleaved by rows) and DCT8X4 (of the left and right half)
function dct4x8(src: Float32Array, so: number, stride: number, c: Float32Array, transposed: boolean): void {
    for (let i = 0; i < 2; i++) {
        for (let iy = 0; iy < 4; iy++) {
            for (let ix = 0; ix < 8; ix++) half[iy * 8 + ix] = transposed ? src[so + ix * stride + i * 4 + iy] : src[so + (i * 4 + iy) * stride + ix];
        }
        dct8x4(half);
        for (let iy = 0; iy < 4; iy++) for (let ix = 0; ix < 8; ix++) c[(iy * 2 + i) * 8 + ix] = half[iy * 8 + ix];
    }
    // (the sum and difference of their DCs)
    const d0 = c[0], d1 = c[8];
    c[0] = (d0 + d1) * 0.5;
    c[8] = (d0 - d1) * 0.5;
}

// AFV (libjxl's AFVTransformFromPixels): the 4x4 corner of the type (n: flipped in x by its bit 0, y by bit 1) by
// the AFV basis, the 4x4 beside it and the 8x4 half below or above by DCTs, their DCs combined
function afv(n: number, src: Float32Array, so: number, stride: number, c: Float32Array): void {
    const flipX = n & 1, flipY = n >> 1;
    for (let iy = 0; iy < 4; iy++) {
        const ay = flipY ? 3 - iy : iy;
        for (let ix = 0; ix < 4; ix++) corner[ay * 4 + (flipX ? 3 - ix : ix)] = src[so + (flipY * 4 + iy) * stride + flipX * 4 + ix];
    }
    for (let i = 1; i < 16; i++) {
        let v = 0;
        for (let k = 0; k < 16; k++) v += AFV_BASIS[i * 16 + k] * corner[k];
        c[2 * (i >> 2) * 8 + 2 * (i % 4)] = v;
    }
    let dc = 0;
    for (let k = 0; k < 16; k++) dc += AFV_BASIS[k] * corner[k];
    for (let iy = 0; iy < 4; iy++) for (let ix = 0; ix < 4; ix++) quarter[iy * 4 + ix] = src[so + (flipY * 4 + iy) * stride + (1 - flipX) * 4 + ix];
    dct4x4(quarter);
    for (let iy = 0; iy < 4; iy++) for (let ix = 0; ix < 4; ix++) c[2 * iy * 8 + 2 * ix + 1] = quarter[ix * 4 + iy];
    for (let iy = 0; iy < 4; iy++) for (let ix = 0; ix < 8; ix++) half[iy * 8 + ix] = src[so + ((1 - flipY) * 4 + iy) * stride + ix];
    dct8x4(half);
    for (let iy = 0; iy < 4; iy++) for (let ix = 0; ix < 8; ix++) c[(2 * iy + 1) * 8 + ix] = half[iy * 8 + ix];
    // (the DCs: the corner's is 4 (c00 + c10 + c01), the 4x4's c00 - c10 + c01, the 8x4's c00 - c01)
    const a = dc / 4, s = (a + quarter[0]) / 2;
    c[1] = (a - quarter[0]) / 2;
    c[0] = (s + half[0]) / 2;
    c[8] = (s - half[0]) / 2;
}

/**
 * The forward transform of a varblock of a type: the pixels at src[so] (rows stride apart) become its coefficients
 * (in the decoder's layout, rows of the varblock's width) and the LF of its 8x8 blocks (rows of its width in blocks)
 */
export function forwardTransform(type: number, src: Float32Array, so: number, stride: number, coeffs: Float32Array, lf: Float32Array): void {
    const w8 = SIZES[2 * type], h8 = SIZES[2 * type + 1], w = w8 * 8, h = h8 * 8;
    if (single(type) && type !== 0) {
        if (type === 12 || type === 13) dct4x8(src, so, stride, coeffs, type === 13);
        else if (type >= 14) afv(type - 14, src, so, stride, coeffs);
        else special8x8(type, src, so, stride, coeffs);
        lf[0] = coeffs[0];
        return;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) coeffs[y * w + x] = src[so + y * stride + x];
    dct2(coeffs, w, h);
    if (type === 0) {
        lf[0] = coeffs[0];
        return;
    }
    // (the LF: the inverse DCT of the lowest frequencies, scaled; on a copy, the coefficients stay)
    const lw = 31 - Math.clz32(w8), lh = 31 - Math.clz32(h8);
    for (let y = 0; y < h8; y++) for (let x = 0; x < w8; x++) lf[y * w8 + x] = coeffs[y * w + x] * scaleF(y, 5 - lh) * scaleF(x, 5 - lw);
    dct2d({ buf: lf, offset: 0, stride: w8, w: w8, h: h8 }, true);
}
