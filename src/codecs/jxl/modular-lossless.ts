/*!
 * The lossless JPEG XL encoder above the fast one: libjxl's effort 3 (falcon) for Modular images
 * (lib/jxl/enc_modular.cc: try_palettes, the global YCoCg, the fixed tree of the weighted predictor; lib/jxl/modular/
 * transform/enc_palette.cc: FwdPalette for lossless palettes). Copyright (c) the JPEG XL Project Authors, BSD-3-Clause
 * License (see THIRD_PARTY_NOTICES.md)
 */
import { BitWriter } from './bit-writer.ts';
import { imageHeader, u32 } from './headers-enc.ts';
import { EntropyCode, MAX_TOKEN, Tokens, countTokens, writeTokens, type CodeTables } from './entropy-enc.ts';
import { MATree, PRED_WEIGHTED, PROP_WP_ERROR, channelTokens, fixedTree, streamHeader } from './modular-enc.ts';
import { paletteValue, TR_PALETTE, TR_RCT } from './modular.ts';
import { frameHeader } from './fast-lossless.ts';
import { runChunks, shared, startThreads, type ChunkTask, type Thread } from '../../util/threads.ts';

/** A channel of the image being encoded */
interface Channel {
    w: number;
    h: number;
    data: Int32Array;
}

/** A transform (as the decoder reads it) */
interface Transform {
    id: number;
    beginC: number;
    numC?: number;
    nbColors?: number;
}

// libjxl's cutoffs of the weighted predictor's error for its fixed tree (kWPFixedDC)
const WP_CUTOFFS = [
    -500, -392, -255, -191, -127, -95, -63, -47, -31, -23, -15, -11, -7, -4, -3, -1, 0, 1, 3, 5, 7, 11, 15, 23, 31, 47,
    63, 95, 127, 191, 255, 392, 500
];
// the palettes' limits (libjxl's defaults): colors, the percentage of a channel's range it has to use at most
const PALETTE_COLORS = 1024, CHANNEL_COLORS_PERCENT = 95;
// the colors of the implicit palette after the explicit one (a small and a large cube)
const IMPLICIT_SIZE = 64 + 125, GROUP_DIM = 256;
const NO_PALETTE = { w: 0, h: 0, hshift: 0, vshift: 0, data: new Int32Array(0) };

/**
 * A palette of channels begin to begin + nb (if they have at most maxColors colors besides the implicit ones): the
 * palette as a meta channel at the front, the channels as the indices (libjxl's FwdPalette, lossless)
 */
function palette(ch: Channel[], begin: number, nb: number, maxColors: number, transforms: Transform[]): boolean {
    if (maxColors < 2) return false;
    const { w, h } = ch[begin], n = w * h, src = ch.slice(begin, begin + nb).map(c => c.data);
    const key = (i: number): number => {
        let k = 0;
        for (let c = 0; c < nb; c++) k = k * 256 + src[c][i];
        return k;
    };
    const colorOf = (k: number): number[] => {
        const color = new Array<number>(nb);
        for (let c = nb - 1; c >= 0; c--) {
            color[c] = k % 256;
            k = Math.floor(k / 256);
        }
        return color;
    };
    // (the implicit colors and their keys: of 8-bit samples, else they can't be among the image's)
    const implicitKeys: number[] = [];
    for (let k = 0; k < IMPLICIT_SIZE; k++) {
        let v = 0;
        for (let c = 0; c < nb; c++) v = v * 256 + paletteValue(NO_PALETTE, k, c, 8);
        implicitKeys.push(v);
    }
    const implicit = new Set(implicitKeys);
    // the colors in image order (the implicit ones aside), their counts
    const counts = new Map<number, number>(), order: number[] = [];
    for (let i = 0; i < n; i++) {
        const k = key(i), count = counts.get(k);
        if (count !== undefined) {
            counts.set(k, count + 1);
            continue;
        }
        counts.set(k, 1);
        if (implicit.has(k)) continue;
        order.push(k);
        if (order.length > maxColors) return false;
    }
    let nbColors = order.length;
    if (nbColors + (counts.size - nbColors) === 1) return false;
    // (implicit colors that are frequent are in the palette too; the others' indices follow it)
    for (const k of implicitKeys) {
        if ((counts.get(k) ?? 0) > 10) {
            nbColors++;
            order.push(k);
        }
    }
    const index = new Map<number, number>();
    implicitKeys.forEach((k, i) => index.set(k, nbColors + i));
    // by luma (times alpha), first the colors used more than 4 times (dark to bright), then the others (bright to dark)
    if (nb >= 3) {
        const luma = new Map<number, number>();
        for (const k of order) {
            const [r, g, b, a] = colorOf(k);
            let y = 0.299 * r + 0.587 * g + 0.114 * b + 0.1;
            if (nb > 3) y *= 1 + a;
            luma.set(k, (counts.get(k) ?? 0) > 4 ? -y : y);
        }
        order.sort((a, b) => (luma.get(a) as number) - (luma.get(b) as number));
    }
    const meta: Channel = { w: nbColors, h: nb, data: new Int32Array(nbColors * nb) };
    order.forEach((k, i) => {
        colorOf(k).forEach((v, c) => meta.data[c * nbColors + i] = v);
        index.set(k, i);
    });
    const indices = new Int32Array(n);
    for (let i = 0; i < n; i++) indices[i] = index.get(key(i)) as number;
    ch.splice(begin, nb, { w, h, data: indices });
    ch.unshift(meta);
    transforms.push({ id: TR_PALETTE, beginC: begin, numC: nb, nbColors });
    return true;
}

