import { colorSpaceTransform, profileTransform } from './util/icc.ts';
import * as gifCodec from './codecs/gif.ts';
import * as png from './codecs/png.ts';
import * as webp from './codecs/webp.ts';
import * as jxl from './codecs/jxl.ts';
import { availableThreads } from './util/threads.ts';
import { BinaryData, view } from './util/mem.ts';
import { GainMap } from './gainmap.ts';
import type { ToneMapping } from './codecs/hdr.ts';
import { Image, ResizeOptions, ResizeToOptions, resizeArguments } from './image.ts';
import { Frame, FrameDisposalModes } from './frame.ts';
import { ImageType } from './image-type.ts';
import { optimize, OptimizeOptions, OptimizedFrame } from './util/optimize.ts';
import { Metadata, resolveMetadata, pngText, exifData, gifComments } from './metadata.ts';
import { checkOptions, finite, compressionLevel, loopCount, toPlays, fromPlays, fitLoops } from './util/options.ts';
import { MAX_PIXELS, decoding } from './util/limits.ts';
import { AnimationEncoder } from './animation-encoder.ts';

// frames decoded fully composited, as full canvas frames
function canvasFrames(width: number, height: number, frames: Array<{ pixels: Uint8Array | Uint8ClampedArray, duration: number }>): Frame[] {
    return frames.map(({ pixels, duration }) => {
        const frame = new Frame(width, height, { duration, disposalMode: FrameDisposalModes.BACKGROUND });
        // the composited frames are copies already, the frame can keep them
        frame.bitmap = pixels;
        return frame;
    });
}

/** Options of {@link Animation} */
export interface AnimationOptions {
    /**
     * How many times to repeat the animation: `Infinity` loops forever, 0 plays once, 1 plays twice, ... Anything else
     * throws: a RangeError unless it is an integer from 0 or `Infinity`, a TypeError unless it is a number. Default:
     * `Infinity`
     */
    loopCount?: number;
}

/** Options of {@link Animation.decode} */
export interface AnimationDecodeOptions {
    /**
     * The most pixels to decode, of all frames together (every frame is a full canvas): larger animations throw a
     * RangeError before anything that size is allocated, so small files declaring huge animations (decompression
     * bombs) can't exhaust the memory. Default: `268402689` (16383², like sharp), `Infinity` for no limit
     */
    maxPixels?: number;
    /** Whether to convert the colors of frames with an embedded ICC profile (APNGs, WebPs) to sRGB, like `applyColorProfile` of {@link Image.decode}. Default: `true` */
    applyColorProfile?: boolean;
    /** At most this many worker threads decode in parallel, like `threads` of {@link Image.decode}. Default: the processors available, at most 8 */
    threads?: number;
    /**
     * Whether to rotate/mirror the frames as the orientation tag (Exif, JPEG XL's header, PNG's eXIf chunk or XMP)
     * says, like `applyOrientation` of {@link Image.decode}: APNGs, animated WebPs and JPEG XLs. Default: `true`
     */
    applyOrientation?: boolean;
    /**
     * How HDR (PQ or HLG) JPEG XL animations, whose light can be brighter than (SDR) white, become 8 bit sRGB, like
     * `toneMapping` of {@link Image.decode}: `'reinhard'` compresses the brightest parts, `'clamp'` clamps everything
     * brighter than white. Default: `'reinhard'`
     */
    toneMapping?: ToneMapping;
    /**
     * Whether to read the gain map (jhgm box) of JPEG XL animations into {@link Image.gainMap} of every frame, like
     * `gainMap` of {@link Image.decode}. Default: `true`
     */
    gainMap?: boolean;
}

/** The options all animation encoders have */
export interface AnimationEncodeOptions {
    /** Metadata to include, see {@link Metadata} */
    metadata?: Metadata;
    /**
     * Whether to store each frame as the area that changed since the frame before and merge identical frames, which
     * usually makes files a lot smaller. The file shows the same animation either way, but only decodes to the same
     * frames without it, which also encodes faster when little changes. Default: `true`
     */
    optimize?: boolean;
}

