import { colorSpaceTransform, profileTransform } from './util/icc.ts';
import * as gifCodec from './codecs/gif.ts';
import * as png from './codecs/png.ts';
import * as webp from './codecs/webp.ts';
import * as jxl from './codecs/jxl.ts';
import { availableThreads } from './util/threads.ts';
import { BinaryData, view } from './util/mem.ts';
import { GainMap } from './gainmap.ts';
import { Image, DecodeOptions, EncodeOptions, GIFEncodeOptions, ResizeOptions, ResizeToOptions, RotateOptions, TransformOptions, AffineTransform, ShadowOptions, OutlineOptions, TrimOptions, resizeArguments, insideSize, alignedPixels, PNGEncodeOptions, WebPEncodeOptions, FlipDirection, FLIP_DIRECTIONS, TONE_MAPPINGS } from './image.ts';
import { Frame } from './frame.ts';
import { ImageType } from './image-type.ts';
import { optimize, OptimizeOptions, OptimizedFrame } from './util/optimize.ts';
import { paletteOptions } from './codecs/quantize.ts';
import { resolveMetadata, pngText, exifData, gifComments } from './metadata.ts';
import { checkOptions, oneOf, pixelLimit, checkThreads, finite, compressionLevel, loopCount, toPlays, fromPlays, fitLoops, fitDuration, maxDuration, color as checkColor } from './util/options.ts';
import { MAX_PIXELS, decoding, checkPixels } from './util/limits.ts';
import { AnimationEncoder } from './animation-encoder.ts';

// frames decoded fully composited, as full canvas frames
function canvasFrames(width: number, height: number, frames: Array<{ pixels: Uint8Array | Uint8ClampedArray, duration: number }>): Frame[] {
    return frames.map(({ pixels, duration }) => {
        // the composited frames are copies already, the frame can keep them
        const image = new Image(width, height);
        image.bitmap = alignedPixels(pixels);
        return new Frame(image, { duration, disposalMode: 'background' });
    });
}

/** Options of {@link Animation} */
export interface AnimationOptions {
    /**
     * How many times to repeat the animation: `Infinity` loops forever, 0 plays once, 1 plays twice, ... Anything else
     * throws: a RangeError unless it is an integer from 0 or `Infinity`, a TypeError unless it is a number
     * @defaultValue `Infinity`
     */
    loopCount?: number;
}

/** Options of {@link Animation}'s constructor: the canvas size and the loop count */
export interface AnimationCanvasOptions extends AnimationOptions {
    /**
     * The canvas width in pixels: frames (or the parts of them) outside the canvas aren't encoded
     * @defaultValue The frames' right edge (the largest `xOffset + width`), following the frames until a canvas size is
     *     set
     */
    width?: number;
    /**
     * The canvas height in pixels, like `width`
     * @defaultValue The frames' bottom edge (the largest `yOffset + height`)
     */
    height?: number;
}

/** The options all animation encoders have */
export interface AnimationEncodeOptions extends EncodeOptions {
    /**
     * Whether to store each frame as the area that changed since the frame before and merge identical frames, which
     * usually makes files a lot smaller. The file shows the same animation either way, but only decodes to the same
     * frames without it, which also encodes faster when little changes. The exception is GIF, which has no partial
     * transparency: without `optimize`, a semi-transparent pixel becomes opaque or transparent in its own frame, with
     * it the frames are composited first
     * @defaultValue `true`
     */
    optimize?: boolean;
}

/**
 * Options of {@link Animation.encodeWebP} and {@link Animation.webpEncoder}: those of {@link WebPEncodeOptions} for every
 * frame (but `threads`: the frames are encoded one at a time), and the animation options. Without `quality` the frames
 * are lossless
 */
export interface WebPAnimationEncodeOptions extends Omit<WebPEncodeOptions, 'threads'>, AnimationEncodeOptions {}

/**
 * Options of {@link Animation.encodeGIF} and {@link Animation.gifEncoder}: those of {@link GIFEncodeOptions} for every
 * frame, and the animation options
 */
export interface GIFAnimationEncodeOptions extends GIFEncodeOptions, AnimationEncodeOptions {}

/**
 * Options of {@link Animation.encodeAPNG} and {@link Animation.apngEncoder}: those of {@link PNGEncodeOptions}, and the
 * animation options
 */
