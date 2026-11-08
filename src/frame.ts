import { Image, ResizeMode, ResizeOptions, ResizeToOptions, Color, TrimOptions, resizeArguments } from './image.ts';
import { isOptions, finite } from './util/options.ts';

/** Names of the frame disposal modes, see {@link Frame.disposalMode} */
export type FrameDisposalModeName = 'any' | 'keep' | 'previous' | 'background';

// the ids the library stores the modes as (0 any, 1 keep, 2 previous, 3 background, like GIFs)
type DisposalId = 0 | 1 | 2 | 3;

const DISPOSAL_MODES: readonly FrameDisposalModeName[] = ['any', 'keep', 'previous', 'background'];

/** What happens to a frame's area before the next frame is drawn, see {@link Frame.disposalMode} */
export class FrameDisposalModes {
    /** The decoder decides (in practice like {@link FrameDisposalModes.KEEP}) */
    static readonly ANY = 'any';

    /** The frame stays, the next one is drawn over it (the default) */
    static readonly KEEP = 'keep';

    /** The frame's area goes back to what it was before the frame */
    static readonly PREVIOUS = 'previous';

    /** The frame's area is cleared to transparent */
    static readonly BACKGROUND = 'background';

    private constructor() {}
}

/** Options of {@link Frame} and {@link Frame.from} */
export interface FrameOptions {
    /** The frame's duration in milliseconds. Default: `100` */
    duration?: number;
    /** The frame's offset on the x-axis. Default: `0` */
    xOffset?: number;
    /** The frame's offset on the y-axis. Default: `0` */
    yOffset?: number;
    /** The frame's disposal mode, see {@link Frame.disposalMode}. Default: `'keep'` */
    disposalMode?: FrameDisposalModeName;
}

/**
 * Represents a frame of an {@link Animation}: an {@link Image} with a duration, offsets and a disposal mode, so every
 * method of {@link Image} works on it too
 */
export class Frame extends Image {
    /**
     * Milliseconds. GIFs store hundredths of a second, so this is rounded to 10 ms when encoding a GIF;
     * note that browsers play frames shorter than 20 ms with 100 ms
     */
    duration: number;
    /** The frame's horizontal offset in the animation */
    xOffset: number;
    /** The frame's vertical offset in the animation */
    yOffset: number;
    /**
     * @internal
     * @ignore
     */
    private __disposalMode__: DisposalId = 1;

    /**
     * @internal
     * @ignore
     */
    static __convert_disposal_mode__(mode: FrameDisposalModeName): DisposalId {
        const id = DISPOSAL_MODES.indexOf(mode);
        if (id < 0)
            throw new RangeError('Invalid disposal mode');

        return id as DisposalId;
    }

    /**
     * Creates a new, blank frame
     * @param width The width in pixels
     * @param height The height in pixels
     * @param options See {@link FrameOptions}
     */
    constructor(width: number, height: number, options?: FrameOptions);
    /**
     * Creates a new, blank frame
     * @param width The width in pixels
     * @param height The height in pixels
     * @param duration The frame's duration (in ms)
     * @param xOffset The frame's offset on the x-axis
     * @param yOffset The frame's offset on the y-axis
     * @param disposalMode The frame's disposal mode
     * @deprecated Pass {@link FrameOptions} instead, the positional arguments will be removed in 4.0
     */
    constructor(width: number, height: number, duration?: number, xOffset?: number, yOffset?: number, disposalMode?: FrameDisposalModeName);
    constructor(width: number, height: number, durationOrOptions?: number | FrameOptions, xOffset?: number, yOffset?: number, disposalMode?: FrameDisposalModeName) {
        const { duration = 100, xOffset: x = 0, yOffset: y = 0, disposalMode: disposal = FrameDisposalModes.KEEP } =
            isOptions(durationOrOptions) ? durationOrOptions : { duration: durationOrOptions, xOffset, yOffset, disposalMode };
        if (finite(duration, 'frame duration') < 0)
            throw new RangeError('Invalid frame duration');
        finite(x, 'x offset');
        finite(y, 'y offset');

        super(width, height);
        this.duration = duration;
        this.xOffset = x;
        this.yOffset = y;
        this.disposalMode = disposal;
    }