/** Options of {@link Animation.encodeWebP} */
export interface WebPAnimationEncodeOptions extends AnimationEncodeOptions {
    /**
     * Lossy frames (0-100, like libwebp's quality: 75 is its default), much smaller than lossless ones. Without it the
     * frames are lossless. Optimized lossy frames, like libwebp's, leave out 8x8 blocks that only changed a little (by
     * up to 3 per channel at quality 85, 1 at 100)
     */
    quality?: number;
    /** How much effort the frames take (0-6, lossy and lossless), see {@link WebPEncodeOptions.effort}. Default: `2` */
    effort?: number;
    /** Lossy frames: libwebp's sharp YUV conversion, see {@link WebPEncodeOptions.sharpYuv}. Default: `false` */
    sharpYuv?: boolean;
    /** Lossy frames: the alpha planes' quality (0-100), see {@link WebPEncodeOptions.alphaQuality}. Default: `100` */
    alphaQuality?: number;
}

/** Options of {@link Animation.encodeGIF} */
export interface GIFEncodeOptions extends AnimationEncodeOptions {
    /** 1-100, scales the palette size from 8 colors (1) to 256 colors (90 and above). Default: `95` */
    quality?: number;
}

/** Options of {@link Animation.encodeAPNG} */
export interface APNGEncodeOptions extends AnimationEncodeOptions {
    /** The zlib compression level (0-9), higher is smaller but slower. Default: `4` */
    compression?: number;
}

/**
 * An animation: frames ({@link Animation.frames}) that can be decoded from and encoded to GIF, APNG and WebP. It can be
 * iterated (`for (const frame of animation)`), and its `length` is the number of frames.
 */
export class Animation {
    /** @internal @ignore */
    private __loopCount__ = Infinity;

    /** @internal @ignore */
    private __frames__: Frame[] = [];

    /**
     * Creates a new animation
     * @param frames The frames to create the animation from
     * @param options See {@link AnimationOptions}
     */
    constructor(frames: Frame[], options?: AnimationOptions);
    constructor(frames: Frame[], options: AnimationOptions = {}) {
        checkOptions(options, 'Animation(frames, { loopCount: 2 })');
        const { loopCount: count = Infinity } = options;
        const loops = loopCount(count);
        this.frames = frames;
        this.__loopCount__ = loops;
    }

    /**
     * How many times to repeat the animation: `Infinity` (the default) loops forever, 0 plays once, 1 plays twice, ...
     * Other values throw, see {@link AnimationOptions.loopCount}, and the loop count stays as it was
     */
    get loopCount(): number {
        return this.__loopCount__;
    }

    /**
     * Replaces the loop count (see {@link Animation.loopCount}). Anything else than `Infinity` or an integer from 0
     * throws, and the count stays as it was
     * @param value The new loop count
     */
    set loopCount(value: number) {
        this.__loopCount__ = loopCount(value);
    }

    /**
     * The animation's frames: the array the animation uses, so changing it (`push()`, `splice()`, setting an index)
     * changes the animation. Assigning replaces them: the frames are copied into a new array, which is then the one
     * the animation uses
     */
    get frames(): Frame[] {
        return this.__frames__;
    }

    /**
     * Replaces the animation's frames
     * @param frames The new frames (copied into the animation, the array itself isn't kept)
     */
    set frames(frames: Frame[]) {
        const copy: Frame[] = [];
        for (const frame of frames) {
            if (!(frame instanceof Frame)) throw new TypeError(`Frame ${copy.length} is not an instance of Frame`);
            copy.push(frame);
        }
        this.__frames__ = copy;
    }

    /** The number of frames */
    get length(): number {
        return this.__frames__.length;
    }

    /** Iterates over the frames, `for (const frame of animation)` */
    [Symbol.iterator](): IterableIterator<Frame> {
        return this.__frames__[Symbol.iterator]();
    }

    /** The animation's width */
    get width(): number {
        let max = 0;
        for (const frame of this.frames) max = Math.max(max, frame.width + frame.xOffset);
        return max;
    }

    /** The animation's height */
    get height(): number {
        let max = 0;
        for (const frame of this.frames) max = Math.max(max, frame.height + frame.yOffset);
        return max;
    }

    /** The animation's duration (in ms) */
    get duration(): number {
        let duration = 0;
        for (const frame of this.frames) duration += frame.duration;
        return duration;
    }

