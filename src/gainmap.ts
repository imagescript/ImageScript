import { Image, alignedPixels } from './image.ts';
import type { DecodeOptions } from './image.ts';
import { MAX_PIXELS, decoding } from './util/limits.ts';
import * as jpeg from './codecs/jpeg.ts';
import * as codec from './codecs/gainmap.ts';
import { BinaryData, view } from './util/mem.ts';
import { finite, checkOptions, quality as checkQuality } from './util/options.ts';

/** Options of {@link GainMap.encode} */
export interface GainMapEncodeOptions {
    /** The JPEG quality (1-100). Default: `90` */
    quality?: number;
}

/** A gain-map parameter shared across channels or specified as `[red, green, blue]` */
export type GainMapChannelValues = number | readonly [red: number, green: number, blue: number];

/** Options of the {@link GainMap} constructor */
export interface GainMapOptions {
    /** Extra brightness at the map's darkest value (0); `-1` means half as bright. Default: `0` (no change) */
    min?: GainMapChannelValues;
    /** Extra brightness at the map's brightest value (255); `2` means four times as bright. Default: `2` */
    max?: GainMapChannelValues;
    /** How quickly the brightness changes between `min` and `max`; `1` changes it evenly. Default: `1` */
    gamma?: GainMapChannelValues;
    /**
     * Small brightness offset added before applying the boost, to keep black from being boosted indefinitely.
     * Default: `1/64`
     */
    offsetSDR?: GainMapChannelValues;
    /** Small brightness offset subtracted from the result. Default: `1/64` */
    offsetHDR?: GainMapChannelValues;
    /** How bright a display must be before the map starts to apply; `0` is standard-screen brightness. Default: `0` */
    hdrCapacityMin?: number;
    /** How bright a display must be for the map to apply fully. Default: the largest value in `max` */
    hdrCapacityMax?: number;
    /** Whether the boost uses the original image's colors (`false`: the brighter HDR colors). Default: `true` */
    useBaseColorSpace?: boolean;
}

const perChannel = (value: GainMapChannelValues, name: string): number[] => {
    const values = typeof value === 'number' ? [value, value, value] : Array.from(value);
    if (values.length === 1) values.push(values[0], values[0]);
    if (values.length !== 3) throw new RangeError(`${name} must be a number or an array of 3 numbers`);
    return values.map(v => finite(v, name));
};

/**
 * A gain map is a small companion image that tells a high-dynamic-range (HDR) display how much brighter to show each
 * part of a photo. Standard displays ignore it and show the regular-brightness image.
 *
 * {@link Image.decode} reads gain maps from supported JPEG, AVIF and JPEG XL images into {@link Image.gainMap};
 * {@link Image.encodeJPEG}, {@link Image.encodeAVIF} and {@link Image.encodeJXL} can write them. The map covers the
 * whole image, at any resolution. Each pixel's value (0-255) controls how much extra brightness to add at that
 * location. For developers who need the exact calculation, the boost is
 * `2^(min + (max - min) * (v / 255)^(1 / gamma))`, per color channel.
 *
 * The parameters are checked when they are set: a value that isn't finite (or an array of other than 1 or 3 of them)
 * throws, and the map keeps its value
 */
export class GainMap {
    /** @internal @ignore the parameters (the accessors check and copy them) */
    __min__!: number[];
    /** @internal @ignore */
    __max__!: number[];
    /** @internal @ignore */
    __gamma__!: number[];
    /** @internal @ignore */
    __offsetSDR__!: number[];
    /** @internal @ignore */
    __offsetHDR__!: number[];
    /** @internal @ignore */
    __capacityMin__!: number;
    /** @internal @ignore */
    __capacityMax__!: number;
    /** @internal @ignore */
    __useBaseColorSpace__!: boolean;

