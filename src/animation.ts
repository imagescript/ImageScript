import { colorSpaceTransform, profileTransform } from './util/icc.ts';
import * as gifCodec from './codecs/gif.ts';
import * as png from './codecs/png.ts';
import * as webp from './codecs/webp.ts';
import * as jxl from './codecs/jxl.ts';
import { availableThreads } from './util/threads.ts';
import { BinaryData, view } from './util/mem.ts';
import { GainMap } from './gainmap.ts';
import { Image, DecodeOptions, EncodeOptions, GIFEncodeOptions, ContainOptions, ResizeOptions, ResizeToOptions, resizeArguments, insideSize } from './image.ts';
import { Frame } from './frame.ts';
import { ImageType } from './image-type.ts';
import { optimize, OptimizeOptions, OptimizedFrame } from './util/optimize.ts';
import { paletteOptions } from './codecs/quantize.ts';
import { resolveMetadata, pngText, exifData, gifComments } from './metadata.ts';
import { checkOptions, finite, compressionLevel, loopCount, toPlays, fromPlays, fitLoops, color as checkColor } from './util/options.ts';
import { MAX_PIXELS, decoding } from './util/limits.ts';
import { AnimationEncoder } from './animation-encoder.ts';

// frames decoded fully composited, as full canvas frames
function canvasFrames(width: number, height: number, frames: Array<{ pixels: Uint8Array | Uint8ClampedArray, duration: number }>): Frame[] {
    return frames.map(({ pixels, duration }) => {
        const frame = new Frame(width, height, { duration, disposalMode: 'background' });
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

/** Options of {@link Animation}'s constructor: the canvas size and the loop count */
export interface AnimationCanvasOptions extends AnimationOptions {
    /**
     * The canvas width in pixels: frames (or the parts of them) outside the canvas aren't encoded. Default: the
     * frames' right edge (the largest `xOffset + width`), following the frames until a canvas size is set
     */
    width?: number;
    /** The canvas height in pixels, like `width`. Default: the frames' bottom edge (the largest `yOffset + height`) */
    height?: number;
}

/** The options all animation encoders have */
export interface AnimationEncodeOptions extends EncodeOptions {
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

/** Options of {@link Animation.encodeGIF} and {@link Animation.gifEncoder}: the palette of {@link GIFEncodeOptions} and the animation options */
export interface GIFAnimationEncodeOptions extends GIFEncodeOptions, AnimationEncodeOptions {}

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

    /** @internal @ignore the canvas size, once set (else the frames' extent) */
    private __canvas__: [width: number, height: number] | null = null;

    /**
     * Creates a new animation
     * @param frames The frames to create the animation from
     * @param options The canvas size and the loop count, see {@link AnimationCanvasOptions}
     */
    constructor(frames: Frame[], options?: AnimationCanvasOptions);
    constructor(frames: Frame[], options: AnimationCanvasOptions = {}) {
        checkOptions(options, 'Animation(frames, { loopCount: 2 })');
        const { loopCount: count = Infinity, width, height } = options;
        const loops = loopCount(count);
        if ((width === undefined) !== (height === undefined)) throw new TypeError('Animation() takes both a canvas width and height, or neither');
        const canvas = width === undefined ? null : canvasSize(width, height as number);
        this.frames = frames;
        this.__loopCount__ = loops;
        this.__canvas__ = canvas;
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

    /**
     * The canvas width: the one given to the constructor, the decoded file's, or the one {@link Animation.resize},
     * {@link Animation.crop}, {@link Animation.contain} and {@link Animation.cover} set; else the frames' right edge
     */
    get width(): number {
        if (this.__canvas__) return this.__canvas__[0];
        let max = 0;
        for (const frame of this.frames) max = Math.max(max, frame.width + frame.xOffset);
        return max;
    }

    /** The canvas height, like {@link Animation.width}; else the frames' bottom edge */
    get height(): number {
        if (this.__canvas__) return this.__canvas__[1];
        let max = 0;
        for (const frame of this.frames) max = Math.max(max, frame.height + frame.yOffset);
        return max;
    }

    /** Clones the animation: its frames (with their pixels), canvas size and loop count */
    clone(): Animation {
        const copy = new Animation(this.frames.map(frame => frame.clone()), { loopCount: this.loopCount });
        copy.__canvas__ = this.__canvas__ && [...this.__canvas__];
        return copy;
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
        const [givenWidth, givenHeight, options, fit] = resizeArguments(widthOrOptions, heightArgument, optionsArgument);
        const originalWidth = this.width, originalHeight = this.height;
        if (!originalWidth || !originalHeight) throw new RangeError('An animation without frames or canvas can\'t be resized');
        // a side left out follows the other one, keeping the aspect ratio
        let width = givenWidth ?? originalWidth / originalHeight * (givenHeight as number);
        let height = givenHeight ?? originalHeight / originalWidth * width;
        if (fit === 'inside' && givenWidth !== undefined && givenHeight !== undefined) [width, height] = insideSize(originalWidth, originalHeight, givenWidth, givenHeight);
        const canvas = canvasSize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));

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
        this.__canvas__ = canvas;

        return this;
    }

    /**
     * Crops the canvas to the given region: the frames move with it and are cut to the new canvas. The region is
     * clipped to the canvas, so the result can be smaller than the requested size
     * @param x The x offset (0-based)
     * @param y The y offset (0-based)
     * @param width The new canvas width
     * @param height The new canvas height
     */
    crop(x: number, y: number, width: number, height: number): this {
        x = Math.max(0, Math.floor(finite(x, 'x')));
        y = Math.max(0, Math.floor(finite(y, 'y')));
        width = Math.min(Math.floor(finite(width, 'width')), this.width - x);
        height = Math.min(Math.floor(finite(height, 'height')), this.height - y);
        if (!(width >= 1 && height >= 1)) throw new RangeError('The crop region has to overlap the canvas');
        for (const frame of this.frames) {
            frame.xOffset -= x;
            frame.yOffset -= y;
        }
        this.__canvas__ = [width, height];
        this.frames = this.__clipped_frames__();
        return this;
    }

    /**
     * Resizes the animation to fit inside the given box, keeping its aspect ratio, and centers it on a canvas of
     * exactly that size, like {@link Image.contain}. With a `background` color, the frames become full canvas frames
     * (the composited animation) on that color
     * @param width The width of the box
     * @param height The height of the box
     * @param options The background and how to resize, see {@link ContainOptions}
     */
    contain(width: number, height: number, options?: ContainOptions): this;
    contain(width: number, height: number, options?: ContainOptions): this {
        checkOptions(options, 'contain(width, height, { background: 0x000000ff })');
        const { background = 0x00000000, ...resizeOpts } = options ?? {};
        const backgroundColor = checkColor(background, 'background');
        const [boxWidth, boxHeight] = canvasSize(Math.floor(finite(width, 'width')), Math.floor(finite(height, 'height')));
        this.resize({ width: boxWidth, height: boxHeight, fit: 'inside', ...resizeOpts });
        const x = (boxWidth - this.width) / 2 | 0, y = (boxHeight - this.height) / 2 | 0;
        for (const frame of this.frames) {
            frame.xOffset += x;
            frame.yOffset += y;
        }
        this.__canvas__ = [boxWidth, boxHeight];
        if (backgroundColor !== 0) {
            const composited = png.compositeAnimation({ width: boxWidth, height: boxHeight, frames: this.__apngFrames__() });
            this.frames = composited.map(({ pixels, duration }) => {
                const frame = new Frame(boxWidth, boxHeight, { duration, disposalMode: 'background' }).fill(backgroundColor);
                const content = new Image(boxWidth, boxHeight);
                content.bitmap = pixels;
                return frame.composite(content);
            });
        }
        return this;
    }

    /**
     * Resizes the animation to cover the given box, keeping its aspect ratio, and crops the overflowing edges, like
     * {@link Image.cover}: the canvas gets exactly that size
     * @param width The width of the box
     * @param height The height of the box
     * @param options See {@link ResizeOptions}
     */
    cover(width: number, height: number, options?: ResizeOptions): this;
    cover(width: number, height: number, options?: ResizeOptions): this {
        checkOptions(options, 'cover(width, height, { mode: \'area\' })');
        const [boxWidth, boxHeight] = canvasSize(Math.floor(finite(width, 'width')), Math.floor(finite(height, 'height')));
        const scale = Math.max(boxWidth / this.width, boxHeight / this.height);
        this.resize(Math.max(boxWidth, Math.round(this.width * scale)), Math.max(boxHeight, Math.round(this.height * scale)), options);
        return this.crop((this.width - boxWidth) / 2, (this.height - boxHeight) / 2, boxWidth, boxHeight);
    }

    /**
     * The frames cut to the canvas: frames that lie inside it as they are, the others cropped (copies), and frames
     * entirely outside as a transparent pixel (they show nothing, their duration counts)
     * @internal
     * @ignore
     */
    __clipped_frames__(): Frame[] {
        const width = this.width, height = this.height;
        return this.frames.map(frame => {
            const { xOffset: x, yOffset: y } = frame;
            if (x >= 0 && y >= 0 && x + frame.width <= width && y + frame.height <= height) return frame;
            const left = Math.max(0, x), top = Math.max(0, y);
            const right = Math.min(width, x + frame.width), bottom = Math.min(height, y + frame.height);
            const options = { duration: frame.duration, disposalMode: frame.disposalMode };
            if (right <= left || bottom <= top) return new Frame(1, 1, { ...options, disposalMode: 'keep' });
            const clipped = Frame.from(frame.region(left - x, top - y, right - left, bottom - top), { ...options, xOffset: left, yOffset: top });
            clipped.gainMap = null;
            return clipped;
        });
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
     * @param options See {@link GIFAnimationEncodeOptions}
     */
    encodeGIF(options?: GIFAnimationEncodeOptions): Promise<Uint8Array<ArrayBuffer>>;
    async encodeGIF(options: GIFAnimationEncodeOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
        checkOptions(options, 'encodeGIF({ colors: 64 })');
        const { colors = 256, dither = 'floyd-steinberg', ditherStrength = 0.85, metadata = {}, optimize = true } = options;
        const palette = paletteOptions(colors, dither, ditherStrength);
        const loops = fitLoops(this.loopCount, 'GIF');
        this.__validate__();
        const frames = optimize
            ? this.__optimized__({ replace: false, even: false, alpha: 'frame', palette: 256, cover: true }).map(f => ({ ...f, dispose: f.dispose ? 3 : 1 }))
            : Array.from(this.__clipped_frames__(), frame => ({
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

        return gifCodec.encode({ width: this.width, height: this.height, loopCount: loops, frames: gifFrames }, { colors: palette.colors as number, dither: palette.dither, strength: palette.strength }, gifComments(resolveMetadata(metadata)));
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
        const clipped = this.__clipped_frames__();
        const fullFrames = clipped.some(f => f.disposalMode === 'previous' || (f.disposalMode === 'background' && (f.xOffset & 1 || f.yOffset & 1)));
        if (fullFrames)
            return png.compositeAnimation({ width, height, frames: this.__apngFrames__() })
                .map(c => ({ x: 0, y: 0, width, height, duration: c.duration, dispose: true, pixels: c.pixels }));

        return Array.from(clipped, frame => {
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
        return Array.from(this.__clipped_frames__(), frame => ({
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
     * @param options See {@link GIFAnimationEncodeOptions}, and {@link AnimationOptions.loopCount}
     */
    static gifEncoder(width: number, height: number, options: GIFAnimationEncodeOptions & AnimationOptions = {}): AnimationEncoder {
        checkOptions(options, 'Animation.gifEncoder(width, height, { colors: 64 })');
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
     * @param options See {@link DecodeOptions}
     */
    static decode(input: BinaryData, options?: DecodeOptions): Promise<Animation>;
    static async decode(input: BinaryData, options: DecodeOptions = {}): Promise<Animation> {
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
    private static async __decode__(input: BinaryData, options: DecodeOptions): Promise<Animation> {
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
            return new Animation(frames, { loopCount: fromPlays(decoded.loopCount), width: frames[0]?.width ?? decoded.width, height: frames[0]?.height ?? decoded.height });
        }

        // (still PNGs decode like images)
        if (type === 'png' && !png.isAnimated(data)) {
            const image = await Image.decode(data, { maxPixels, applyOrientation, applyColorProfile });
            return new Animation(canvasFrames(image.width, image.height, [{ pixels: image.bitmap, duration: 0 }]), { loopCount: Infinity, width: image.width, height: image.height });
        }
        if (type === 'png') {
            const decoded = await png.decodeAnimation(data, false, maxPixels);
            const frames = orient(profile(canvasFrames(decoded.width, decoded.height, png.compositeAnimation(decoded)), decoded.icc), decoded.orientation);
            return new Animation(frames, { loopCount: decoded.frames.length > 1 ? fromPlays(decoded.plays) : Infinity, width: frames[0]?.width ?? decoded.width, height: frames[0]?.height ?? decoded.height });
        }

        if (type === 'jxl') {
            const frames: Frame[] = [];
            let loops = Infinity, icc: Uint8Array | undefined, space: jxl.ColorSpace | undefined;
            let orientation = 1;
            for await (const decoded of jxl.frames(data, maxPixels, toneMapping, threads)) {
                const frame = new Frame(decoded.width, decoded.height, { duration: decoded.duration, disposalMode: 'background' });
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
            return new Animation(frames, { loopCount: frames.length > 1 ? loops : Infinity, ...(frames.length ? { width: frames[0].width, height: frames[0].height } : {}) });
        }

        if (type) {
            const image = await Image.decode(data, { maxPixels, applyOrientation, applyColorProfile, toneMapping, gainMap, threads });
            return new Animation([Frame.from(image, { duration: 0 })], { width: image.width, height: image.height });
        }
        throw new Error('Unsupported image type');
    }

    /**
     * @internal
     * @ignore
     */
    private static __gifFrames__(data: Uint8Array, maxPixels: number): Animation {
        const decoded = gifCodec.decode(data, false, maxPixels);
        const frames = gifCodec.composite(decoded).map(({ pixels, delay }) => ({ pixels, duration: 10 * delay }));
        return new Animation(canvasFrames(decoded.width, decoded.height, frames), { loopCount: decoded.loopCount, width: decoded.width, height: decoded.height });
    }
}

// a canvas size: positive integers
function canvasSize(width: number, height: number): [width: number, height: number] {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new RangeError(`Invalid canvas size: ${width}x${height}`);
    return [width, height];
}
