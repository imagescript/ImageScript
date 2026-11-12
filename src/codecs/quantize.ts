import type { DitherMethod } from '../image.ts';
import { oneOf } from '../util/options.ts';

// perceptual channel weights for squared color distances
const WR = 3, WG = 4, WB = 2;

/** Options of quantize(): the palette size and the dithering */
export interface QuantizeOptions {
    /** the most palette entries, the transparent one included */
    maxColors?: number;
    /** how the rounding error is spread (Floyd-Steinberg by default) */
    dither?: DitherMethod;
    /** how strongly (0-1) */
    ditherStrength?: number;
    /** whether to have a transparent index even if no pixel is transparent */
    transparent?: boolean;
}

// every DitherMethod (a missing key is a type error)
const DITHER: Record<DitherMethod, true> = { 'none': true, 'floyd-steinberg': true, 'atkinson': true, 'ordered': true };
export const DITHER_METHODS = Object.keys(DITHER) as DitherMethod[];

/**
 * Checks palette options (`colors` from 2 to 256, a dither method, a strength 0-1) before anything changes, with the
 * messages of Image.quantize()
 */
export function paletteOptions(colors: number | undefined, dither: unknown, ditherStrength: number): { colors: number | undefined, dither: DitherMethod, strength: number } {
    let count: number | undefined;
    if (colors !== undefined) {
        count = Number(colors);
        // eslint-disable-next-line no-restricted-syntax -- the palette size is only checked here
        if (!Number.isInteger(count) || count < 2 || count > 256) throw new RangeError(`colors must be an integer from 2 to 256, not ${colors}`);
    }
    oneOf(dither, DITHER_METHODS, 'dither');
    const strength = Number(ditherStrength);
    if (!Number.isFinite(strength)) throw new RangeError(`Invalid ditherStrength: ${ditherStrength}`);
    // eslint-disable-next-line no-restricted-syntax -- the dither strength is only checked here
    if (strength < 0 || strength > 1) throw new RangeError(`ditherStrength must be 0-1, not ${ditherStrength}`);
    return { colors: count, dither: dither as DitherMethod, strength };
}

export interface Quantized {
    /** packed RGB */
    palette: Uint8Array;
    indices: Uint8Array;
    /** -1 if no pixel is transparent */
    transparentIndex: number;
}

interface Clusters {
    /** mean color per cluster, packed RGB */
    palette: Float64Array;
    /** pixel count per cluster */
    weights: Float64Array;
}

/**
 * Finds the dominant color among the pixels that are at least half opaque and pass the filter: the colors are counted
 * in a histogram of 16 levels per channel (4096 bins, like sharp's), and the average of the pixels in the fullest bin
 * is the result, so it is a color the image has (a cluster's average can lie between two hues)
 * @return RGB, or null if no pixel qualifies
 */
export function dominantColor(pixels: Uint8Array, include: (r: number, g: number, b: number) => boolean): [number, number, number] | null {
    const counts = new Uint32Array(4096), sums = new Float64Array(4096 * 3);
    let found = false;
    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < 128) continue;
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        if (!include(r, g, b)) continue;
        const bin = (r >> 4) << 8 | (g >> 4) << 4 | b >> 4;
        counts[bin]++;
        sums[bin * 3] += r;
        sums[bin * 3 + 1] += g;
        sums[bin * 3 + 2] += b;
        found = true;
    }
    if (!found) return null;

    let best = 0;
    for (let bin = 1; bin < 4096; bin++) if (counts[bin] > counts[best]) best = bin;
    return [Math.round(sums[best * 3] / counts[best]), Math.round(sums[best * 3 + 1] / counts[best]), Math.round(sums[best * 3 + 2] / counts[best])];
}

interface Points {
    /** mean color per channel */
    c: [Float64Array, Float64Array, Float64Array];
    /** pixel count */
    w: Float64Array;
}

interface Box {
    /** indices into the points */
    members: Int32Array;
    weight: number;
    mean: number[];
    axis: number;
    error: number;
}

/**
 * Reduces RGBA pixel data to an indexed palette (packed RGB). Pixels with alpha < 128 are mapped to a dedicated
 * transparent index (-1 if unused)
 */