    /** A short description for debugging, e.g. `Animation<64x64x1000ms>` */
    toString(): string {
        return `Animation<${this.width}x${this.height}x${this.duration}ms>`;
    }

    /**
     * Resizes the animation to the given dimensions, scaling every frame and its offsets proportionally.
     * Pass {@link ResizeToOptions} with only a width or a height to keep the aspect ratio.
     * @param width The new width
     * @param height The new height
     * @param options See {@link ResizeOptions}
     */
    resize(width: number, height: number, options?: ResizeOptions): this;
    /**
     * Resizes the animation, scaling every frame and its offsets proportionally: to the given width or height (the
     * other side keeps the aspect ratio), or to both
     * @param options The size and how to resize, see {@link ResizeToOptions}
     */
    resize(options: ResizeToOptions): this;
    resize(widthOrOptions: number | ResizeToOptions, heightArgument?: number, optionsArgument?: ResizeOptions): this {
        const [givenWidth, givenHeight, options] = resizeArguments(widthOrOptions, heightArgument, optionsArgument);
        const originalWidth = this.width, originalHeight = this.height;
        // a side left out follows the other one, keeping the aspect ratio
        const width = givenWidth ?? originalWidth / originalHeight * (givenHeight as number);
        const height = givenHeight ?? originalHeight / originalWidth * width;

        const sx = width / originalWidth, sy = height / originalHeight;
        for (const frame of this.frames) {
            // scale both edges so adjacent frames stay aligned
            const left = Math.round(frame.xOffset * sx), top = Math.round(frame.yOffset * sy);
            const right = Math.round((frame.xOffset + frame.width) * sx), bottom = Math.round((frame.yOffset + frame.height) * sy);
            (Image.prototype.resize as (width: number, height: number, options?: ResizeOptions) => Image)
                .call(frame, Math.max(1, right - left), Math.max(1, bottom - top), options);
            frame.xOffset = left;
            frame.yOffset = top;
        }

        return this;
    }

    /**
     * @internal
     * @ignore
     */
    protected __validate__(): void {
        for (const frame of this.frames)
            if (!(frame instanceof Frame)) throw new Error('Animation contains invalid frames');
    }

    /**
     * Encodes the animation as GIF. Like all encoders, it stores each frame as the area that changed since the frame
     * before and merges identical frames (unless the `optimize` option is false), so the file decodes to what the
     * animation shows, but not necessarily to the same frames. Semi-transparent pixels become opaque or transparent
     * after the frames are composited
     * @param options See {@link GIFEncodeOptions}
     */
    encodeGIF(options?: GIFEncodeOptions): Promise<Uint8Array<ArrayBuffer>>;
    async encodeGIF(options: GIFEncodeOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
        checkOptions(options, 'encodeGIF({ quality: 80 })');
        const { quality = 95, metadata = {}, optimize = true } = options;
        const loops = fitLoops(this.loopCount, 'GIF');
        this.__validate__();
        const frames = optimize
            ? this.__optimized__({ replace: false, even: false, alpha: 'frame', palette: 256, cover: true }).map(f => ({ ...f, dispose: f.dispose ? 3 : 1 }))
            : Array.from(this.frames, frame => ({
                x: frame.xOffset,
                y: frame.yOffset,
                width: frame.width,
                height: frame.height,
                duration: frame.duration,
                dispose: frame.__disposal_id__,
                pixels: new Uint8Array(frame.bitmap.buffer, frame.bitmap.byteOffset, frame.bitmap.byteLength)
            }));
        // gifs store centiseconds; rounding keeps e.g. 16 ms (60 fps) from becoming 10 ms
        const gifFrames = frames.map(({ duration, ...f }) => ({ ...f, delay: Math.round(duration / 10) }));

        return gifCodec.encode({ width: this.width, height: this.height, loopCount: loops, frames: gifFrames }, finite(quality, 'quality'), gifComments(resolveMetadata(metadata)));
    }

