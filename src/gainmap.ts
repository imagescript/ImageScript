import { Image } from './image.ts';
import * as jpeg from './codecs/jpeg.ts';
import * as codec from './codecs/gainmap.ts';
import { BinaryData, view } from './util/mem.ts';
import { finite, quality as checkQuality } from './util/options.ts';

/** Options of the {@link GainMap} constructor: per channel values can be one number for all three or [r, g, b] */
export interface GainMapOptions {
    /** log2 of the boost of the map's value 0 (`-1`: half as bright). Default: `0` */
    gainMapMin?: number | number[];
    /** log2 of the boost of the map's value 255 (`2`: 4 times as bright). Default: `2` */
    gainMapMax?: number | number[];
    /** the gamma the map's values are stored with. Default: `1` */
    gamma?: number | number[];
    /** added to the SDR image's linear values before the boost (keeps black from being boosted forever). Default: `1/64` */
    offsetSDR?: number | number[];
    /** subtracted from the HDR result. Default: `1/64` */
    offsetHDR?: number | number[];
    /** log2 of the display headroom from which on the map starts to apply. Default: `0` */
    hdrCapacityMin?: number;
    /** log2 of the display headroom at which it applies fully. Default: `gainMapMax`'s largest value */
    hdrCapacityMax?: number;
    /** whether the boost applies in the SDR image's color space (`false`: in the HDR image's). Default: `true` */
    useBaseColorSpace?: boolean;
}

const perChannel = (value: number | number[], name: string): number[] => {
    const values = typeof value === 'number' ? [value, value, value] : Array.from(value);
    if (values.length === 1) values.push(values[0], values[0]);
    if (values.length !== 3) throw new RangeError(`${name} must be a number or an array of 3 numbers`);
    return values.map(v => finite(v, name));
};

/**
 * A gain map: a small image saying how much brighter each part of an image gets on an HDR display, as Ultra HDR
 * (JPEG-R) photos from phones carry it. HDR displays show the image boosted by it, the others the image as it is.
 *
 * {@link Image.decode} reads the gain maps of JPEGs into {@link Image.gainMap}, {@link Image.encodeJPEG} writes them;
 * the map's pixels are only decoded once they're needed. The map covers the whole image, at any resolution (phones
 * write a quarter of the width and height). Its value `v` (0-255, per channel or one for all) boosts the linear
 * light of the image by `2^(gainMapMin + (gainMapMax - gainMapMin) * (v / 255)^(1 / gamma))`
 */
export class GainMap {
    /** log2 of the boost of the map's value 0, per channel (red, green, blue) */
    gainMapMin: number[];
    /** log2 of the boost of the map's value 255, per channel */
    gainMapMax: number[];
    /** the gamma the map's values are stored with, per channel */
    gamma: number[];
    /** added to the SDR image's linear values before the boost, per channel */
    offsetSDR: number[];
    /** subtracted from the HDR result, per channel */
    offsetHDR: number[];
    /** log2 of the display headroom from which on the map starts to apply */
    hdrCapacityMin: number;
    /** log2 of the display headroom at which it applies fully */
    hdrCapacityMax: number;
    /** whether the boost applies in the SDR image's color space (else in the HDR image's) */
    useBaseColorSpace: boolean;

    /** the map's JPEG (without metadata) until its pixels are used */
    private __jpeg__: Uint8Array | null = null;
    /** its pixels from then on */
    private __pixels__: Image | null = null;
    /** an Apple gain map's headroom: its values are converted when decoded (and the JPEG can't be kept as it is) */
    private __apple__ = 0;