    /** log2 of the boost of the map's value 0, per channel (red, green, blue; a copy: assign to change it) */
    get min(): readonly [red: number, green: number, blue: number] { return [this.__min__[0], this.__min__[1], this.__min__[2]]; }
    /**
     * Replaces the value (checked: an invalid one throws and the old one stays)
     * @param value One number for all channels or [r, g, b]
     */
    set min(value: GainMapChannelValues) { this.__min__ = perChannel(value, 'min'); }
    /** log2 of the boost of the map's value 255, per channel (a copy: assign to change it) */
    get max(): readonly [red: number, green: number, blue: number] { return [this.__max__[0], this.__max__[1], this.__max__[2]]; }
    /**
     * Replaces the value (checked: an invalid one throws and the old one stays)
     * @param value One number for all channels or [r, g, b]
     */
    set max(value: GainMapChannelValues) { this.__max__ = perChannel(value, 'max'); }
    /** The gamma the map's values are stored with, per channel (a copy: assign to change it) */
    get gamma(): readonly [red: number, green: number, blue: number] { return [this.__gamma__[0], this.__gamma__[1], this.__gamma__[2]]; }
    /**
     * Replaces the value (checked: an invalid one throws and the old one stays)
     * @param value One number above 0 for all channels or [r, g, b]
     */
    set gamma(value: GainMapChannelValues) {
        const gamma = perChannel(value, 'gamma');
        if (gamma.some(g => g <= 0)) throw new RangeError('The gain map\'s gamma must be above 0');
        this.__gamma__ = gamma;
    }
    /** Added to the SDR image's linear values before the boost, per channel (a copy: assign to change it) */
    get offsetSDR(): readonly [red: number, green: number, blue: number] { return [this.__offsetSDR__[0], this.__offsetSDR__[1], this.__offsetSDR__[2]]; }
    /**
     * Replaces the value (checked: an invalid one throws and the old one stays)
     * @param value One number for all channels or [r, g, b]
     */
    set offsetSDR(value: GainMapChannelValues) { this.__offsetSDR__ = perChannel(value, 'offsetSDR'); }
    /** Subtracted from the HDR result, per channel (a copy: assign to change it) */
    get offsetHDR(): readonly [red: number, green: number, blue: number] { return [this.__offsetHDR__[0], this.__offsetHDR__[1], this.__offsetHDR__[2]]; }
    /**
     * Replaces the value (checked: an invalid one throws and the old one stays)
     * @param value One number for all channels or [r, g, b]
     */
    set offsetHDR(value: GainMapChannelValues) { this.__offsetHDR__ = perChannel(value, 'offsetHDR'); }
    /** log2 of the display headroom from which on the map starts to apply (from 0) */
    get hdrCapacityMin(): number { return this.__capacityMin__; }
    /**
     * Replaces the value (checked: an invalid one throws and the old one stays)
     * @param value A finite number from 0
     */
    set hdrCapacityMin(value: number) {
        const capacity = finite(value, 'hdrCapacityMin');
        if (capacity < 0) throw new RangeError('The gain map\'s hdrCapacityMin can\'t be negative');
        this.__capacityMin__ = capacity;
    }
    /** log2 of the display headroom at which it applies fully (above `hdrCapacityMin`) */
    get hdrCapacityMax(): number { return this.__capacityMax__; }
    /**
     * Replaces the value (checked: an invalid one throws and the old one stays)
     * @param value A finite number
     */
    set hdrCapacityMax(value: number) { this.__capacityMax__ = finite(value, 'hdrCapacityMax'); }
    /** Whether the boost applies in the SDR image's color space (else in the HDR image's) */
    get useBaseColorSpace(): boolean { return this.__useBaseColorSpace__; }
    /**
     * Replaces the value (checked: an invalid one throws and the old one stays)
     * @param value Whether the boost applies in the SDR image's color space
     */
    set useBaseColorSpace(value: boolean) {
        if (typeof value !== 'boolean') throw new TypeError('useBaseColorSpace must be a boolean');
        this.__useBaseColorSpace__ = value;
    }

    /** its pixels */
    private __pixels__: Image | null = null;