    /**
     * Encodes the animation as APNG (animated PNG, lossless and with full alpha). Viewers without APNG support show
     * the first frame. Each frame is stored as the area that changed since the frame before, identical frames are
     * merged (unless the `optimize` option is false): the file shows exactly the same animation, but doesn't
     * necessarily decode to the same frames
     * @param options See {@link APNGEncodeOptions}
     */
    encodeAPNG(options?: APNGEncodeOptions): Promise<Uint8Array<ArrayBuffer>>;
    async encodeAPNG(options: APNGEncodeOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
        checkOptions(options, 'encodeAPNG({ compression: 9 })');
        const { compression = 4, metadata = {}, optimize = true } = options;
        const loops = fitLoops(this.loopCount, 'APNG');
        this.__validate__();
        if (!this.length) throw new Error('An animation needs at least one frame');

        const frames = optimize
            ? this.__optimized__({ replace: true, even: false, alpha: frames => png.alphaCost(frames.map(f => f.pixels)) }).map(f => ({ ...f, dispose: f.dispose ? 1 : 0 }))
            : this.__apngFrames__().map(({ blend: _, ...f }) => f); // blended, the encoder's default
        return png.encodeAnimation(frames, this.width, this.height, toPlays(loops), compressionLevel(compression), pngText(resolveMetadata(metadata)));
    }

    /**
     * Encodes the animation as animated WebP, lossless or (with a quality) lossy. Each frame is stored as the area that
     * changed since the frame before, identical frames are merged (unless the `optimize` option is false): the file
     * shows the same animation, but doesn't necessarily decode to the same frames
     * @param options See {@link WebPAnimationEncodeOptions}
     */
    async encodeWebP(options: WebPAnimationEncodeOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
        checkOptions(options, 'animation.encodeWebP({ quality: 80 })');
        const { metadata = {}, optimize = true, quality, effort = 2, sharpYuv = false, alphaQuality = 100 } = options;
        const loops = fitLoops(this.loopCount, 'WebP');
        this.__validate__();
        if (!this.length) throw new Error('An animation needs at least one frame');
        const lossy = webp.lossyOptions(quality, effort, sharpYuv, alphaQuality);

        const tolerance = lossy ? webp.lossyTolerance(lossy.quality) : undefined;
        const frames = optimize ? this.__optimized__({ replace: true, even: true, alpha: 'frame', tolerance }) : this.__webpFrames__();
        return webp.encodeAnimation(frames, this.width, this.height, toPlays(loops), exifData(resolveMetadata(metadata)), lossy, effort);
    }

    /**
     * @internal the frames as they are, in the WebP codec's terms
     * @ignore
     */
    __webpFrames__(): webp.WebPEncodeFrame[] {
        const width = this.width, height = this.height;
        // WebP knows no "previous" disposal and stores offsets halved: such animations are stored as full frames
        const fullFrames = this.frames.some(f => f.disposalMode === 'previous' || (f.disposalMode === 'background' && (f.xOffset & 1 || f.yOffset & 1)));
        if (fullFrames)
            return png.compositeAnimation({ width, height, frames: this.__apngFrames__() })
                .map(c => ({ x: 0, y: 0, width, height, duration: c.duration, dispose: true, pixels: c.pixels }));

        return Array.from(this.frames, frame => {
            let { xOffset: x, yOffset: y, width: w, height: h } = frame;
            let pixels = new Uint8Array(frame.bitmap.buffer, frame.bitmap.byteOffset, frame.bitmap.byteLength);
            // odd offsets: one transparent pixel more on the left/top (blending makes it invisible)
            if (x & 1 || y & 1) {
                const dx = x & 1, dy = y & 1;
                const padded = new Uint8Array((w + dx) * (h + dy) * 4);
                for (let row = 0; row < h; row++) padded.set(pixels.subarray(row * w * 4, (row + 1) * w * 4), ((row + dy) * (w + dx) + dx) * 4);
                pixels = padded;
                x -= dx; y -= dy; w += dx; h += dy;
            }
            return { x, y, width: w, height: h, duration: frame.duration, dispose: frame.disposalMode === 'background', pixels };
        });
    }

    /**
     * The frames as the encoders store them: each frame only covers what changed since the one before (see
     * util/optimize.ts)
     * @internal
     * @ignore
     */
    __optimized__(options: OptimizeOptions): OptimizedFrame[] {
        return optimize(this.__apngFrames__(), this.width, this.height, options);
    }