    /**
     * Creates a gain map
     * @param image The map's pixels: grey (red, green and blue the same) for one map for all channels. Its alpha is
     *     ignored
     * @param options See {@link GainMapOptions}
     */
    constructor(image: Image, options: GainMapOptions = {}) {
        if (!(image instanceof Image)) throw new TypeError('The gain map has to be an Image');
        const { gainMapMin = 0, gainMapMax = 2, gamma = 1, offsetSDR = 1 / 64, offsetHDR = 1 / 64, hdrCapacityMin = 0, useBaseColorSpace = true } = options;
        this.gainMapMin = perChannel(gainMapMin, 'gainMapMin');
        this.gainMapMax = perChannel(gainMapMax, 'gainMapMax');
        this.gamma = perChannel(gamma, 'gamma');
        this.offsetSDR = perChannel(offsetSDR, 'offsetSDR');
        this.offsetHDR = perChannel(offsetHDR, 'offsetHDR');
        this.hdrCapacityMin = finite(hdrCapacityMin, 'hdrCapacityMin');
        this.hdrCapacityMax = finite(options.hdrCapacityMax ?? Math.max(...this.gainMapMax), 'hdrCapacityMax');
        this.useBaseColorSpace = Boolean(useBaseColorSpace);
        this.__pixels__ = image;
        this.__check__();
    }

    /** @internal from a decoded file: the map's JPEG, its pixels decoded when first used */
    static __from_jpeg__(map: Uint8Array, params: codec.Params, apple = 0): GainMap {
        const gainMap = Object.create(GainMap.prototype) as GainMap;
        gainMap.__pixels__ = null;
        gainMap.__apple__ = apple;
        gainMap.__jpeg__ = codec.stripMetadata(map);
        gainMap.__set_params__(params);
        return gainMap;
    }

    private __set_params__(p: codec.Params): void {
        this.gainMapMin = p.min.slice();
        this.gainMapMax = p.max.slice();
        this.gamma = p.gamma.slice();
        this.offsetSDR = p.offsetSDR.slice();
        this.offsetHDR = p.offsetHDR.slice();
        this.hdrCapacityMin = p.capacityMin;
        this.hdrCapacityMax = p.capacityMax;
        this.useBaseColorSpace = p.useBaseColorSpace;
    }

    /** @internal the parameters, checked */
    __params__(): codec.Params {
        this.__check__();
        return {
            min: this.gainMapMin.slice(), max: this.gainMapMax.slice(), gamma: this.gamma.slice(), offsetSDR: this.offsetSDR.slice(),
            offsetHDR: this.offsetHDR.slice(), capacityMin: this.hdrCapacityMin, capacityMax: this.hdrCapacityMax, useBaseColorSpace: this.useBaseColorSpace
        };
    }

    private __check__(): void {
        const p: codec.Params = {
            min: perChannel(this.gainMapMin, 'gainMapMin'), max: perChannel(this.gainMapMax, 'gainMapMax'), gamma: perChannel(this.gamma, 'gamma'),
            offsetSDR: perChannel(this.offsetSDR, 'offsetSDR'), offsetHDR: perChannel(this.offsetHDR, 'offsetHDR'),
            capacityMin: finite(this.hdrCapacityMin, 'hdrCapacityMin'), capacityMax: finite(this.hdrCapacityMax, 'hdrCapacityMax'), useBaseColorSpace: this.useBaseColorSpace
        };
        for (let c = 0; c < 3; c++) {
            if (p.gamma[c] <= 0) throw new RangeError('The gain map\'s gamma must be above 0');
            if (p.max[c] < p.min[c]) throw new RangeError('The gain map\'s gainMapMax must be at least its gainMapMin');
        }
        if (p.capacityMin < 0 || p.capacityMax <= p.capacityMin) throw new RangeError('The gain map\'s hdrCapacityMax must be above its hdrCapacityMin, which can\'t be negative');
    }