export interface APNGEncodeOptions extends PNGEncodeOptions, AnimationEncodeOptions {}

/**
 * An animation: frames ({@link Animation.frames}) that can be decoded from and encoded to GIF, APNG and WebP. It can be
 * iterated (`for (const frame of animation)`), and its `length` is the number of frames.
 */
export class Animation {
    /** @internal @ignore */
    private __loopCount__ = Infinity;

    /** @internal @ignore */
    private __animationSignal__ = false;

    /** @internal @ignore */
    private __frames__: Frame[] = [];

    /** @internal @ignore */
    private __framesView__: readonly Frame[] | null = null;

    /** @internal @ignore the canvas size, once set (else the frames' extent) */
    private __canvas__: [width: number, height: number] | null = null;

    /**
     * Creates a new animation
     * @example
     * ```ts
     * const animation = new Animation([
     *     new Frame(new Image(64, 64).fill(0xff0000ff), { duration: 200 }),
     *     new Frame(new Image(64, 64).fill(0x0000ffff), { duration: 200 })
     * ], { loopCount: 2 });
     * const gif = await animation.encodeGIF();
     * ```
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
     * The animation's frames as a frozen array. The frames themselves are mutable; assign a new array to replace the
     * list
     */
    get frames(): readonly Frame[] {
        return this.__framesView__ ??= Object.freeze([...this.__frames__]);
    }