    /**
     * Creates a gain map
     * @param image The map's pixels: gray (red, green and blue the same) for one map for all channels. Its alpha is
     *     ignored
     * @param options See {@link GainMapOptions}
     */
    constructor(image: Image, options: GainMapOptions = {}) {
        checkOptions(options, 'new GainMap(image, { max: 2 })');
        if (!(image instanceof Image)) throw new TypeError('The gain map has to be an Image');
        const { min = 0, max = 2, gamma = 1, offsetSDR = 1 / 64, offsetHDR = 1 / 64, hdrCapacityMin = 0, useBaseColorSpace = true } = options;
        this.min = min;
        this.max = max;
        this.gamma = gamma;
        this.offsetSDR = offsetSDR;
        this.offsetHDR = offsetHDR;
        this.hdrCapacityMin = hdrCapacityMin;
        this.hdrCapacityMax = options.hdrCapacityMax ?? Math.max(...this.__max__);
        this.useBaseColorSpace = useBaseColorSpace;
        this.__pixels__ = image;
        this.__check__();
    }

    /**
     * @internal from a decoded file: the map's JPEG, decoded now (a damaged one throws here, not in a later
     * operation); `apple`: an Apple gain map's headroom, its values converted to the parameters' scale
     */
    static __from_jpeg__(map: Uint8Array, params: codec.Params, apple = 0, maxPixels = MAX_PIXELS): GainMap {
        const { width, height, pixels } = jpeg.decode(map, { maxPixels });
        const image = new Image(width, height);
        image.bitmap = alignedPixels(pixels);
        if (apple) {
            const table = new Uint8Array(256);
            for (let v = 0; v < 256; v++) table[v] = Math.round(255 * codec.appleValue(v / 255, apple));
            for (let i = 0; i < pixels.length; i += 4) {
                pixels[i] = table[pixels[i]];
                pixels[i + 1] = table[pixels[i + 1]];
                pixels[i + 2] = table[pixels[i + 2]];
            }
        }
        return GainMap.__from_pixels__(image, params, false);
    }

    /**
     * @internal from decoded pixels (an AVIF's or JPEG XL's map); `gray`: a map whose channels differ by at most 2
     * levels anywhere is made gray (a gray map stored in color, like libjxl writes them: one channel when written)
     */
    static __from_pixels__(image: Image, params: codec.Params, gray = true): GainMap {
        const px = image.bitmap;
        if (gray) {
            let spread = 0;
            for (let i = 0; i < px.length && spread <= 2; i += 4) spread = Math.max(spread, Math.abs(px[i] - px[i + 1]), Math.abs(px[i] - px[i + 2]));
            if (spread > 0 && spread <= 2) for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = Math.round((px[i] + px[i + 1] + px[i + 2]) / 3);
        }
        const gainMap = Object.create(GainMap.prototype) as GainMap;
        gainMap.__pixels__ = image;
        gainMap.__set_params__(params);
        return gainMap;
    }

    private __set_params__(p: codec.Params): void {
        this.__min__ = p.min.slice();
        this.__max__ = p.max.slice();
        this.__gamma__ = p.gamma.slice();
        this.__offsetSDR__ = p.offsetSDR.slice();
        this.__offsetHDR__ = p.offsetHDR.slice();
        this.__capacityMin__ = p.capacityMin;
        this.__capacityMax__ = p.capacityMax;
        this.__useBaseColorSpace__ = p.useBaseColorSpace;
    }

    /** @internal the parameters, checked */
    __params__(): codec.Params {
        this.__check__();
        return {
            min: this.__min__.slice(), max: this.__max__.slice(), gamma: this.__gamma__.slice(), offsetSDR: this.__offsetSDR__.slice(),
            offsetHDR: this.__offsetHDR__.slice(), capacityMin: this.__capacityMin__, capacityMax: this.__capacityMax__, useBaseColorSpace: this.__useBaseColorSpace__
        };
    }

    private __check__(): void {
        // (each value is checked when it is set; these are the checks between them)
        for (let c = 0; c < 3; c++)
            if (this.__max__[c] < this.__min__[c]) throw new RangeError('The gain map\'s max must be at least its min');
        if (this.__capacityMax__ <= this.__capacityMin__) throw new RangeError('The gain map\'s hdrCapacityMax must be above its hdrCapacityMin');
    }

    /** The map's pixels. Changes to them are written when the image is encoded */
    get image(): Image {
        return this.__pixels__ as Image;
    }

