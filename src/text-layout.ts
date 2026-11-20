import { oneOf, pixels } from './util/options.ts';
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
     * {@link TextStyleOptions.strokeWidth}) and placed in it by `horizontalAlign`
     * @defaultValue The widest line's width
     */
    width?: number;
    /**
     * The image's height in pixels: lines that don't fit are left out, and the text is placed in it by `verticalAlign`.
     * @defaultValue The height of the lines
     */
    height?: number;
    /**
     * Whether to wrap between words or at any character
     * @defaultValue `'word'`
     */
    wrapStyle?: WrapStyle;
    /**
     * Where the lines are placed horizontally: `'left'`, `'center'` or `'right'` in the `width`, or (without one)
     * relative to the widest line
     * @defaultValue The paragraph's direction: `'left'` for left-to-right text, `'right'` for right-to-left text
     *     (Arabic, Hebrew, ...), like the `start` of CSS' `text-align`
     */
    horizontalAlign?: HorizontalAlign;
    /**
     * Where the text is placed vertically in the `height`: `'top'`, `'middle'` or `'bottom'`. When not all lines fit,
     * these keep the first, the middle or the last lines. Without a `height`, it has no effect
     * @defaultValue `'top'`
     */
    verticalAlign?: VerticalAlign;
}

const HORIZONTAL: readonly HorizontalAlign[] = ['left', 'center', 'right'];
const VERTICAL: readonly VerticalAlign[] = ['top', 'middle', 'bottom'];

/** A size option: undefined, or pixels (a fraction truncated, like the size of an image) */
function boxSide(value: number | undefined, name: string): number | undefined {
    return value === undefined ? undefined : pixels(value, name);
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
        horizontalAlign: horizontalAlign === undefined ? undefined : oneOf(horizontalAlign, HORIZONTAL, 'horizontalAlign'),
        verticalAlign: verticalAlign === undefined ? 'top' : oneOf(verticalAlign, VERTICAL, 'verticalAlign')
    };
}
