import { finite, color as checkColor } from './util/options.ts';
import type { Color } from './image.ts';

/** Clamps and rounds a channel value to 0..255 */
export function channel(value: number): number {
    return value > 255 ? 255 : value > 0 ? Math.round(value) : 0;
}

// wraps a hue into 0..1 (negative hues included), exactly like (h % 1 + 1) % 1 but without the slow float modulo
export function wrapHue(h: number): number {
    const t = h - Math.trunc(h) + 1;
    return t < 1 ? t : t < 2 ? t - 1 : 0;
}

export function hue2rgb(p: number, q: number, t: number): number {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
}

/**
 * Converts an RGBA value to an array of HSLA values
 * @param r {number} (0..255)
 * @param g {number} (0..255)
 * @param b {number} (0..255)
 * @param a {number} (0..255)
 * @returns The HSLA values ([H, S, L, A])
 */
export function rgbaToHSLA(r: number, g: number, b: number, a: number): [h: number, s: number, l: number, a: number] {
    r = finite(r, 'red') / 255;
    g = finite(g, 'green') / 255;
    b = finite(b, 'blue') / 255;
    a = finite(a, 'alpha');

    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s: number;
    const l = (max + min) / 2;

    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r:
                h = (g - b) / d + (g < b ? 6 : 0);
                break;
            case g:
                h = (b - r) / d + 2;
                break;
            case b:
                h = (r - g) / d + 4;
                break;
        }

        h /= 6;
    }

    return [h, s, l, a / 255];
}

function gradientBetween(startColor: Color, endColor: Color): (position: number) => Color {
    const sr = startColor >>> 24, sg = startColor >> 16 & 0xff, sb = startColor >> 8 & 0xff, sa = startColor & 0xff;
    const er = (endColor >>> 24) - sr, eg = (endColor >> 16 & 0xff) - sg, eb = (endColor >> 8 & 0xff) - sb, ea = (endColor & 0xff) - sa;

    // opaque colors blend directly
    if (sa === 255 && ea === 0) return position => {
        const r = sr + position * er, g = sg + position * eg, b = sb + position * eb;
        return (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | 0xff) >>> 0;
    };

    // with transparency the colors blend premultiplied (like CSS does), so a color doesn't leak from what is invisible
    const pr = sr * sa / 255, pg = sg * sa / 255, pb = sb * sa / 255;
    const dr = (er + sr) * (ea + sa) / 255 - pr, dg = (eg + sg) * (ea + sa) / 255 - pg, db = (eb + sb) * (ea + sa) / 255 - pb;
    return position => {
        const a = sa + position * ea;
        if (a <= 0) return 0;
        const k = 255 / a;
        const r = Math.min(255, (pr + position * dr) * k + 1e-9), g = Math.min(255, (pg + position * dg) * k + 1e-9), b = Math.min(255, (pb + position * db) * k + 1e-9);
        return (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff)) >>> 0;
    };
}

/**
 * Conversions between RGBA, HSLA and the 32-bit color values ({@link Color}, `0xRRGGBBAA`) that the image methods take
 * and return, and gradients between colors
 */
export class Colors {
    private constructor() {}

    /**
     * Converts RGBA components to an RGBA value, values are rounded and clamped to 0..255
     * @param r red (0..255)
     * @param g green (0..255)
     * @param b blue (0..255)
     * @param a alpha (0..255)
     * @returns RGBA value
     */
    static fromRGBA(r: number, g: number, b: number, a: number): Color {
        r = finite(r, 'red');
        g = finite(g, 'green');
        b = finite(b, 'blue');
        a = finite(a, 'alpha');
        return (channel(r) << 24 | channel(g) << 16 | channel(b) << 8 | channel(a)) >>> 0;
    }

    /**
     * Converts RGB components to an RGBA value (assuming alpha = 255)
     * @param r red (0..255)
     * @param g green (0..255)
     * @param b blue (0..255)
     * @returns RGBA value
     */
    static fromRGB(r: number, g: number, b: number): Color {
        return Colors.fromRGBA(r, g, b, 0xff);
    }