    /**
     * Replaces the map's pixels
     * @param image The new map, at any resolution: it covers the whole image
     */
    set image(image: Image) {
        if (!(image instanceof Image)) throw new TypeError('The gain map has to be an Image');
        this.__pixels__ = image;
    }

    /** The map's width */
    get width(): number {
        return (this.__pixels__ as Image).width;
    }

    /** The map's height */
    get height(): number {
        return (this.__pixels__ as Image).height;
    }

    /** `1` for a gray map (one boost for red, green and blue), `3` for one per channel */
    get channels(): 1 | 3 {
        const bitmap = (this.__pixels__ as Image).bitmap;
        for (let i = 0; i < bitmap.length; i += 4) if (bitmap[i] !== bitmap[i + 1] || bitmap[i] !== bitmap[i + 2]) return 3;
        return 1;
    }

    /** Clones the gain map (its pixels too) */
    clone(): GainMap {
        const copy = Object.create(GainMap.prototype) as GainMap;
        copy.__set_params__(this.__params__());
        copy.__pixels__ = (this.__pixels__ as Image).clone();
        return copy;
    }

    /**
     * @internal the map as a JPEG without metadata, at a quality (default 90) and size
     */
    __body__(quality?: number, width?: number, height?: number): Uint8Array {
        let image = this.image;
        if (width !== undefined && height !== undefined && (width !== image.width || height !== image.height)) image = image.clone().resize(width, height);
        const bitmap = image.bitmap;
        const pixels = new Uint8Array(bitmap.buffer, bitmap.byteOffset, bitmap.byteLength);
        // (3 channels: their differences are the point, so the chroma keeps its resolution)
        const gray = this.channels === 1;
        return jpeg.encode(pixels, image.width, image.height, quality ?? 90, { gray, fullChroma: !gray });
    }

    /** @internal the stored values (0-255, per channel) that boost by nothing (log2 gain 0), clamped to the range */
    __neutral__(): number[] {
        return [0, 1, 2].map(c => {
            const min = this.__min__[c], max = this.__max__[c];
            const t = max > min ? Math.min(1, Math.max(0, -min / (max - min))) : 0;
            return Math.round(255 * t ** this.__gamma__[c]);
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
     * @param options See {@link GainMapEncodeOptions}
     */
    encode(options?: GainMapEncodeOptions): Promise<Uint8Array<ArrayBuffer>>;
    async encode(options?: GainMapEncodeOptions): Promise<Uint8Array<ArrayBuffer>> {
        checkOptions(options, 'encode({ quality: 80 })');
        let quality = options?.quality;
        if (quality !== undefined) quality = Math.max(1, checkQuality(quality));
        return codec.mapWithMetadata(this.__body__(quality), this.__params__());
    }

    /**
     * Decodes a gain map JPEG with its parameters (hdrgm XMP or ISO 21496-1), like the second image in an Ultra HDR
     * JPEG, or the gain map of an Ultra HDR JPEG (or an iPhone's JPEG: its values converted to these parameters)
     * @param data The JPEG
     * @param options The `maxPixels` limit, like {@link DecodeOptions.maxPixels} (a map larger than that throws a
     *     {@link LimitError}); a damaged JPEG throws an error saying so, like {@link Image.decode}
     */
    static async decode(data: BinaryData, options: Pick<DecodeOptions, 'maxPixels'> = {}): Promise<GainMap> {
        checkOptions(options, 'GainMap.decode(data, { maxPixels: 1e8 })');
        const { maxPixels = MAX_PIXELS } = options;
        if (!(Number(maxPixels) > 0)) throw new RangeError(`maxPixels must be a positive number, not ${maxPixels}`);
        const bytes = view(data);
        return decoding(() => {
            const found = codec.find(bytes);
            if (found) return GainMap.__from_jpeg__(found.map, found.params, found.apple, maxPixels);
            const params = codec.readParams(bytes);
            if (!params) throw new Error('No gain map (or no gain map parameters) found');
            return GainMap.__from_jpeg__(bytes, params, 0, maxPixels);
        });
    }
}