    /** The map's pixels (decoded when first read). Changes to them are written when the image is encoded */
    get image(): Image {
        if (!this.__pixels__) {
            const { width, height, pixels } = jpeg.decode(this.__jpeg__ as Uint8Array);
            const image = new Image(width, height);
            image.bitmap = pixels;
            if (this.__apple__) {
                // (Apple's values to the parameters' log2 scale)
                const table = new Uint8Array(256);
                for (let v = 0; v < 256; v++) table[v] = Math.round(255 * codec.appleValue(v / 255, this.__apple__));
                for (let i = 0; i < pixels.length; i += 4) {
                    pixels[i] = table[pixels[i]];
                    pixels[i + 1] = table[pixels[i + 1]];
                    pixels[i + 2] = table[pixels[i + 2]];
                }
                this.__apple__ = 0;
            }
            this.__pixels__ = image;
            // (from now on the pixels can change: encoding writes them anew)
            this.__jpeg__ = null;
        }
        return this.__pixels__;
    }

    set image(image: Image) {
        if (!(image instanceof Image)) throw new TypeError('The gain map has to be an Image');
        this.__pixels__ = image;
        this.__jpeg__ = null;
    }

    /** The map's width (without decoding it) */
    get width(): number {
        return this.__pixels__ ? this.__pixels__.width : codec.dimensions(this.__jpeg__ as Uint8Array)?.width ?? 0;
    }

    /** The map's height (without decoding it) */
    get height(): number {
        return this.__pixels__ ? this.__pixels__.height : codec.dimensions(this.__jpeg__ as Uint8Array)?.height ?? 0;
    }

    /** `1` for a grey map (one boost for red, green and blue), `3` for one per channel */
    get channels(): 1 | 3 {
        if (!this.__pixels__) return codec.componentCount(this.__jpeg__ as Uint8Array) === 1 ? 1 : 3;
        const bitmap = this.__pixels__.bitmap;
        for (let i = 0; i < bitmap.length; i += 4) if (bitmap[i] !== bitmap[i + 1] || bitmap[i] !== bitmap[i + 2]) return 3;
        return 1;
    }

    /** Clones the gain map (its pixels too) */
    clone(): GainMap {
        const copy = Object.create(GainMap.prototype) as GainMap;
        copy.__set_params__(this.__params__());
        copy.__jpeg__ = this.__jpeg__;
        copy.__apple__ = this.__apple__;
        copy.__pixels__ = this.__pixels__ ? this.__pixels__.clone() : null;
        return copy;
    }

    /**
     * @internal the map's JPEG without metadata: the decoded file's as it is if the pixels weren't used and no quality
     * or size is asked for, else encoded anew
     */
    __body__(quality?: number, width?: number, height?: number): Uint8Array {
        if (this.__jpeg__ && !this.__apple__ && quality === undefined && (width === undefined || width === this.width && height === this.height)) return this.__jpeg__;
        let image = this.image;
        if (width !== undefined && height !== undefined && (width !== image.width || height !== image.height)) image = image.clone().resize(width, height);
        const bitmap = image.bitmap;
        const pixels = new Uint8Array(bitmap.buffer, bitmap.byteOffset, bitmap.byteLength);
        // (3 channels: their differences are the point, so the chroma keeps its resolution)
        const grey = this.channels === 1;
        return jpeg.encode(pixels, image.width, image.height, quality ?? 90, { grey, fullChroma: !grey });
    }

    /** @internal the stored values (0-255, per channel) that boost by nothing (log2 gain 0), clamped to the range */
    __neutral__(): number[] {
        return [0, 1, 2].map(c => {
            const min = this.gainMapMin[c], max = this.gainMapMax[c];
            const t = max > min ? Math.min(1, Math.max(0, -min / (max - min))) : 0;
            return Math.round(255 * t ** this.gamma[c]);
        });
    }

    /**
     * @internal for a resize of the whole image from one size to another: the map keeps its resolution relative to
     * the image's (unchanged if that's its size already, so a decoded map stays undecoded)
     */
    __rescale__(oldWidth: number, oldHeight: number, width: number, height: number): void {
        const mapWidth = Math.max(1, Math.round(width * this.width / oldWidth)), mapHeight = Math.max(1, Math.round(height * this.height / oldHeight));
        if (mapWidth === this.width && mapHeight === this.height) return;
        this.image = this.image.clone().resize(mapWidth, mapHeight);
    }