// a palette of one channel (its values, ascending), if it has at most maxColors of them
function channelPalette(ch: Channel[], begin: number, maxColors: number, transforms: Transform[]): boolean {
    if (maxColors < 2) return false;
    const { w, h, data } = ch[begin];
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < data.length; i++) {
        if (data[i] < min) min = data[i];
        if (data[i] > max) max = data[i];
    }
    const lookup = new Int32Array(max - min + 1);
    let count = 0;
    for (let i = 0; i < data.length; i++) {
        if (lookup[data[i] - min]) continue;
        lookup[data[i] - min] = 1;
        if (++count > maxColors) return false;
    }
    const meta: Channel = { w: count, h: 1, data: new Int32Array(count) };
    for (let v = 0, k = 0; v < lookup.length; v++) {
        if (!lookup[v]) continue;
        meta.data[k] = v + min;
        lookup[v] = k++;
    }
    const indices = new Int32Array(data.length);
    for (let i = 0; i < data.length; i++) indices[i] = lookup[data[i] - min];
    ch[begin] = { w, h, data: indices };
    ch.unshift(meta);
    transforms.push({ id: TR_PALETTE, beginC: begin, numC: 1, nbColors: count });
    return true;
}

// YCoCg of channels begin to begin + 3 (RCT type 6), in place
function ycocg(ch: Channel[], begin: number, transforms: Transform[]): void {
    const [r, g, b] = ch.slice(begin, begin + 3).map(c => c.data);
    for (let i = 0; i < r.length; i++) {
        const co = r[i] - b[i], tmp = b[i] + (co >> 1), cg = g[i] - tmp;
        r[i] = tmp + (cg >> 1);
        g[i] = co;
        b[i] = cg;
    }
    transforms.push({ id: TR_RCT, beginC: begin });
}

/** The groups' tokens and sections (in threads): of the channels from first, in groups of 256x256 */
export interface ModularGroupTask extends ChunkTask {
    channels: Channel[];
    first: number;
    width: number;
    numLfGroups: number;
    numPixels: number;
    /** where each group's tokens start (one per sample, the last offset their end), the tokens */
    offsets: Int32Array;
    ctx: Uint32Array;
    value: Uint32Array;
}

/** The tokens of a group (the chunk: of its part of the channels from first), their counts */
export function modularGroupChunks({ channels, first, width, numLfGroups, numPixels, offsets, ctx, value }: ModularGroupTask): (chunk: number) => Float64Array {
    const tree = new MATree(fixedTree(PROP_WP_ERROR, WP_CUTOFFS, PRED_WEIGHTED, numPixels));
    const groupsPerRow = Math.ceil(width / GROUP_DIM);
    return g => {
        const x0 = (g % groupsPerRow) * GROUP_DIM, y0 = Math.floor(g / groupsPerRow) * GROUP_DIM, t = new Tokens();
        // (written where the group's go: exactly as many)
        t.ctx = ctx.subarray(offsets[g], offsets[g + 1]);
        t.value = value.subarray(offsets[g], offsets[g + 1]);
        channels.slice(first).forEach((c, i) => {
            const w = Math.min(GROUP_DIM, c.w - x0), h = Math.min(GROUP_DIM, c.h - y0), part = new Int32Array(w * h);
            for (let y = 0; y < h; y++) part.set(c.data.subarray((y0 + y) * c.w + x0, (y0 + y) * c.w + x0 + w), y * w);
            channelTokens(t, tree, part, w, h, first + i, 1 + 3 * numLfGroups + 17 + g);
        });
        const counts = new Float64Array(tree.numLeaves * MAX_TOKEN);
        countTokens(counts, ctx, value, offsets[g], offsets[g + 1]);
        return counts;
    };
}