    /** The frame's disposal mode (`'any'`, `'keep'`, `'previous'` or `'background'`) */
    get disposalMode(): FrameDisposalModeName {
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
    set disposalMode(disposalMode: FrameDisposalModeName) {
        this.__disposalMode__ = Frame.__convert_disposal_mode__(disposalMode);
    }

    /** A short description for debugging, e.g. `Frame<64x64x100ms>` */
    override toString(): string {
        return `Frame<${this.width}x${this.height}x${this.duration}ms>`;
    }

    /**
     * Converts an Image instance to a Frame, cloning it in the process
     * @param image The image to create the frame from
     * @param options See {@link FrameOptions}
     */
    static from(image: Image, options?: FrameOptions): Frame;
    /**
     * Converts an Image instance to a Frame, cloning it in the process
     * @param image The image to create the frame from
     * @param duration The frame's duration (in ms)
     * @param xOffset The frame's offset on the x-axis
     * @param yOffset The frame's offset on the y-axis
     * @param disposalMode The frame's disposal mode
     * @deprecated Pass {@link FrameOptions} instead, the positional arguments will be removed in 4.0
     */
    static from(image: Image, duration?: number, xOffset?: number, yOffset?: number, disposalMode?: FrameDisposalModeName): Frame;
    static from(image: Image, durationOrOptions?: number | FrameOptions, xOffset?: number, yOffset?: number, disposalMode?: FrameDisposalModeName): Frame {
        if (!(image instanceof Image))
            throw new TypeError('Invalid image passed');

        const options = isOptions(durationOrOptions) ? durationOrOptions : { duration: durationOrOptions, xOffset, yOffset, disposalMode };
        const frame = new Frame(image.width, image.height, options);
        frame.bitmap.set(image.bitmap);

        return frame;
    }

    /**
     * Clones the frame, including its duration, offsets and disposal mode
     */
    override clone(): Frame {
        return Frame.from(this, { duration: this.duration, xOffset: this.xOffset, yOffset: this.yOffset, disposalMode: this.disposalMode });
    }

    /**
     * @internal
     * @ignore
     */
    protected override __room__(): { left: number, top: number } {
        return { left: this.xOffset, top: this.yOffset };
    }

    /**
     * @internal
     * @ignore
     */
    protected override __grown__(left: number, top: number): void {
        this.xOffset -= left;
        this.yOffset -= top;
    }

    /**
     * Removes borders of one color, moving the frame's offsets so the remaining pixels stay in place
     * @param options See {@link TrimOptions}
     */
    override trim(options?: TrimOptions): this;
    /**
     * Removes borders of one color, moving the frame's offsets so the remaining pixels stay in place
     * @param color The border color, by default the color of the top left pixel
     * @param options See {@link TrimOptions}
     * @deprecated Pass {@link TrimOptions} instead, the positional arguments will be removed in 4.0
     */
    override trim(color?: Color, options?: TrimOptions): this;
    override trim(colorOrOptions?: Color | TrimOptions, optionsArgument: TrimOptions = {}): this {
        const { color, ...options } = isOptions(colorOrOptions) ? colorOrOptions : { ...optionsArgument, color: colorOrOptions ?? optionsArgument.color };
        const bounds = this.__trim_bounds__(color, options);
        if (!bounds) return this;
        this.xOffset += bounds[0];
        this.yOffset += bounds[1];
        return this.__apply__(this.__crop__(...bounds));
    }

    /**
     * Resizes the frame, scaling its offsets along with it.
     * Pass {@link ResizeToOptions} with only a width or a height to keep the aspect ratio.
     * @param width The new width
     * @param height The new height
     * @param options See {@link ResizeOptions}
     */
    override resize(width: number, height: number, options?: ResizeOptions): this;
    /**
     * Resizes the frame, scaling its offsets along with it.
     * @param width The new width
     * @param height The new height
     * @param mode The resizing mode (default: {@link ResizeModes.BILINEAR})
     * @deprecated Pass {@link ResizeOptions} with `mode` instead, the positional mode will be removed in 4.0
     */
    override resize(width: number, height: number, mode?: ResizeMode): this;
    /**
     * Resizes the frame, scaling its offsets along with it: to the given width or height (the other side keeps the
     * aspect ratio), or to both
     * @param options The size and how to resize, see {@link ResizeToOptions}
     */
    override resize(options: ResizeToOptions): this;
    override resize(widthOrOptions: number | ResizeToOptions, heightArgument?: number, modeArgument?: ResizeMode | ResizeOptions): this {
        const [width, height, modeOrOptions] = resizeArguments(widthOrOptions, heightArgument, modeArgument);
        const originalWidth = this.width;
        const originalHeight = this.height;

        super.resize(...this.__resized_size__(width, height), modeOrOptions as ResizeMode);

        this.xOffset = Math.round(this.xOffset * this.width / originalWidth);
        this.yOffset = Math.round(this.yOffset * this.height / originalHeight);

        return this;
    }

    /**
     * Scales the offsets like {@link Frame.resize} for a resize to the given size (that only produces a part of it)
     * @internal
     * @ignore
     */
    protected override __rescaled__(width: number, height: number): void {
        this.xOffset = Math.round(this.xOffset * width / this.width);
        this.yOffset = Math.round(this.yOffset * height / this.height);
    }
}
