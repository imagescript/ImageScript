import { Image, ResizeOptions, ResizeToOptions, TrimOptions, RotateOptions, TransformOptions, ShadowOptions, OutlineOptions } from './image.ts';
import { checkOptions, finite } from './util/options.ts';

/**
 * What happens to a frame's area before the next frame is drawn, see {@link Frame.disposalMode}:
 * - `'keep'` (the default): the frame stays, the next one is drawn over it
 * - `'background'`: the frame's area is cleared to transparent
 * - `'previous'`: the frame's area goes back to what it was before the frame
 * - `'any'`: the decoder decides (in practice like `'keep'`)
 */
export type FrameDisposalMode = 'any' | 'keep' | 'previous' | 'background';

// the ids the library stores the modes as (0 any, 1 keep, 2 previous, 3 background, like GIFs)
type DisposalId = 0 | 1 | 2 | 3;

const DISPOSAL_MODES: readonly FrameDisposalMode[] = ['any', 'keep', 'previous', 'background'];

/** Options of {@link Frame} */
export interface FrameOptions {
    /** The frame's duration in milliseconds. Default: `100` */
    duration?: number;
    /** The frame's offset on the x-axis. Default: `0` */
    xOffset?: number;
    /** The frame's offset on the y-axis. Default: `0` */
    yOffset?: number;
    /** The frame's disposal mode, see {@link Frame.disposalMode}. Default: `'keep'` */
    disposalMode?: FrameDisposalMode;
}

/**
 * A frame of an {@link Animation}: an {@link Image} ({@link Frame.image}) with a duration, offsets and a disposal mode.
 * The frame has the methods that change the image's size (`resize()` including its `'contain'` and `'cover'` fit
 * modes, `scale()`, `crop()`, `trim()`, `rotate()`, `transform()`, `dropShadow()` and `outline()`), which move the
 * offsets along so the frame stays in place in the animation; every other change goes to the image
 * (`frame.image.blur(2)`). The image's own size-changing methods leave the offsets as they are. Offsets can become
 * negative: the parts of a frame outside the animation's canvas aren't encoded
 */
export class Frame {
    /** @internal @ignore */
    private __image__: Image;
    /** @internal @ignore */
    private __duration__ = 100;
    /** @internal @ignore */
    private __x__ = 0;
    /** @internal @ignore */
    private __y__ = 0;
    /**
     * @internal
     * @ignore
     */
    private __disposalMode__: DisposalId = 1;

    /**
     * @internal
     * @ignore
     */
    static __convert_disposal_mode__(mode: FrameDisposalMode): DisposalId {
        const id = DISPOSAL_MODES.indexOf(mode);
        if (id < 0)
            throw new RangeError('Invalid disposal mode');

        return id as DisposalId;
    }

    /**
     * Creates a frame of an image. The frame uses the image as it is (it isn't copied): changes to it are the frame's
     * @param image The frame's pixels
     * @param options See {@link FrameOptions}
     */
    constructor(image: Image, options?: FrameOptions);
    constructor(image: Image, options: FrameOptions = {}) {
        if (!(image instanceof Image)) throw new TypeError('A frame takes an Image, like new Frame(image, { duration: 100 })');
        checkOptions(options, 'Frame(image, { duration: 100 })');
        const { duration = 100, xOffset: x = 0, yOffset: y = 0, disposalMode: disposal = 'keep' } = options;
        this.__image__ = image;
        this.duration = duration;
        this.xOffset = x;
        this.yOffset = y;
        this.disposalMode = disposal;
    }

    /** The frame's pixels. Changing the image changes the frame; the offsets stay as they are */
    get image(): Image {
        return this.__image__;
    }

    /**
     * Replaces the frame's pixels
     * @param image The new image (used as it is, not copied)
     */
    set image(image: Image) {
        if (!(image instanceof Image)) throw new TypeError('A frame\'s image has to be an Image');
        this.__image__ = image;
    }

    /** The frame's width (its image's) */
    get width(): number {
        return this.__image__.width;
    }

    /** The frame's height (its image's) */
    get height(): number {
        return this.__image__.height;
    }

    /**
     * The frame's duration in milliseconds (a finite number from 0, else it throws a RangeError). GIFs store
     * hundredths of a second, so this is rounded to 10 ms when encoding a GIF; note that browsers play frames shorter
     * than 20 ms with 100 ms
     */
    get duration(): number {
        return this.__duration__;
    }

    /**
     * Sets the duration
     * @param duration Milliseconds, a finite number from 0
     */
    set duration(duration: number) {
        const value = finite(duration, 'frame duration');
        if (value < 0) throw new RangeError('Invalid frame duration');
        this.__duration__ = value;
    }

    /** The frame's horizontal offset in the animation (a finite number, else it throws a RangeError) */
    get xOffset(): number {
        return this.__x__;
    }

    /**
     * Sets the horizontal offset
     * @param x The offset in pixels
     */
    set xOffset(x: number) {
        this.__x__ = finite(x, 'x offset');
    }

    /** The frame's vertical offset in the animation (a finite number, else it throws a RangeError) */
    get yOffset(): number {
        return this.__y__;
    }