export function quantize(pixels: Uint8Array, width: number, { maxColors = 256, dither = 'floyd-steinberg', ditherStrength = 0.85, transparent = false }: QuantizeOptions = {}): Quantized {
    const length = pixels.length >> 2;
    let hasTransparency = transparent;
    for (let i = 3; i < pixels.length; i += 4)
        if (pixels[i] < 128) {
            hasTransparency = true;
            break;
        }

    const colors = hasTransparency ? maxColors - 1 : maxColors;
    const exact = exactPalette(pixels, colors);

    let palette: Uint8Array, indices: Uint8Array;
    if (exact) ({ palette, indices } = exact);
    else {
        palette = Uint8Array.from(medianCut(pixels, colors, 4).palette, Math.round);
        indices = dither === 'floyd-steinberg' ? ditherMap(pixels, width, palette, palette.length / 3, ditherStrength) : paletteIndices(pixels, width, palette, dither, ditherStrength);
    }

    let transparentIndex = -1;
    if (hasTransparency) {
        transparentIndex = palette.length / 3;
        const padded = new Uint8Array(palette.length + 3);
        padded.set(palette);
        palette = padded;

        for (let i = 0; i < length; i++)
            if (pixels[i * 4 + 3] < 128) indices[i] = transparentIndex;
    }

    return { palette, indices, transparentIndex };
}

// returns an exact palette if the opaque pixels use at most `limit` distinct colors
function exactPalette(pixels: Uint8Array, limit: number): { palette: Uint8Array, indices: Uint8Array } | null {
    const lookup = new Map<number, number>();
    const indices = new Uint8Array(pixels.length >> 2);
    const palette: number[] = [];

    for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
        if (pixels[i + 3] < 128) continue;

        const key = pixels[i] << 16 | pixels[i + 1] << 8 | pixels[i + 2];
        let index = lookup.get(key);

        if (index === undefined) {
            if (lookup.size >= limit) return null;
            index = lookup.size;
            lookup.set(key, index);
            palette.push(pixels[i], pixels[i + 1], pixels[i + 2]);
        }

        indices[p] = index;
    }

    // a palette needs at least one entry
    if (!palette.length) palette.push(0, 0, 0);
    return { palette: Uint8Array.from(palette), indices };
}

/**
 * A palette of at most `colors` entries (packed RGB) for the pixels with an alpha of at least `minAlpha`: the colors
 * themselves when there are no more distinct ones than that, else a median cut with k-means refinement
 */
export function buildPalette(pixels: Uint8Array, colors: number, minAlpha: number): Uint8Array {
    const seen = new Set<number>();
    let exact = true;
    for (let i = 0; i < pixels.length && exact; i += 4) {
        if (pixels[i + 3] < minAlpha) continue;
        const key = pixels[i] << 16 | pixels[i + 1] << 8 | pixels[i + 2];
        if (seen.has(key)) continue;
        if (seen.size === colors) exact = false;
        else seen.add(key);
    }

    if (exact) {
        const palette = new Uint8Array(seen.size * 3);
        let p = 0;
        for (const key of seen) {
            palette[p++] = key >> 16;
            palette[p++] = key >> 8 & 255;
            palette[p++] = key & 255;
        }
        return palette;
    }

    return Uint8Array.from(medianCut(pixels, colors, 4, undefined, minAlpha).palette, Math.round);
}

// the 4x4 Bayer matrix, thresholds 0-15 in row order
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// error diffusion patterns: [x offset (mirrored on right-to-left rows), row offset, weight]
const FLOYD_STEINBERG = [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]];
const ATKINSON = [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]];

/**
 * Replaces the RGB of every pixel with an alpha above 0 by its nearest palette entry (packed RGB), in place. Pixels
 * with alpha 0 are left alone. Dithering: `'floyd-steinberg'` and `'atkinson'` spread each pixel's rounding error to
 * the neighbors that come after it (serpentine: rows alternate direction), `'ordered'` offsets each pixel by a 4x4
 * Bayer threshold. `strength` (0-1) scales the spread error and the threshold offset; 0 changes nothing but rounding
 */