    /**
     * @internal for a geometric change of the image (crop, rotation, flip...): the new map, at the same resolution
     * relative to the image, samples the old one (bilinear) where each new image position comes from. Positions are
     * continuous (pixel x spans x to x + 1); those from outside the old image (or null) get the neutral value.
     * `zoom`: how much the image is scaled on the way, below 0.5 the map is downscaled first (no aliasing)
     */
    __transform__(oldWidth: number, oldHeight: number, width: number, height: number, toOld: (x: number, y: number) => [number, number] | null, zoom = 1): void {
        let map = this.image;
        const mapWidth = Math.max(1, Math.round(width * map.width / oldWidth)), mapHeight = Math.max(1, Math.round(height * map.height / oldHeight));
        if (zoom < 0.5) map = map.clone().resize(Math.max(1, Math.round(map.width * zoom * 2)), Math.max(1, Math.round(map.height * zoom * 2)));
        const sx = map.width / oldWidth, sy = map.height / oldHeight;
        const src = map.bitmap, mw = map.width, mh = map.height;
        const out = new Image(mapWidth, mapHeight), dst = out.bitmap;
        const neutral = this.__neutral__();
        for (let j = 0, d = 0; j < mapHeight; j++) {
            for (let i = 0; i < mapWidth; i++, d += 4) {
                dst[d + 3] = 255;
                const old = toOld((i + 0.5) * width / mapWidth, (j + 0.5) * height / mapHeight);
                if (!old || !(old[0] >= 0 && old[0] <= oldWidth && old[1] >= 0 && old[1] <= oldHeight)) {
                    dst[d] = neutral[0];
                    dst[d + 1] = neutral[1];
                    dst[d + 2] = neutral[2];
                    continue;
                }
                const u = Math.min(mw - 1, Math.max(0, old[0] * sx - 0.5)), v = Math.min(mh - 1, Math.max(0, old[1] * sy - 0.5));
                const x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(mw - 1, x0 + 1), y1 = Math.min(mh - 1, y0 + 1);
                const fx = u - x0, fy = v - y0;
                const a = 4 * (y0 * mw + x0), b = 4 * (y0 * mw + x1), c = 4 * (y1 * mw + x0), e = 4 * (y1 * mw + x1);
                for (let k = 0; k < 3; k++)
                    dst[d + k] = (src[a + k] * (1 - fx) + src[b + k] * fx) * (1 - fy) + (src[c + k] * (1 - fx) + src[e + k] * fx) * fy;
            }
        }
        this.image = out;
    }

    /**
     * Encodes the gain map alone: a JPEG with its parameters (hdrgm XMP and ISO 21496-1), like the second image in an
     * Ultra HDR JPEG
     * @param quality The JPEG quality (1-100). Default: `90`, or the decoded file's map as it is if its pixels weren't
     *     used
     */
    async encode(quality?: number): Promise<Uint8Array> {
        if (quality !== undefined) quality = Math.max(1, checkQuality(quality));
        return codec.mapWithMetadata(this.__body__(quality), this.__params__());
    }

    /**
     * Decodes a gain map JPEG with its parameters (hdrgm XMP or ISO 21496-1), like the second image in an Ultra HDR
     * JPEG, or the gain map of an Ultra HDR JPEG (or an iPhone's JPEG: its values converted to these parameters)
     * @param data The JPEG
     */
    static async decode(data: BinaryData): Promise<GainMap> {
        const bytes = view(data);
        const found = codec.find(bytes);
        if (found) return GainMap.__from_jpeg__(found.map, found.params, found.apple);
        const params = codec.readParams(bytes);
        if (!params) throw new Error('No gain map (or no gain map parameters) found');
        const gainMap = GainMap.__from_jpeg__(bytes, params);
        // (decoded now: a damaged JPEG throws here, not later)
        void gainMap.image;
        return gainMap;
    }
}
