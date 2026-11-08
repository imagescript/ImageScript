import { checkOptions } from './util/options.ts';

/** Where lines are wrapped: between words or at any character */
export type WrapStyle = 'word' | 'char';
/** Alignment of the lines relative to the widest line */
export type HorizontalAlign = 'left' | 'center' | 'right';
/** Which lines to keep when the text is cut off at `maxHeight` */
export type VerticalAlign = 'top' | 'middle' | 'bottom';

/** The text layout of {@link Image.renderText}: wrapping, cutting off and alignment */
export interface TextLayoutOptions {
    /** Longer lines are wrapped. Default: `Infinity` */
    maxWidth?: number;
    /** Lines that don't fit are cut off. Default: `Infinity` */
    maxHeight?: number;
    /** Whether to wrap between words or at any character. Default: `'word'` */
    wrapStyle?: WrapStyle;
    /** Alignment of the lines relative to the widest line: `'left'`, `'center'` or `'right'`. Default: `'left'` */
    horizontalAlign?: HorizontalAlign;
    /** Which lines to keep when cutting off at `maxHeight`: `'top'`, `'middle'` or `'bottom'`. Default: `'top'` */
    verticalAlign?: VerticalAlign;
    /** Whether to break lines at newline characters. Default: `true` */
    wrapHardBreaks?: boolean;
}

const HORIZONTAL: readonly string[] = ['left', 'center', 'right'];
const VERTICAL: readonly string[] = ['top', 'middle', 'bottom'];

/**
 * The layout options checked and with their defaults (internal: {@link Image.renderText} takes plain options)
 * @internal
 */
export class TextLayout {
    /** Longer lines are wrapped */
    maxWidth: number;
    /** Lines that don't fit are cut off */
    maxHeight: number;
    /** Whether to wrap between words or at any character */
    wrapStyle: WrapStyle;
    /** Alignment of the lines relative to the widest line */
    horizontalAlign: HorizontalAlign = 'left';
    /** Which lines to keep when cutting off at `maxHeight` */
    verticalAlign: VerticalAlign = 'top';
    /** Whether to break lines at newline characters */
    wrapHardBreaks: boolean;

    /**
     * Creates a layout, missing options take their defaults
     * @param options See {@link TextLayoutOptions}
     */
    constructor(options: TextLayoutOptions = {}) {
        checkOptions(options, 'renderText(text, { font, size, layout: { maxWidth: 300 } })');
        const { maxWidth, maxHeight, wrapStyle, verticalAlign, horizontalAlign, wrapHardBreaks } = options;

        // (undefined and 0 mean no limit, NaN is invalid)
        this.maxWidth = maxWidth === undefined || maxWidth === 0 ? Infinity : Number(maxWidth);
        if (isNaN(this.maxWidth) || this.maxWidth < 1)
            throw new RangeError('Invalid maxWidth');

        this.maxHeight = maxHeight === undefined || maxHeight === 0 ? Infinity : Number(maxHeight);
        if (isNaN(this.maxHeight) || this.maxHeight < 1)
            throw new RangeError('Invalid maxHeight');

        this.wrapStyle = wrapStyle || 'word';
        if (!['word', 'char'].includes(this.wrapStyle))
            throw new RangeError('Invalid wrapStyle');

        if (horizontalAlign !== undefined) {
            if (!HORIZONTAL.includes(horizontalAlign)) throw new TypeError(`text alignments only take the values of their own axis: horizontalAlign takes 'left', 'center' or 'right', not '${horizontalAlign}'`);
            this.horizontalAlign = horizontalAlign;
        }
        if (verticalAlign !== undefined) {
            if (!VERTICAL.includes(verticalAlign)) throw new TypeError(`text alignments only take the values of their own axis: verticalAlign takes 'top', 'middle' or 'bottom', not '${verticalAlign}'`);
            this.verticalAlign = verticalAlign;
        }

        this.wrapHardBreaks = typeof wrapHardBreaks === 'undefined' ? true : wrapHardBreaks;
        if (typeof this.wrapHardBreaks !== 'boolean')
            throw new TypeError('Invalid wrapHardBreaks');
    }
}
