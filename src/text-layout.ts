import { oneOf } from './util/options.ts';

/** Where lines are wrapped: between words or at any character */
export type WrapStyle = 'word' | 'char';
/** Where the lines are placed horizontally: in the `width`, or (without one) relative to the widest line */
export type HorizontalAlign = 'left' | 'center' | 'right';
/** Where the text is placed vertically in the `height` (and which lines are kept when not all of them fit) */
export type VerticalAlign = 'top' | 'middle' | 'bottom';

/** The layout options of {@link Image.renderText} (part of {@link RenderTextOptions}): the size, wrapping and alignment */
export interface TextLayoutOptions {
    /**
     * The image's width in pixels: lines are wrapped to fit into it (inside the outline, see
     * {@link TextStyleOptions.strokeWidth}) and placed in it by `horizontalAlign`. Default: the widest line's width
     */
    width?: number;
    /**
     * The image's height in pixels: lines that don't fit are left out, and the text is placed in it by `verticalAlign`.
     * Default: the height of the lines
     */
    height?: number;
    /** Whether to wrap between words or at any character. Default: `'word'` */
    wrapStyle?: WrapStyle;
    /**
     * Where the lines are placed horizontally: `'left'`, `'center'` or `'right'` in the `width`, or (without one)
     * relative to the widest line. Default: `'left'`
     */
    horizontalAlign?: HorizontalAlign;
    /**
     * Where the text is placed vertically in the `height`: `'top'`, `'middle'` or `'bottom'`. When not all lines fit,
     * these keep the first, the middle or the last lines. Without a `height`, it has no effect. Default: `'top'`
     */
    verticalAlign?: VerticalAlign;
}

const HORIZONTAL: readonly string[] = ['left', 'center', 'right'];
const VERTICAL: readonly string[] = ['top', 'middle', 'bottom'];

/** A size option: undefined, or a whole number of pixels from 1 */
function boxSide(value: number | undefined, name: string): number | undefined {
    if (value === undefined) return undefined;
    const side = Math.floor(Number(value));
    if (typeof value !== 'number' || !(side >= 1) || !Number.isFinite(side)) throw new RangeError(`${name} must be a finite number from 1, not ${String(value)}`);
    return side;
}

/**
 * The layout options checked and with their defaults (internal: {@link Image.renderText} takes plain options)
 * @internal
 */
export class TextLayout {
    /** The width of the box the lines are wrapped to and aligned in, if any */
    width: number | undefined;
    /** The height of the box the lines are cut off at and aligned in, if any */
    height: number | undefined;
    /** Whether to wrap between words or at any character */
    wrapStyle: WrapStyle;
    /** Where the lines are placed horizontally */
    horizontalAlign: HorizontalAlign = 'left';
    /** Where the text is placed vertically */
    verticalAlign: VerticalAlign = 'top';

    /**
     * Creates a layout, missing options take their defaults
     * @param options See {@link TextLayoutOptions}
     */
    constructor(options: TextLayoutOptions = {}) {
        const { width, height, wrapStyle, verticalAlign, horizontalAlign } = options;
        this.width = boxSide(width, 'width');
        this.height = boxSide(height, 'height');

        this.wrapStyle = wrapStyle === undefined ? 'word' : oneOf(wrapStyle, ['word', 'char'], 'wrapStyle');

        if (horizontalAlign !== undefined) {
            if (!HORIZONTAL.includes(horizontalAlign)) throw new TypeError(`horizontalAlign must be 'left', 'center' or 'right', not '${horizontalAlign}'`);
            this.horizontalAlign = horizontalAlign;
        }
        if (verticalAlign !== undefined) {
            if (!VERTICAL.includes(verticalAlign)) throw new TypeError(`verticalAlign must be 'top', 'middle' or 'bottom', not '${verticalAlign}'`);
            this.verticalAlign = verticalAlign;
        }
    }
}