    /**
     * Replaces the animation's frames
     * @param frames The new frames (copied into the animation; the array itself isn't kept)
     */
    set frames(frames: readonly Frame[]) {
        const copy: Frame[] = [];
        for (const frame of frames) {
            if (!(frame instanceof Frame)) throw new TypeError(`Frame ${copy.length} is not an instance of Frame`);
            copy.push(frame);
        }
        this.__frames__ = copy;
        this.__framesView__ = null;
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
     * The canvas width: the one given to the constructor, the decoded file's, or the one {@link Animation.resize} and
     * {@link Animation.crop} set; else the frames' right edge
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
     * @throws `RangeError` if the width or height is less than 1 pixel, or the animation has no canvas
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
        if (fit === 'contain' || fit === 'cover') {
            if (givenWidth === undefined || givenHeight === undefined) throw new TypeError(`resize({ fit: '${fit}' }) needs both width and height`);
            return fit === 'contain'
                ? this.__contain__(givenWidth, givenHeight, options)
                : this.__cover__(givenWidth, givenHeight, options);
        }
        const originalWidth = this.width, originalHeight = this.height;
        if (!originalWidth || !originalHeight) throw new RangeError('An animation without frames or canvas can\'t be resized');
        // (a side that is given has to be a pixel at least, like Image.resize() wants; one that follows the other can't be less)
        if (givenWidth !== undefined && Math.floor(givenWidth) < 1) throw new RangeError('The animation has to be at least 1 pixel wide');
        if (givenHeight !== undefined && Math.floor(givenHeight) < 1) throw new RangeError('The animation has to be at least 1 pixel high');
        // the size of the canvas as Image.resize() works it out: a side that is given is cut to whole pixels, one left
        // out follows the other, keeping the aspect ratio
        let width: number, height: number;
        if (fit === 'inside' && givenWidth !== undefined && givenHeight !== undefined) [width, height] = insideSize(originalWidth, originalHeight, givenWidth, givenHeight).map(Math.floor);
        else if (givenWidth === undefined) {
            height = Math.floor(givenHeight as number);
            width = Math.max(1, Math.round(originalWidth / originalHeight * height));
        } else if (givenHeight === undefined) {
            width = Math.floor(givenWidth);
            height = Math.max(1, Math.round(originalHeight / originalWidth * width));
        } else [width, height] = [Math.floor(givenWidth), Math.floor(givenHeight)];
        const canvas = canvasSize(Math.max(1, width), Math.max(1, height));

        const sx = width / originalWidth, sy = height / originalHeight;
        // (a frame listed twice, or two frames of one image, change once: the sizes and offsets are worked out before anything does)
        const changes = this.__distinct__().map(frame => {
            // scale both edges so adjacent frames stay aligned
            const left = Math.round(frame.xOffset * sx), top = Math.round(frame.yOffset * sy);
            const right = Math.round((frame.xOffset + frame.width) * sx), bottom = Math.round((frame.yOffset + frame.height) * sy);
            return { frame, left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
        });
        const shared = new Set<Image>(), seen = new Set<Image>();
        for (const { frame } of changes) (seen.has(frame.image) ? shared : seen).add(frame.image);
        const originals = new Map<Image, Image>(Array.from(shared, image => [image, image.clone()]));
        const resized = new Map<Image, string>();
        for (const { frame, left, top, width, height } of changes) {
            const size = `${width}x${height}`, done = resized.get(frame.image), original = originals.get(frame.image);
            if (done === undefined) {
                resized.set(frame.image, size);
                frame.image.resize(width, height, options);
            } else if (done !== size && original) {
                // (the frame's image was resized already: the copy of the original is what the others start from)
                frame.image = original.clone().resize(width, height, options);
            }
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
        // (the part of the region that lies on the canvas)
        const left = Math.max(0, Math.floor(finite(x, 'x'))), top = Math.max(0, Math.floor(finite(y, 'y')));
        const right = Math.min(this.width, Math.floor(finite(x, 'x')) + Math.floor(finite(width, 'width')));
        const bottom = Math.min(this.height, Math.floor(finite(y, 'y')) + Math.floor(finite(height, 'height')));
        if (!(right - left >= 1 && bottom - top >= 1)) throw new RangeError('The crop region has to overlap the canvas');
        for (const frame of this.__distinct__()) {
            frame.xOffset -= left;
            frame.yOffset -= top;
        }
        this.__canvas__ = [right - left, bottom - top];
        this.frames = this.__clipped_frames__();
        return this;
    }

    /**
     * Resizes and centers the animation in a box of exactly that size, with transparent or colored bars
     * @internal
     */
    private __contain__(width: number, height: number, options?: ResizeOptions & { background?: number }): this {
        checkOptions(options, 'resize({ width, height, fit: \'contain\', background: 0x000000ff })');
        const { background = 0x00000000, ...resizeOpts } = options ?? {};
        const backgroundColor = checkColor(background, 'background');
        const [boxWidth, boxHeight] = canvasSize(Math.floor(finite(width, 'width')), Math.floor(finite(height, 'height')));
        this.resize({ width: boxWidth, height: boxHeight, fit: 'inside', ...resizeOpts });
        const x = (boxWidth - this.width) / 2 | 0, y = (boxHeight - this.height) / 2 | 0;
        for (const frame of this.__distinct__()) {
            frame.xOffset += x;
            frame.yOffset += y;
        }
        this.__canvas__ = [boxWidth, boxHeight];
        if (backgroundColor !== 0) {
            this.frames = this.__flattened__().map(frame => {
                frame.image = new Image(boxWidth, boxHeight).fill(backgroundColor).composite(frame.image);
                return frame;
            });
        }
        return this;
    }

    /**
     * Resizes the animation to cover the box and crops the overflowing edges
     * @internal
     */
    private __cover__(width: number, height: number, options?: ResizeOptions): this {
        checkOptions(options, 'resize({ width, height, fit: \'cover\' })');
        const [boxWidth, boxHeight] = canvasSize(Math.floor(finite(width, 'width')), Math.floor(finite(height, 'height')));
        const scale = Math.max(boxWidth / this.width, boxHeight / this.height);
        this.resize(Math.max(boxWidth, Math.round(this.width * scale)), Math.max(boxHeight, Math.round(this.height * scale)), options);
        return this.crop((this.width - boxWidth) / 2, (this.height - boxHeight) / 2, boxWidth, boxHeight);
    }

    /**
     * Flips / mirrors the animation horizontally or vertically, like {@link Image.flip}: every frame is flipped and
     * moved to the mirrored place on the canvas, which keeps its size
     * @param direction The direction to flip, see {@link FlipDirection}
     */
    flip(direction: FlipDirection): this {
        oneOf(direction, FLIP_DIRECTIONS, 'flip direction');
        const width = this.width, height = this.height;
        // (a frame listed twice, or two frames of one image, are flipped once)
        const flipped = new Set<Image>();
        for (const frame of this.__distinct__()) {
            if (!flipped.has(frame.image)) frame.image.flip(direction);
            flipped.add(frame.image);
            if (direction === 'horizontal') frame.xOffset = width - frame.xOffset - frame.width;
            else frame.yOffset = height - frame.yOffset - frame.height;
        }
        // (the canvas stays: one that followed the frames would follow the mirrored ones elsewhere)
        if (width && height) this.__canvas__ = [width, height];
        return this;
    }

    /**
     * Scales the animation by a factor: every frame and its offsets, and the canvas
     * @param factor The factor
     * @param options See {@link ResizeOptions}
     */
    scale(factor: number, options?: ResizeOptions): this {
        if (!(finite(factor, 'factor') > 0)) throw new RangeError(`Invalid scale factor: ${factor}`);
        // (a side doesn't shrink below one pixel, like Image.scale())
        return this.resize(Math.max(1, this.width * factor), Math.max(1, this.height * factor), options);
    }

    /**
     * Trims the canvas: removes the borders of one color around what any frame shows (in the composited animation),
     * like {@link Image.trim}. The frames keep their pixels, the canvas is cropped like {@link Animation.crop}
     * @param options The color (by default the top left pixel of the first frame) and the tolerance, see
     *     {@link TrimOptions}
     */
    trim(options: TrimOptions = {}): this {
        checkOptions(options, 'trim({ tolerance: 0.1 })');
        const frames = this.__flattened__();
        if (!frames.length) return this;
        const { color = frames[0].image.getPixelAt(0, 0), ...rest } = options;
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (const { image } of frames) {
            const bounds = image.__trim_bounds__(color, rest);
            if (!bounds) continue;
            left = Math.min(left, bounds[0]);
            top = Math.min(top, bounds[1]);
            right = Math.max(right, bounds[0] + bounds[2]);
            bottom = Math.max(bottom, bounds[1] + bounds[3]);
        }
        if (left === Infinity) return this;
        return this.crop(left, top, right - left, bottom - top);
    }

    /**
     * Rotates the animation clockwise, like {@link Image.rotate}: the frames become full canvas frames of the
     * composited animation (a partial frame turned by any angle wouldn't cover a rectangle anymore), each one rotated,
     * and the canvas takes their size
     * @param angle The angle in degrees, clockwise
     * @param options See {@link RotateOptions}
     */
    rotate(angle: number, options?: RotateOptions): this {
        return this.__each__(image => image.rotate(angle, options));
    }

    /**
     * Transforms the animation with an affine transform, like {@link Image.transform}: the frames become full canvas
     * frames of the composited animation, each one transformed (by default around the canvas' middle), and the canvas
     * takes their size
     * @param matrix The six values [a, b, c, d, e, f]
     * @param options See {@link TransformOptions}
     */
    transform(matrix: AffineTransform, options?: TransformOptions): this {
        return this.__each__(image => image.transform(matrix, options));
    }

    /**
     * Adds a shadow behind what the animation shows, like {@link Image.dropShadow}: the frames become full canvas
     * frames of the composited animation, each one with its shadow, and the canvas grows with them
     * @param options See {@link ShadowOptions}
     */
    dropShadow(options?: ShadowOptions): this {
        return this.__each__(image => image.dropShadow(options));
    }

    /**
     * Draws an outline around what the animation shows, like {@link Image.outline}: the frames become full canvas
     * frames of the composited animation, each one outlined, and the canvas grows with them
     * @param options See {@link OutlineOptions}
     */
    outline(options?: OutlineOptions): this {
        return this.__each__(image => image.outline(options));
    }

    /**
     * The composited animation: one full canvas frame per frame, with its duration (gain maps are dropped)
     * @internal
     * @ignore
     */
    __flattened__(): Frame[] {
        const { width, height } = this;
        if (!this.length) return [];
        return png.compositeAnimation({ width, height, frames: this.__apngFrames__() }).map(({ pixels, duration }) => {
            const image = new Image(width, height);
            image.bitmap = alignedPixels(pixels);
            return new Frame(image, { duration, disposalMode: 'background' });
        });
    }

    /**
     * Applies a change to every frame of the composited animation; the canvas takes the frames' new size. Nothing
     * changes if the change throws
     * @internal
     * @ignore
     */
    private __each__(change: (image: Image) => unknown): this {
        const { width, height } = this;
        if (!width || !height) throw new RangeError('An animation without frames or canvas can\'t be changed');
        const frames = this.__flattened__();
        const probe = frames[0]?.image ?? new Image(width, height);
        for (const frame of frames.length ? frames : [new Frame(probe)]) change(frame.image);
        this.frames = frames;
        this.__canvas__ = [probe.width, probe.height];
        return this;
    }

    /**
     * The frames without repeats: a frame can be listed several times (to hold it, or in a ping-pong), and a change to
     * it has to apply once
     * @internal
     * @ignore
     */
    __distinct__(): Frame[] {
        return [...new Set(this.__frames__)];
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
            if (right <= left || bottom <= top) return new Frame(new Image(1, 1), { ...options, disposalMode: 'keep' });
            const clipped = frame.image.extract(left - x, top - y, right - left, bottom - top);
            clipped.gainMap = null;
            return new Frame(clipped, { ...options, xOffset: left, yOffset: top });
        });
    }