    /**
     * @internal frames in the APNG codec's terms (alpha blended, disposal 0 none, 1 background, 2 previous)
     * @ignore
     */
    __apngFrames__(): png.APNGFrame[] {
        const dispose = [0, 0, 2, 1];
        return Array.from(this.frames, frame => ({
            x: frame.xOffset,
            y: frame.yOffset,
            width: frame.width,
            height: frame.height,
            duration: frame.duration,
            dispose: dispose[frame.__disposal_id__],
            blend: 1,
            pixels: new Uint8Array(frame.bitmap.buffer, frame.bitmap.byteOffset, frame.bitmap.byteLength)
        }));
    }

    /**
     * An encoder that makes an animated WebP a frame at a time, like {@link Animation.encodeWebP} (the same file),
     * without keeping the frames in memory: `await encoder.add(frame)` for each frame (a {@link Frame}, or an image
     * with `{ duration }`), then `await encoder.finish()` for the file
     * @param width The canvas width
     * @param height The canvas height
     * @param options See {@link WebPAnimationEncodeOptions}, and {@link AnimationOptions.loopCount}
     */
    static webpEncoder(width: number, height: number, options: WebPAnimationEncodeOptions & AnimationOptions = {}): AnimationEncoder {
        checkOptions(options, 'Animation.webpEncoder(width, height, { quality: 80 })');
        return AnimationEncoder.__webp__(width, height, options);
    }

    /**
     * An encoder that makes an animated GIF a frame at a time, like {@link Animation.encodeGIF} (the same file),
     * without keeping the frames in memory: `await encoder.add(frame)` for each frame, then `await encoder.finish()`
     * @param width The canvas width
     * @param height The canvas height
     * @param options See {@link GIFEncodeOptions}, and {@link AnimationOptions.loopCount}
     */
    static gifEncoder(width: number, height: number, options: GIFEncodeOptions & AnimationOptions = {}): AnimationEncoder {
        checkOptions(options, 'Animation.gifEncoder(width, height, { quality: 80 })');
        return AnimationEncoder.__gif__(width, height, options);
    }

    /**
     * An encoder that makes an APNG a frame at a time, like {@link Animation.encodeAPNG} (the same file), keeping the
     * frames only compressed (the pixel format depends on all of them): `await encoder.add(frame)` for each frame,
     * then `await encoder.finish()`
     * @param width The canvas width
     * @param height The canvas height
     * @param options See {@link APNGEncodeOptions}, and {@link AnimationOptions.loopCount}
     */
    static apngEncoder(width: number, height: number, options: APNGEncodeOptions & AnimationOptions = {}): AnimationEncoder {
        checkOptions(options, 'Animation.apngEncoder(width, height, { compression: 9 })');
        return AnimationEncoder.__apng__(width, height, options);
    }

    /**
     * Decodes an animated GIF, APNG, WebP or JPEG XL into fully composited frames (still images become a single frame)
     * @param input The binary data to decode
     * @param options See {@link AnimationDecodeOptions}
     */
    static decode(input: BinaryData, options?: AnimationDecodeOptions): Promise<Animation>;
    static async decode(input: BinaryData, options: AnimationDecodeOptions = {}): Promise<Animation> {
        // (checked outside of decoding(), which reports RangeErrors as damaged data)
        checkOptions(options, 'Animation.decode(data, { maxPixels: 1e8 })');
        const { maxPixels = MAX_PIXELS, threads = 1 } = options;
        if (!Number.isInteger(threads) || threads < 1) throw new RangeError(`threads must be a positive integer, not ${threads}`);
        if (!(Number(maxPixels) > 0)) throw new RangeError(`maxPixels must be a positive number, not ${maxPixels}`);
        const { toneMapping = 'reinhard' } = options;
        if (toneMapping !== 'reinhard' && toneMapping !== 'clamp') throw new TypeError(`toneMapping must be 'reinhard' or 'clamp', not ${String(toneMapping)}`);
        return decoding(() => Animation.__decode__(input, options));
    }

