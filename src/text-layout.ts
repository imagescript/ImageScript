import { oneOf } from './util/options.ts';
import type { Layout } from './render/text.ts';

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

const HORIZONTAL: readonly HorizontalAlign[] = ['left', 'center', 'right'];
const VERTICAL: readonly VerticalAlign[] = ['top', 'middle', 'bottom'];

/** A size option: undefined, or a whole number of pixels from 1 */
function boxSide(value: number | undefined, name: string): number | undefined {
    if (value === undefined) return undefined;
    const side = Math.floor(Number(value));
    if (typeof value !== 'number' || !(side >= 1) || !Number.isFinite(side)) throw new RangeError(`${name} must be a finite number from 1, not ${String(value)}`);
    return side;
}

/**
 * The layout options checked, with their defaults, for the text renderer
 * @internal
 */
export function textLayout(options: TextLayoutOptions): Layout {
    const { width, height, wrapStyle, verticalAlign, horizontalAlign } = options;
    return {
        width: boxSide(width, 'width'),
        height: boxSide(height, 'height'),
        wrapStyle: wrapStyle === undefined ? 'word' : oneOf(wrapStyle, ['word', 'char'], 'wrapStyle'),
        horizontalAlign: horizontalAlign === undefined ? 'left' : oneOf(horizontalAlign, HORIZONTAL, 'horizontalAlign'),
        verticalAlign: verticalAlign === undefined ? 'top' : oneOf(verticalAlign, VERTICAL, 'verticalAlign')
    };
}