    /**
     * @internal
     * @ignore
     */
    protected __validate__(format: 'GIF' | 'APNG' | 'WebP'): void {
        if (!this.length) throw new Error('An animation needs at least one frame');
        for (const frame of this.frames) {
            if (!(frame instanceof Frame)) throw new Error('Animation contains invalid frames');
            fitDuration(frame.duration, format);
        }
        const { width, height } = this;
        if (width < 1 || height < 1) throw new RangeError('The animation has no canvas: every frame lies outside of it');
        if (format === 'GIF' && (width > 0xffff || height > 0xffff)) throw new RangeError(`GIF: images can be at most 65535 pixels wide and high, not ${width}x${height}`);
        if (format === 'WebP' && (width > 1 << 24 || height > 1 << 24)) throw new RangeError('WebP: canvas too large');
    }

    /**
     * Encodes the animation as GIF. Like all encoders, it stores each frame as the area that changed since the frame
     * before and merges identical frames (unless the `optimize` option is false), so the file decodes to what the
     * animation shows, but not necessarily to the same frames. Semi-transparent pixels become opaque or transparent
     * after the frames are composited
     * @param options See {@link GIFAnimationEncodeOptions}
     * @throws `Error` if the animation has no frames
     * @throws `RangeError` if the loop count or a frame's duration is more than GIF stores, or the canvas is wider or
     * higher than 65535 pixels
     */
    encodeGIF(options?: GIFAnimationEncodeOptions): Promise<Uint8Array<ArrayBuffer>>;
    async encodeGIF(options: GIFAnimationEncodeOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
        checkOptions(options, 'encodeGIF({ colors: 64 })');
        const { colors = 256, dither = 'floyd-steinberg', ditherStrength = 0.85, metadata = {}, optimize = true } = options;
        const palette = paletteOptions(colors, dither, ditherStrength);
        const loops = fitLoops(this.loopCount, 'GIF');
        this.__validate__('GIF');
        const frames = optimize
            ? this.__optimized__({ replace: false, even: false, alpha: 'frame', palette: 256, cover: true, maxDuration: maxDuration('GIF') }).map(f => ({ ...f, dispose: f.dispose ? 3 : 1 }))
            : Array.from(this.__clipped_frames__(), frame => ({
                x: frame.xOffset,
                y: frame.yOffset,
                width: frame.width,
                height: frame.height,
                duration: frame.duration,
                dispose: frame.__disposal_id__,
                pixels: new Uint8Array(frame.image.bitmap.buffer, frame.image.bitmap.byteOffset, frame.image.bitmap.byteLength)
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
     * @throws `Error` if the animation has no frames
     * @throws `RangeError` if the loop count or a frame's duration is more than APNG stores
     */
    encodeAPNG(options?: APNGEncodeOptions): Promise<Uint8Array<ArrayBuffer>>;
    async encodeAPNG(options: APNGEncodeOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
        checkOptions(options, 'encodeAPNG({ compression: 9 })');
        const { compression = 4, metadata = {}, optimize = true } = options;
        const loops = fitLoops(this.loopCount, 'APNG');
        this.__validate__('APNG');

        const frames = optimize
            ? this.__optimized__({ replace: true, even: false, alpha: frames => png.alphaCost(frames.map(f => f.pixels)), maxDuration: maxDuration('APNG') }).map(f => ({ ...f, dispose: f.dispose ? 1 : 0 }))
            : this.__apngFrames__().map(({ blend: _, ...f }) => f); // blended, the encoder's default
        return png.encodeAnimation(frames, this.width, this.height, toPlays(loops), compressionLevel(compression), pngText(resolveMetadata(metadata)));
    }

    /**
     * Encodes the animation as animated WebP, lossless or (with a quality) lossy. Each frame is stored as the area that
     * changed since the frame before, identical frames are merged (unless the `optimize` option is false): the file
     * shows the same animation, but doesn't necessarily decode to the same frames
     * @param options See {@link WebPAnimationEncodeOptions}
     * @throws `Error` if the animation has no frames
     * @throws `RangeError` if the loop count or a frame's duration is more than WebP stores
     */
    async encodeWebP(options: WebPAnimationEncodeOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
        checkOptions(options, 'animation.encodeWebP({ quality: 80 })');
        const { metadata = {}, optimize = true, quality, effort = 2, sharpYuv = false, alphaQuality = 100 } = options;
        const loops = fitLoops(this.loopCount, 'WebP');
        this.__validate__('WebP');
        const lossy = webp.lossyOptions(quality, effort, sharpYuv, alphaQuality);

        const tolerance = lossy ? webp.lossyTolerance(lossy.quality) : undefined;
        const frames = optimize ? this.__optimized__({ replace: true, even: true, alpha: 'frame', tolerance, maxDuration: maxDuration('WebP') }) : this.__webpFrames__();
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
            let pixels = new Uint8Array(frame.image.bitmap.buffer, frame.image.bitmap.byteOffset, frame.image.bitmap.byteLength);
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
            pixels: new Uint8Array(frame.image.bitmap.buffer, frame.image.bitmap.byteOffset, frame.image.bitmap.byteLength)
        }));
    }

    /**
     * An encoder that makes an animated WebP a frame at a time, like {@link Animation.encodeWebP} (the same file),
     * without keeping the frames in memory: `await encoder.add(frame)` for each frame (a {@link Frame}, or an image
     * with `{ duration }`), then `await encoder.finish()` for the file
     * @example
     * ```ts
     * const encoder = Animation.webpEncoder(64, 64, { quality: 80 });
     * for (const color of [0xff0000ff, 0x00ff00ff, 0x0000ffff])
     *     await encoder.add(new Image(64, 64).fill(color), { duration: 200 });
     * const webp = await encoder.finish();
     * ```
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
     * @example
     * ```ts
     * const animation = await Animation.decode(gifBytes);
     * const webp = await animation.resize({ width: 320 }).encodeWebP({ quality: 75 });
     * ```
     * @param input The binary data to decode
     * @param options See {@link DecodeOptions}
     * @throws {@link LimitError} if the frames have more than `options.maxPixels` pixels together
     * @throws `Error` if the data isn't a supported image, or is damaged or truncated
     */
    static decode(input: BinaryData, options?: DecodeOptions): Promise<Animation>;
    static async decode(input: BinaryData, options: DecodeOptions = {}): Promise<Animation> {
        // (checked outside of decoding(), which reports RangeErrors as damaged data)
        checkOptions(options, 'Animation.decode(data, { maxPixels: 1e8 })');
        const { maxPixels = MAX_PIXELS, threads = 1 } = options;
        checkThreads(threads);
        pixelLimit(maxPixels);
        const { toneMapping = 'reinhard' } = options;
        oneOf(toneMapping, TONE_MAPPINGS, 'toneMapping');
        return decoding(() => Animation.__decode__(input, options));
    }

    /** @internal @ignore */
    static __is_animated__(animation: Animation): boolean {
        return animation.__animationSignal__;
    }

    /**
     * @internal
     * @ignore
     */
    private static async __decode__(input: BinaryData, options: DecodeOptions): Promise<Animation> {
        const { maxPixels = MAX_PIXELS, applyColorProfile = true, threads = Math.max(1, Math.min(availableThreads(), 8)), applyOrientation = true, toneMapping = 'reinhard', gainMap = true } = options;
        const orient = (frames: Frame[], orientation: number): Frame[] => {
            if (applyOrientation && orientation > 1) for (const frame of frames) frame.image.__orient__(orientation);
            return frames;
        };
        const profile = (frames: Frame[], icc: Uint8Array | undefined, space?: jxl.ColorSpace): Frame[] => {
            const transform = !applyColorProfile ? null : icc ? profileTransform(icc) : space ? colorSpaceTransform(space.xy, space.curve) : null;
            if (transform) for (const frame of frames) transform(frame.image.bitmap);
            return frames;
        };
        const data = view(input);
        const type = ImageType.getType(data);

        if (type === 'gif') return Animation.__gifFrames__(data, maxPixels);

        if (type === 'webp') {
            const animated = webp.isAnimated(data);
            const decoded = webp.decodeAnimation(data, false, maxPixels);
            const frames = orient(profile(canvasFrames(decoded.width, decoded.height, webp.composite(decoded)), decoded.icc), decoded.orientation);
            const animation = new Animation(frames, { loopCount: fromPlays(decoded.loopCount), width: frames[0]?.width ?? decoded.width, height: frames[0]?.height ?? decoded.height });
            animation.__animationSignal__ = animated;
            return animation;
        }

        // (still PNGs decode like images)
        if (type === 'png' && !png.isAnimated(data)) {
            const image = await Image.decode(data, { maxPixels, applyOrientation, applyColorProfile });
            return new Animation(canvasFrames(image.width, image.height, [{ pixels: image.bitmap, duration: 0 }]), { loopCount: Infinity, width: image.width, height: image.height });
        }
        if (type === 'png') {
            const decoded = await png.decodeAnimation(data, false, maxPixels);
            // (composited as they are decoded: the raw frames don't pile up)
            const step = png.compositor(decoded.width, decoded.height), shown: Array<{ pixels: Uint8Array, duration: number }> = [];
            for await (const frame of decoded.frames) shown.push({ pixels: step(frame), duration: frame.duration });
            const frames = orient(profile(canvasFrames(decoded.width, decoded.height, shown), decoded.icc), decoded.orientation);
            const animation = new Animation(frames, { loopCount: fromPlays(decoded.plays), width: frames[0]?.width ?? decoded.width, height: frames[0]?.height ?? decoded.height });
            animation.__animationSignal__ = true;
            return animation;
        }

        if (type === 'jxl') {
            const frames: Frame[] = [];
            let loops = Infinity, animated = false, icc: Uint8Array | undefined, space: jxl.ColorSpace | undefined;
            let orientation = 1;
            for await (const decoded of jxl.frames(data, maxPixels, toneMapping, threads)) {
                const image = new Image(decoded.width, decoded.height);
                image.bitmap = alignedPixels(decoded.pixels);
                frames.push(new Frame(image, { duration: decoded.duration, disposalMode: 'background' }));
                // (all frames count, like those of the other formats)
                checkPixels(decoded.width, decoded.height, maxPixels, frames.length);
                orientation = decoded.orientation;
                loops = fromPlays(decoded.loopCount);
                animated ||= decoded.animated;
                icc = decoded.icc;
                space = decoded.colorSpace;
            }
            // (a gain map that can't be read leaves the frames without one, it doesn't fail the decoding)
            const map = gainMap && data[0] !== 0xff ? await jxl.decodeGainMap(data, maxPixels).catch(() => undefined) : undefined;
            if (map) for (const frame of frames) {
                const image = new Image(map.width, map.height);
                image.bitmap = map.pixels.slice();
                frame.image.gainMap = GainMap.__from_pixels__(image, map.params);
            }
            for (const frame of orient(profile(frames, icc, space), orientation)) {
                const mapOfFrame = frame.image.gainMap;
                if (!mapOfFrame || !applyOrientation || orientation <= 1) continue;
                try {
                    mapOfFrame.image = mapOfFrame.image.__orient__(orientation);
                } catch {
                    frame.image.gainMap = null;
                }
            }
            const animation = new Animation(frames, { loopCount: animated ? loops : Infinity, ...(frames.length ? { width: frames[0].width, height: frames[0].height } : {}) });
            animation.__animationSignal__ = animated;
            return animation;
        }

        if (type) {
            const image = await Image.decode(data, { maxPixels, applyOrientation, applyColorProfile, toneMapping, gainMap, threads });
            return new Animation([new Frame(image, { duration: 0 })], { width: image.width, height: image.height });
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
        const animation = new Animation(canvasFrames(decoded.width, decoded.height, frames), { loopCount: decoded.loopCount, width: decoded.width, height: decoded.height });
        animation.__animationSignal__ = decoded.hasLoopExtension;
        return animation;
    }
}

// a canvas size: positive integers
function canvasSize(width: number, height: number): [width: number, height: number] {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new RangeError(`Invalid canvas size: ${width}x${height}`);
    return [width, height];
}