    /**
     * @internal
     * @ignore
     */
    private static async __decode__(input: BinaryData, options: AnimationDecodeOptions): Promise<Animation> {
        const { maxPixels = MAX_PIXELS, applyColorProfile = true, threads = Math.max(1, Math.min(availableThreads(), 8)), applyOrientation = true, toneMapping = 'reinhard', gainMap = true } = options;
        const orient = (frames: Frame[], orientation: number): Frame[] => {
            if (applyOrientation && orientation > 1) for (const frame of frames) frame.__orient__(orientation);
            return frames;
        };
        const profile = (frames: Frame[], icc: Uint8Array | undefined, space?: jxl.ColorSpace): Frame[] => {
            const transform = !applyColorProfile ? null : icc ? profileTransform(icc) : space ? colorSpaceTransform(space.xy, space.curve) : null;
            if (transform) for (const frame of frames) transform(frame.bitmap);
            return frames;
        };
        const data = view(input);
        const type = ImageType.getType(data);

        if (type === 'gif') return Animation.__gifFrames__(data, maxPixels);

        if (type === 'webp') {
            const decoded = webp.decodeAnimation(data, false, maxPixels);
            const frames = orient(profile(canvasFrames(decoded.width, decoded.height, webp.composite(decoded)), decoded.icc), decoded.orientation);
            return new Animation(frames, { loopCount: fromPlays(decoded.loopCount) });
        }

        // (still PNGs decode like images)
        if (type === 'png' && !png.isAnimated(data)) {
            const image = await Image.decode(data, { maxPixels, applyOrientation, applyColorProfile });
            return new Animation(canvasFrames(image.width, image.height, [{ pixels: image.bitmap, duration: 0 }]), { loopCount: Infinity });
        }
        if (type === 'png') {
            const decoded = await png.decodeAnimation(data, false, maxPixels);
            const frames = orient(profile(canvasFrames(decoded.width, decoded.height, png.compositeAnimation(decoded)), decoded.icc), decoded.orientation);
            return new Animation(frames, { loopCount: decoded.frames.length > 1 ? fromPlays(decoded.plays) : Infinity });
        }

        if (type === 'jxl') {
            const frames: Frame[] = [];
            let loops = Infinity, icc: Uint8Array | undefined, space: jxl.ColorSpace | undefined;
            let orientation = 1;
            for await (const decoded of jxl.frames(data, maxPixels, toneMapping, threads)) {
                const frame = new Frame(decoded.width, decoded.height, { duration: decoded.duration, disposalMode: FrameDisposalModes.BACKGROUND });
                frame.bitmap = decoded.pixels;
                frames.push(frame);
                orientation = decoded.orientation;
                loops = fromPlays(decoded.loopCount);
                icc = decoded.icc;
                space = decoded.colorSpace;
            }
            // (a gain map that can't be read leaves the frames without one, it doesn't fail the decoding)
            const map = gainMap && data[0] !== 0xff ? await jxl.decodeGainMap(data, maxPixels).catch(() => undefined) : undefined;
            if (map) for (const frame of frames) {
                const image = new Image(map.width, map.height);
                image.bitmap = map.pixels.slice();
                frame.gainMap = GainMap.__from_pixels__(image, map.params);
            }
            for (const frame of orient(profile(frames, icc, space), orientation)) {
                const mapOfFrame = frame.gainMap;
                if (!mapOfFrame || !applyOrientation || orientation <= 1) continue;
                try {
                    mapOfFrame.image = mapOfFrame.image.__orient__(orientation);
                } catch {
                    frame.gainMap = null;
                }
            }
            return new Animation(frames, { loopCount: frames.length > 1 ? loops : Infinity });
        }

        if (type) return new Animation([Frame.from(await Image.decode(data, { maxPixels, applyOrientation, applyColorProfile, toneMapping, gainMap, threads }), { duration: 0 })]);
        throw new Error('Unsupported image type');
    }

    /**
     * @internal
     * @ignore
     */
    private static __gifFrames__(data: Uint8Array, maxPixels: number): Animation {
        const decoded = gifCodec.decode(data, false, maxPixels);
        const frames = gifCodec.composite(decoded).map(({ pixels, delay }) => ({ pixels, duration: 10 * delay }));
        return new Animation(canvasFrames(decoded.width, decoded.height, frames), { loopCount: decoded.loopCount });
    }
}