/** The sections of the groups (in threads) */
export interface ModularWriteTask extends ChunkTask {
    offsets: Int32Array;
    ctx: Uint32Array;
    value: Uint32Array;
    tables: CodeTables;
}

/** The section of a group (the chunk): its stream's header and tokens, byte aligned */
export function modularWriteChunks({ offsets, ctx, value, tables }: ModularWriteTask): (chunk: number) => Uint8Array {
    return g => {
        const w = new BitWriter();
        streamHeader(w);
        writeTokens(w, tables, ctx, value, offsets[g], offsets[g + 1]);
        w.zeroPadToByte();
        return w.bytes().slice();
    };
}

/** The pixels from which the groups are coded in threads (they start in about 0.1 s) */
const MIN_THREADED_PIXELS = 1 << 19, PIXELS_PER_THREAD = 1 << 17;

/**
 * Encodes RGBA pixels as a lossless JPEG XL codestream like cjxl -e 3: grey if every pixel is, with alpha if one isn't
 * opaque; a palette of up to 1024 colors, else palettes of the channels using few of their values, YCoCg, the residuals
 * of the weighted predictor in the contexts of its error (groups in up to threads worker threads)
 */
export async function encodeModular(rgba: Uint8Array, width: number, height: number, threads = 1): Promise<Uint8Array> {
    if (width < 1 || height < 1) throw new RangeError('JPEG XL: dimensions must be at least 1');
    const n = width * height;
    let grey = true, opaque = true;
    for (let i = 0; i < 4 * n && (grey || opaque); i += 4) {
        if (rgba[i] !== rgba[i + 1] || rgba[i] !== rgba[i + 2]) grey = false;
        if (rgba[i + 3] !== 255) opaque = false;
    }
    const numColor = grey ? 1 : 3, numChans = numColor + (opaque ? 0 : 1);
    const samples = grey ? [0] : [0, 1, 2];
    if (!opaque) samples.push(3);
    const ch: Channel[] = samples.map(o => {
        const data = new Int32Array(n);
        for (let i = 0; i < n; i++) data[i] = rgba[4 * i + o];
        return { w: width, h: height, data };
    });

    // the transforms: a palette of all channels (or of the colors, alpha aside), palettes of single channels, YCoCg
    const transforms: Transform[] = [];
    let didPalette = 0;
    if (numChans > 1) {
        const maxColors = Math.min(Math.trunc(n * 0.2 * 8 * numChans * 0.0005 + n / 128 + 128), PALETTE_COLORS);
        if (palette(ch, 0, numChans, maxColors, transforms)) didPalette = 1;
        else if (numChans > 3 && palette(ch, 0, numChans - 1, maxColors, transforms)) didPalette = 1;
    }
    let nbMeta = didPalette;
    {
        const count = ch.length - nbMeta - didPalette;
        for (let i = didPalette; i < count + didPalette; i++) {
            const begin = i + nbMeta, c = ch[begin];
            let min = Infinity, max = -Infinity;
            for (let k = 0; k < c.data.length; k++) {
                if (c.data[k] < min) min = c.data[k];
                if (c.data[k] > max) max = c.data[k];
            }
            const maxColors = Math.min(Math.trunc(n / 16), Math.trunc(CHANNEL_COLORS_PERCENT / 100 * (max - min + 1)));
            if (channelPalette(ch, begin, maxColors, transforms)) nbMeta++;
        }
    }
    if (numColor === 3 && ch.length - nbMeta >= 3) ycocg(ch, nbMeta, transforms);

    // the global stream: the meta channels and those small enough before the first larger one; the others in groups
    let first = nbMeta;
    while (first < ch.length && ch[first].w <= GROUP_DIM && ch[first].h <= GROUP_DIM) first++;
    const groupsPerRow = Math.ceil(width / GROUP_DIM), groupRows = Math.ceil(height / GROUP_DIM), numGroups = groupsPerRow * groupRows;
    const numLfGroups = Math.ceil(width / 2048) * Math.ceil(height / 2048);
    const numPixels = ch.reduce((sum, c) => sum + c.w * c.h, 0);
    const tree = new MATree(fixedTree(PROP_WP_ERROR, WP_CUTOFFS, PRED_WEIGHTED, numPixels));
    const globalTokens = new Tokens();
    for (let c = 0; c < first; c++) channelTokens(globalTokens, tree, ch[c].data, ch[c].w, ch[c].h, c, 0);
    const counts = new Float64Array(tree.numLeaves * MAX_TOKEN);
    countTokens(counts, globalTokens.ctx, globalTokens.value, 0, globalTokens.length);

    // the groups' tokens, then their sections (in threads, if they start: the channels and tokens shared with them)
    const count = Math.min(threads, numGroups, Math.max(2, Math.floor(n / PIXELS_PER_THREAD)));
    let pool: Thread[] | null = first < ch.length && count > 1 && n >= MIN_THREADED_PIXELS ? startThreads(count) : null;
    const parallel = async <R>(task: ChunkTask, local: (chunk: number) => R): Promise<R[]> => {
        if (pool) {
            try {
                return await runChunks(pool, task, numGroups, local);
            } catch {
                for (const t of pool) t.terminate();
                pool = null;
            }
        }
        return runChunks(null, task, numGroups, local);
    };
    const offsets = new Int32Array(numGroups + 1);
    for (let g = 0; g < numGroups; g++) {
        const x0 = (g % groupsPerRow) * GROUP_DIM, y0 = Math.floor(g / groupsPerRow) * GROUP_DIM;
        offsets[g + 1] = offsets[g] + (ch.length - first) * Math.min(GROUP_DIM, width - x0) * Math.min(GROUP_DIM, height - y0);
    }
    const tokenArray = (): Uint32Array => new Uint32Array(pool ? new SharedArrayBuffer(4 * offsets[numGroups]) : new ArrayBuffer(4 * offsets[numGroups]));
    const groups = { offsets, ctx: tokenArray(), value: tokenArray() };
    let code: EntropyCode, groupSections: Uint8Array[] = [];
    try {
        if (first < ch.length) {
            const channels = pool ? ch.map(c => ({ ...c, data: shared(c.data) })) : ch;
            const task: ModularGroupTask = { task: 'jxl-modular-groups', channels, first, width, numLfGroups, numPixels, ...groups };
            for (const c of await parallel(task, modularGroupChunks(task))) for (let i = 0; i < c.length; i++) counts[i] += c[i];
        }
        code = new EntropyCode(counts, tree.numLeaves);
        if (first < ch.length) {
            const task: ModularWriteTask = { task: 'jxl-modular-write', ...groups, tables: code.tables() };
            groupSections = await parallel(task, modularWriteChunks(task));
        }
    } finally {
        if (pool) for (const t of pool) t.terminate();
    }

    // the sections: LfGlobal (the tree, the code, the global stream), the LF groups and HfGlobal (empty), the groups
    const lfGlobal = new BitWriter();
    // (default LF dequantization, the global tree)
    lfGlobal.write(1, 1);
    lfGlobal.write(1, 1);
    tree.write(lfGlobal);
    code.writeHeader(lfGlobal);
    // the global stream's header: the global tree, the default weighted predictor, the transforms
    lfGlobal.write(1, 1);
    lfGlobal.write(1, 1);
    u32(lfGlobal, transforms.length, [[0, 0], [0, 1], [4, 2], [8, 18]]);
    const begin: [number, number][] = [[3, 0], [6, 8], [10, 72], [13, 1096]];
    for (const t of transforms) {
        lfGlobal.write(2, t.id);
        u32(lfGlobal, t.beginC, begin);
        if (t.id === TR_RCT) lfGlobal.write(2, 0);
        else {
            u32(lfGlobal, t.numC as number, [[0, 1], [0, 3], [0, 4], [13, 1]]);
            u32(lfGlobal, t.nbColors as number, [[8, 0], [10, 256], [12, 1280], [16, 5376]]);
            // (no deltas, the zero predictor)
            lfGlobal.write(2, 0);
            lfGlobal.write(4, 0);
        }
    }
    if (first > 0) code.writeTokens(lfGlobal, globalTokens);
    lfGlobal.zeroPadToByte();
    // (a single group: all channels are in the global stream, the other sections are empty and in the same one)
    const sections = [lfGlobal.bytes()];
    if (numGroups > 1) sections.push(...Array.from({ length: numLfGroups + 1 }, () => new Uint8Array(0)), ...groupSections);

    // the image header, the frame header, the TOC, the sections
    const out = new BitWriter();
    imageHeader(out, width, height, numChans);
    frameHeader(out, !opaque);
    for (const s of sections) u32(out, s.length, [[10, 0], [14, 1024], [22, 17408], [30, 4211712]]);
    out.zeroPadToByte();
    const bytes = new Uint8Array(out.length + sections.reduce((sum, s) => sum + s.length, 0));
    bytes.set(out.bytes());
    let at = out.length;
    for (const s of sections) {
        bytes.set(s, at);
        at += s.length;
    }
    return bytes;
}