export function applyPalette(pixels: Uint8Array, width: number, height: number, palette: Uint8Array, dither: DitherMethod, strength: number): void {
    const entries = palette.length / 3;
    if (!entries) return;
    const nearest = nearestSearch(palette, entries);
    const clampFloat = (v: number): number => v < 0 ? 0 : v > 255 ? 255 : v;

    if (dither === 'none' || dither === 'ordered') {
        // the offsets span about one step between the palette's levels per channel
        const spread = dither === 'ordered' ? strength * 255 / Math.cbrt(entries) : 0;
        for (let y = 0, p = 0; y < height; y++) {
            for (let x = 0; x < width; x++, p++) {
                if (!pixels[p * 4 + 3]) continue;
                const offset = spread ? ((BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) * spread : 0;
                const index = nearest(clampFloat(pixels[p * 4] + offset), clampFloat(pixels[p * 4 + 1] + offset), clampFloat(pixels[p * 4 + 2] + offset));
                pixels[p * 4] = palette[index * 3];
                pixels[p * 4 + 1] = palette[index * 3 + 1];
                pixels[p * 4 + 2] = palette[index * 3 + 2];
            }
        }
        return;
    }

    // the accumulated errors of the rows still to come, three rows in a ring (Atkinson reaches two rows down)
    const pattern = dither === 'atkinson' ? ATKINSON : FLOYD_STEINBERG;
    const rows = [new Float32Array(width * 3), new Float32Array(width * 3), new Float32Array(width * 3)];

    for (let y = 0; y < height; y++) {
        const direction = y & 1 ? -1 : 1;
        const current = rows[y % 3];

        for (let step = 0; step < width; step++) {
            const x = direction === 1 ? step : width - 1 - step;
            const p = y * width + x;
            if (!pixels[p * 4 + 3]) continue;

            const e = x * 3;
            const r = clampFloat(pixels[p * 4] + current[e]);
            const g = clampFloat(pixels[p * 4 + 1] + current[e + 1]);
            const b = clampFloat(pixels[p * 4 + 2] + current[e + 2]);

            const index = nearest(r, g, b);
            const errors = [r - palette[index * 3], g - palette[index * 3 + 1], b - palette[index * 3 + 2]];
            pixels[p * 4] = palette[index * 3];
            pixels[p * 4 + 1] = palette[index * 3 + 1];
            pixels[p * 4 + 2] = palette[index * 3 + 2];

            for (const [dx, dy, weight] of pattern) {
                const tx = x + dx * direction, ty = y + dy;
                if (tx < 0 || tx >= width || ty >= height) continue;
                const target = rows[ty % 3], t = tx * 3;
                for (let c = 0; c < 3; c++) target[t + c] += errors[c] * weight * strength;
            }
        }

        current.fill(0);
    }
}

// weighted median cut on a 15-bit histogram, followed by k-means refinement
function medianCut(pixels: Uint8Array, colors: number, iterations: number, include?: (r: number, g: number, b: number) => boolean, minAlpha = 128): Clusters {
    const count = new Float64Array(32768);
    const sumR = new Float64Array(32768);
    const sumG = new Float64Array(32768);
    const sumB = new Float64Array(32768);

    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < minAlpha) continue;
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        if (include && !include(r, g, b)) continue;
        const bin = (r >> 3) << 10 | (g >> 3) << 5 | b >> 3;
        count[bin]++;
        sumR[bin] += r;
        sumG[bin] += g;
        sumB[bin] += b;
    }

    // collapse non-empty bins into weighted points (mean color + count), stored per channel
    let n = 0;
    for (let i = 0; i < 32768; i++) if (count[i]) n++;

    const points: Points = { c: [new Float64Array(n), new Float64Array(n), new Float64Array(n)], w: new Float64Array(n) };
    for (let i = 0, p = 0; i < 32768; i++) {
        if (!count[i]) continue;
        points.c[0][p] = sumR[i] / count[i];
        points.c[1][p] = sumG[i] / count[i];
        points.c[2][p] = sumB[i] / count[i];
        points.w[p++] = count[i];
    }

    if (!n) return { palette: new Float64Array(0), weights: new Float64Array(0) };
    const boxes = [makeBox(points, Int32Array.from({ length: n }, (_, i) => i))];
    const scratch = new Int32Array(n);
    while (boxes.length < colors) {
        let target = -1;
        for (let i = 0; i < boxes.length; i++)
            if (boxes[i].members.length > 1 && (target === -1 || boxes[i].error > boxes[target].error)) target = i;
        if (target === -1) break;

        const { members, axis, weight } = boxes[target];
        sortBy(members, points.c[axis], scratch);

        // split at the weighted median, keeping at least one point on each side
        const half = weight / 2;
        let split = 1;
        for (let acc = 0; split < members.length - 1; split++) {
            acc += points.w[members[split - 1]];
            if (acc >= half) break;
        }

        boxes.splice(target, 1, makeBox(points, members.subarray(0, split)), makeBox(points, members.subarray(split)));
    }

    const palette = new Float64Array(boxes.length * 3);
    boxes.forEach((box, i) => palette.set(box.mean, i * 3));

    // k-means: reassign every point to its nearest palette color and move colors to their cluster means
    const entries = boxes.length;
    const [pr, pg, pb] = points.c, pw = points.w;
    const weights = Float64Array.from(boxes, box => box.weight);
    for (let iteration = 0; iteration < iterations; iteration++) {
        const acc = new Float64Array(entries * 4);
        const nearest = nearestSearch(palette, entries);

        for (let i = 0; i < n; i++) {
            const index = nearest(pr[i], pg[i], pb[i]);
            acc[index * 4] += pr[i] * pw[i];
            acc[index * 4 + 1] += pg[i] * pw[i];
            acc[index * 4 + 2] += pb[i] * pw[i];
            acc[index * 4 + 3] += pw[i];
        }

        for (let i = 0; i < entries; i++) {
            const w = weights[i] = acc[i * 4 + 3];
            if (!w) continue;
            palette[i * 3] = acc[i * 4] / w;
            palette[i * 3 + 1] = acc[i * 4 + 1] / w;
            palette[i * 3 + 2] = acc[i * 4 + 2] / w;
        }
    }

    return { palette, weights };
}