    /**
     * Converts HSLA colors to RGBA colors
     * @param h hue in degrees (0..360, like CSS' `hsl()`: 0 red, 120 green, 240 blue; other values wrap around)
     * @param s saturation (0..1)
     * @param l lightness (0..1)
     * @param a opacity (0..1)
     * @returns color
     */
    static fromHSLA(h: number, s: number, l: number, a: number): Color {
        h = wrapHue(finite(h, 'hue') / 360);
        s = finite(s, 'saturation');
        l = finite(l, 'lightness');
        a = finite(a, 'alpha');
        s = Math.min(1, Math.max(0, s));
        l = Math.min(1, Math.max(0, l));
        a = Math.min(1, Math.max(0, a));

        let r: number, g: number, b: number;

        if (s === 0) {
            r = g = b = l;
        } else {
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;

            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }

        return Colors.fromRGBA(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), Math.round(a * 255));
    }

    /**
     * Converts HSL colors to RGBA colors (fully opaque)
     * @param h hue in degrees (0..360, like CSS' `hsl()`; other values wrap around)
     * @param s saturation (0..1)
     * @param l lightness (0..1)
     * @returns color
     */
    static fromHSL(h: number, s: number, l: number): Color {
        return Colors.fromHSLA(h, s, l, 1);
    }

    /**
     * Converts a color value to an array of RGBA values
     * @param color The color value to convert
     * @returns The RGBA values ([R, G, B, A])
     */
    static toRGBA(color: Color): [r: number, g: number, b: number, a: number] {
        color = checkColor(color);
        return [(color >> 24) & 0xff, (color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
    }

    /**
     * Converts a color value to an array of RGB values (ignoring the color's alpha)
     * @param color The color value to convert
     * @returns The RGB values ([R, G, B])
     */
    static toRGB(color: Color): [r: number, g: number, b: number] {
        const [r, g, b] = Colors.toRGBA(color);
        return [r, g, b];
    }

    /**
     * Converts a color to an array of HSLA values
     * @param color The color value to convert
     * @returns The HSLA values ([H, S, L, A]): H in degrees (0..360, like CSS' `hsl()`), S, L and A in 0..1
     */
    static toHSLA(color: Color): [h: number, s: number, l: number, a: number] {
        const [r, g, b, a] = Colors.toRGBA(color);
        const [h, s, l, alpha] = rgbaToHSLA(r, g, b, a);
        return [h * 360, s, l, alpha];
    }


    /**
     * Creates a multi-point gradient generator
     * @param stops The colors along the gradient: their positions (0..1) and colors (`{ 0: 0xff0000ff, 1: 0x00ff00ff }`),
     *     or just the colors, evenly spaced (`[0xff0000ff, 0x00ff00ff]`), like {@link GradientOptions.stops}
     * @return The gradient generator. The function argument is the position in the gradient (0..1).
     */
    static gradient(stops: Record<number, Color> | Color[]): (position: number) => Color {
        let colors: Record<number, Color>;
        if (Array.isArray(stops)) {
            if (!stops.length) throw new RangeError('Invalid gradient point count');
            // (one color is a gradient of two equal ones)
            const list = stops.length === 1 ? [stops[0], stops[0]] : stops;
            colors = Object.fromEntries(list.map((color, i) => [i / (list.length - 1), color]));
        } else colors = stops;
        const entries = Object.entries(colors).sort((a, b) => Number(a[0]) - Number(b[0]));
        const positions = entries.map(e => finite(parseFloat(e[0]), 'gradient position'));
        const values = entries.map(e => checkColor(e[1]));

        if (positions.length === 0) throw new RangeError('Invalid gradient point count');
        else if (positions.length === 1) {
            return position => {
                if (Number.isNaN(position)) throw new RangeError(`Invalid gradient position: ${position}`);
                return values[0];
            };
        } else if (positions.length === 2) {
            const gradient = gradientBetween(values[0], values[1]);
            return position => {
                if (Number.isNaN(position)) throw new RangeError(`Invalid gradient position: ${position}`);
                if (position <= positions[0]) return values[0];
                if (position >= positions[1]) return values[1];
                return gradient((position - positions[0]) / (positions[1] - positions[0]));
            };
        }

        const minDef = Math.min(...positions);
        const maxDef = Math.max(...positions);
        const gradients: Array<{ min: number, max: number, gradient: (position: number) => Color }> = [];

        for (let i = 0; i < positions.length; i++) {
            const minPos = positions[i - 1];
            if (minPos === undefined) continue;

            const maxPos = positions[i];
            // (two stops at the same position: a hard edge, nothing in between)
            if (maxPos === minPos) continue;

            let minVal = values[i - 1];
            if (minVal === undefined) minVal = values[i];

            const maxVal = values[i];
            const gradient = gradientBetween(minVal, maxVal);

            gradients.push({min: minPos, max: maxPos, gradient});
        }

        // (every stop at the same position: a hard edge between the first and the last color)
        if (!gradients.length) return position => {
            if (Number.isNaN(position)) throw new RangeError(`Invalid gradient position: ${position}`);
            return position <= minDef ? values[0] : values[values.length - 1];
        };

        return position => {
            if (position <= minDef) return gradients[0].gradient(0);
            if (position >= maxDef) return gradients[gradients.length - 1].gradient(1);

            for (const gradient of gradients)
                if (position >= gradient.min && position <= gradient.max)
                    return gradient.gradient((position - gradient.min) / (gradient.max - gradient.min));
            throw new RangeError(`Invalid gradient position: ${position}`);
        };
    }
}