    /**
     * Sets the vertical offset
     * @param y The offset in pixels
     */
    set yOffset(y: number) {
        this.__y__ = finite(y, 'y offset');
    }

    /** The frame's disposal mode, see {@link FrameDisposalMode} */
    get disposalMode(): FrameDisposalMode {
        return DISPOSAL_MODES[this.__disposalMode__];
    }

    /**
     * The frame's disposal mode as id (0 any, 1 keep, 2 previous, 3 background)
     * @internal
     * @ignore
     */
    get __disposal_id__(): DisposalId {
        return this.__disposalMode__;
    }

    /**
     * Sets the disposal mode
     * @param disposalMode The mode's name (`'any'`, `'keep'`, `'previous'`, `'background'`)
     */
    set disposalMode(disposalMode: FrameDisposalMode) {
        this.__disposalMode__ = Frame.__convert_disposal_mode__(disposalMode);
    }

    /** A short description for debugging, e.g. `Frame<64x64x100ms>` */
    toString(): string {
        return `Frame<${this.width}x${this.height}x${this.duration}ms>`;
    }

    /** Clones the frame: its image (with its pixels and gain map), duration, offsets and disposal mode */
    clone(): Frame {
        return new Frame(this.__image__.clone(), { duration: this.duration, xOffset: this.xOffset, yOffset: this.yOffset, disposalMode: this.disposalMode });
    }

    /**
     * Runs a change of the image, moving the offsets the way the image reports its pixels moved
     * @internal
     * @ignore
     */
    private __tracked__(change: (image: Image) => unknown): this {
        const image = this.__image__;
        image.__moved__ = (scaleX, scaleY, x, y) => {
            this.xOffset = Math.round(this.xOffset * scaleX + x);
            this.yOffset = Math.round(this.yOffset * scaleY + y);
        };
        try {
            change(image);
        } finally {
            delete image.__moved__;
        }
        return this;
    }

    /**
     * Resizes the frame, scaling its offsets along with it (as if the whole animation was resized by the same factor)
     * @param width The new width
     * @param height The new height
     * @param options See {@link ResizeOptions}
     */
    resize(width: number, height: number, options?: ResizeOptions): this;
    /**
     * Resizes the frame, scaling its offsets along with it: to the given width or height (the other side keeps the
     * aspect ratio), or to both
     * @param options The size and how to resize, see {@link ResizeToOptions}
     */
    resize(options: ResizeToOptions): this;
    resize(widthOrOptions: number | ResizeToOptions, heightArgument?: number, optionsArgument?: ResizeOptions): this {
        return this.__tracked__(image => typeof widthOrOptions === 'number'
            ? image.resize(widthOrOptions, heightArgument as number, optionsArgument)
            : image.resize(widthOrOptions));
    }

    /**
     * Scales the frame by a factor, and its offsets along with it
     * @param factor The factor
     * @param options See {@link ResizeOptions}
     */
    scale(factor: number, options?: ResizeOptions): this {
        return this.__tracked__(image => image.scale(factor, options));
    }

    /**
     * Crops the frame to a region of it, moving the offsets so the remaining pixels stay where they are in the
     * animation. The region is clipped to the frame
     * @param x The x offset in the frame (0-based)
     * @param y The y offset in the frame (0-based)
     * @param width The new width
     * @param height The new height
     */
    crop(x: number, y: number, width: number, height: number): this {
        return this.__tracked__(image => image.crop(x, y, width, height));
    }

    /**
     * Removes borders of one color, moving the offsets so the remaining pixels stay where they are in the animation
     * @param options See {@link TrimOptions}
     */
    trim(options?: TrimOptions): this {
        return this.__tracked__(image => image.trim(options));
    }

    /**
     * Rotates the frame clockwise around its middle, like {@link Image.rotate}: when it grows (or shrinks), the
     * offsets move so its middle stays where it is in the animation
     * @param angle The angle in degrees, clockwise
     * @param options See {@link RotateOptions}
     */
    rotate(angle: number, options?: RotateOptions): this {
        return this.__tracked__(image => image.rotate(angle, options));
    }

    /**
     * Transforms the frame with an affine transform, like {@link Image.transform}: when it grows, the offsets move
     * so the transform's origin stays where it is in the animation
     * @param matrix The six values [a, b, c, d, e, f]
     * @param options See {@link TransformOptions}
     */
    transform(matrix: ArrayLike<number>, options?: TransformOptions): this {
        return this.__tracked__(image => image.transform(matrix, options));
    }

    /**
     * Adds a shadow behind the frame's image, like {@link Image.dropShadow}: when it grows up or left, the offsets
     * move so the image stays where it is in the animation
     * @param options See {@link ShadowOptions}
     */
    dropShadow(options?: ShadowOptions): this {
        return this.__tracked__(image => image.dropShadow(options));
    }

    /**
     * Draws an outline around the frame's shape, like {@link Image.outline}: when it grows up or left, the offsets
     * move so the image stays where it is in the animation
     * @param options See {@link OutlineOptions}
     */
    outline(options?: OutlineOptions): this {
        return this.__tracked__(image => image.outline(options));
    }
}