function makeBox({ c: [r, g, b], w }: Points, members: Int32Array): Box {
    let weight = 0;
    const sum = [0, 0, 0];
    const sq = [0, 0, 0];

    for (let m = 0; m < members.length; m++) {
        const i = members[m];
        weight += w[i];
        sum[0] += r[i] * w[i];
        sq[0] += r[i] * r[i] * w[i];
        sum[1] += g[i] * w[i];
        sq[1] += g[i] * g[i] * w[i];
        sum[2] += b[i] * w[i];
        sq[2] += b[i] * b[i] * w[i];
    }

    const mean = sum.map(v => v / weight);
    // per-axis squared error, weighted the same way as color distances
    const error = sq.map((v, k) => (v - sum[k] * mean[k]) * [WR, WG, WB][k]);
    const axis = error.indexOf(Math.max(...error));

    return { members, weight, mean, axis, error: error[0] + error[1] + error[2] };
}

// stable bottom-up merge sort of indices by their keys, in place
function sortBy(indices: Int32Array, keys: Float64Array, scratch: Int32Array): void {
    const n = indices.length;
    const RUN = 16;

    // insertion sort short runs
    for (let start = 0; start < n; start += RUN) {
        const end = Math.min(n, start + RUN);
        for (let i = start + 1; i < end; i++) {
            const v = indices[i], key = keys[v];
            let j = i - 1;
            for (; j >= start && keys[indices[j]] > key; j--) indices[j + 1] = indices[j];
            indices[j + 1] = v;
        }
    }

    let src = indices, dst = scratch.subarray(0, n);
    for (let width = RUN; width < n; width *= 2) {
        for (let start = 0; start < n; start += 2 * width) {
            const mid = Math.min(n, start + width), end = Math.min(n, start + 2 * width);
            let i = start, j = mid, o = start;
            // already ordered halves are copied as is
            if (mid >= end || keys[src[mid - 1]] <= keys[src[mid]]) {
                dst.set(src.subarray(start, end), start);
                continue;
            }
            while (i < mid && j < end) dst[o++] = keys[src[j]] < keys[src[i]] ? src[j++] : src[i++];
            while (i < mid) dst[o++] = src[i++];
            while (j < end) dst[o++] = src[j++];
        }
        [src, dst] = [dst, src];
    }

    if (src !== indices) indices.set(src);
}

/**
 * Returns a function finding the palette entry closest to a color, with the same result as a linear scan
 * (ties go to the lowest index). Entries are sorted along the axis with the largest weighted spread and
 * searched outwards from the color's position, until that axis' distance alone exceeds the best match
 */
function nearestSearch(palette: ArrayLike<number>, entries: number): (r: number, g: number, b: number) => number {
    const weights = [WR, WG, WB];
    let axis = 0, spread = -1;
    for (let k = 0; k < 3; k++) {
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < entries; i++) {
            min = Math.min(min, palette[i * 3 + k]);
            max = Math.max(max, palette[i * 3 + k]);
        }
        if ((max - min) * weights[k] > spread) {
            spread = (max - min) * weights[k];
            axis = k;
        }
    }

    const order = Int32Array.from({ length: entries }, (_, i) => i).sort((a, b) => palette[a * 3 + axis] - palette[b * 3 + axis]);
    const keys = Float64Array.from(order, i => palette[i * 3 + axis]);
    const weight = weights[axis];

    return (r: number, g: number, b: number): number => {
        const key = axis === 0 ? r : axis === 1 ? g : b;
        let best = 0, bestDistance = Infinity;

        const test = (i: number): void => {
            const dr = r - palette[i * 3], dg = g - palette[i * 3 + 1], db = b - palette[i * 3 + 2];
            const distance = WR * dr * dr + WG * dg * dg + WB * db * db;
            if (distance < bestDistance || (distance === bestDistance && i < best)) {
                bestDistance = distance;
                best = i;
            }
        };

        // first entry with a key >= the color's
        let lo = 0, hi = entries;
        while (lo < hi) {
            const mid = lo + hi >> 1;
            if (keys[mid] < key) lo = mid + 1;
            else hi = mid;
        }

        // the axis term alone bounds the distance, equal bounds can still win a tie
        for (let up = lo, down = lo - 1; up < entries || down >= 0;) {
            if (up < entries) {
                const d = key - keys[up];
                if (weight * d * d > bestDistance) up = entries;
                else test(order[up++]);
            }
            if (down >= 0) {
                const d = key - keys[down];
                if (weight * d * d > bestDistance) down = -1;
                else test(order[down--]);
            }
        }

        return best;
    };
}

// caches nearest palette lookups on an 18-bit color key
function createLookup(palette: Uint8Array, entries: number): (r: number, g: number, b: number) => number {
    const cache = new Int16Array(1 << 18).fill(-1);
    const nearest = nearestSearch(palette, entries);

    return (r: number, g: number, b: number): number => {
        const key = (r >> 2) << 12 | (g >> 2) << 6 | b >> 2;
        let index = cache[key];
        if (index === -1) index = cache[key] = nearest(r, g, b);
        return index;
    };
}

// the palette indices of the pixels mapped by applyPalette() (no dithering, Atkinson or ordered)
function paletteIndices(pixels: Uint8Array, width: number, palette: Uint8Array, dither: DitherMethod, strength: number): Uint8Array {
    const mapped = pixels.slice();
    applyPalette(mapped, width, (pixels.length >> 2) / width, palette, dither, strength);
    const lookup = new Map<number, number>();
    for (let i = palette.length / 3 - 1; i >= 0; i--) lookup.set(palette[i * 3] << 16 | palette[i * 3 + 1] << 8 | palette[i * 3 + 2], i);
    const indices = new Uint8Array(pixels.length >> 2);
    for (let p = 0; p < indices.length; p++) indices[p] = lookup.get(mapped[p * 4] << 16 | mapped[p * 4 + 1] << 8 | mapped[p * 4 + 2]) ?? 0;
    return indices;
}

// serpentine floyd-steinberg error diffusion
function ditherMap(pixels: Uint8Array, width: number, palette: Uint8Array, entries: number, strength: number): Uint8Array {
    const height = (pixels.length >> 2) / width;
    const lookup = createLookup(palette, entries);
    const indices = new Uint8Array(pixels.length >> 2);

    let current = new Float32Array((width + 2) * 3);
    let next = new Float32Array((width + 2) * 3);

    for (let y = 0; y < height; y++) {
        const reverse = y & 1;

        for (let step = 0; step < width; step++) {
            const x = reverse ? width - 1 - step : step;
            const p = y * width + x;
            const e = (x + 1) * 3;

            if (pixels[p * 4 + 3] < 128) continue;

            const r = clamp(pixels[p * 4] + current[e] * strength);
            const g = clamp(pixels[p * 4 + 1] + current[e + 1] * strength);
            const b = clamp(pixels[p * 4 + 2] + current[e + 2] * strength);

            const index = indices[p] = lookup(r, g, b);
            const er = r - palette[index * 3];
            const eg = g - palette[index * 3 + 1];
            const eb = b - palette[index * 3 + 2];

            const forward = reverse ? -3 : 3;
            diffuse(current, next, e, forward, er);
            diffuse(current, next, e + 1, forward, eg);
            diffuse(current, next, e + 2, forward, eb);
        }

        [current, next] = [next, current];
        next.fill(0);
    }

    return indices;
}

// floyd-steinberg weights: 7/16 ahead, 3/16 behind below, 5/16 below, 1/16 ahead below
function diffuse(current: Float32Array, next: Float32Array, i: number, forward: number, error: number): void {
    current[i + forward] += error * 7 / 16;
    next[i - forward] += error * 3 / 16;
    next[i] += error * 5 / 16;
    next[i + forward] += error / 16;
}

function clamp(v: number): number {
    return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

