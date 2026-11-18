/** How a wrong value is named in an error: 'null', 'an array', 'an object', a quoted string, or its type */
export function shown(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'an array';
    if (typeof value === 'string') return `'${value}'`;
    if (typeof value === 'number') return String(value);
    if (typeof value === 'object') return 'an object';
    return typeof value;
}

/** Whether an argument is an options object rather than a positional value */
export function isOptions<T>(value: T): value is Extract<T, object> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && !ArrayBuffer.isView(value);
}

/**
 * Checks that the options argument of a method is left out or an object: anything else throws a TypeError instead of
 * being ignored silently, naming the form that works (`usage`, e.g. `cropCircle({ fit: 'cover' })`)
 */
export function checkOptions(value: unknown, usage: string): void {
    if (value !== undefined && !isOptions(value)) throw new TypeError(`${usage.split('(')[0]}() takes an options object, like ${usage}, not ${shown(value)}`);
}

/**
 * One of a fixed set of string values: anything else throws a TypeError naming the allowed ones, like
 * `mode must be 'a', 'b' or 'c', not d`
 */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
        const list = allowed.map(a => `'${a}'`);
        const expected = list.length > 1 ? `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}` : list[0];
        throw new TypeError(`${name} must be ${expected}, not ${shown(value)}`);
    }
    return value as T;
}

/** A boolean option (`optimize`, `hinting`, ...): anything else, strings like `'yes'` included, throws a TypeError */
export function boolean(value: unknown, name: string): boolean {
    if (typeof value !== 'boolean') throw new TypeError(`${name} must be true or false, not ${shown(value)}`);
    return value;
}

/** Throws a TypeError naming the argument unless it is a number (NaN and the infinities are numbers) */
export function checkNumber(value: unknown, name: string): void {
    if (typeof value !== 'number') throw new TypeError(`${name} must be a number, not ${shown(value)}`);
}

/**
 * A number argument: anything that isn't a number (a numeric string included) throws a TypeError, NaN and the
 * infinities a RangeError, both naming the argument
 */
export function finite(value: number, name: string): number {
    checkNumber(value, name);
    if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite, not ${value}`);
    return value;
}

/** A number that may be infinite (the ends of a range), but not NaN: NaN throws a RangeError naming the argument */
export function notNaN(value: number, name: string): number {
    checkNumber(value, name);
    if (Number.isNaN(value)) throw new RangeError(`${name} must be a number, not NaN`);
    return value;
}

/** A number of `min` or more, finite: a smaller one throws a RangeError naming the argument */
export function atLeast(value: number, min: number, name: string): number {
    finite(value, name);
    if (value < min) throw new RangeError(`${name} must be ${min} or more, not ${value}`);
    return value;
}

/** The size of an animation's canvas, like that of an image: pixels, fractions truncated */
export function canvasSize(width: number, height: number): [width: number, height: number] {
    return [pixels(width, 'width'), pixels(height, 'height')];
}

/**
 * Allocates the pixels of `width`x`height` (`make`), else a RangeError that names the size: the engine's own message
 * ("Array buffer allocation failed", "Invalid typed array length") names neither
 */
export function allocate<T>(width: number, height: number, make: () => T): T {
    try {
        return make();
    } catch (err) {
        throw new RangeError(`An image of ${width}x${height} pixels (${BigInt(width) * BigInt(height) * 4n} bytes) can't be allocated`, { cause: err });
    }
}

/**
 * A loop count: `Infinity` (loop forever) or an integer from 0 (0 plays once, 1 plays twice, ...). Anything else that is
 * a number throws a RangeError, anything that isn't one a TypeError
 */
export function loopCount(value: unknown, name = 'loop count'): number {
    if (typeof value !== 'number') throw new TypeError(`${name} must be a number (Infinity or an integer from 0), not ${shown(value)}`);
    if (value !== Infinity && (!Number.isInteger(value) || value < 0))
        throw new RangeError(`${name} must be Infinity or an integer from 0, not ${value}`);
    return value;
}

/**
 * The plays of an APNG or WebP header for a loop count: they count plays, so a loop count is one less (0 = forever,
 * for Infinity)
 */
export const toPlays = (count: number): number => count === Infinity ? 0 : count + 1;

/** The loop count of a plays field (0 = forever, which is Infinity), the inverse of {@link toPlays} */
export const fromPlays = (plays: number): number => plays === 0 ? Infinity : plays - 1;

/** The largest finite loop count each format stores: GIF 16 bits, WebP 16 bits of plays, APNG 31 bits of plays */
const LOOP_LIMITS = { GIF: 65535, WebP: 65534, APNG: 2 ** 31 - 2 };

/**
 * A loop count for a format's header: `Infinity` always fits, a finite count above the format's limit would wrap
 * silently (65536 stored as 0 is forever), so it throws a RangeError
 */
export function fitLoops(count: number, format: keyof typeof LOOP_LIMITS): number {
    const max = LOOP_LIMITS[format];
    if (count !== Infinity && count > max) throw new RangeError(`refuse loop counts that don't fit the format: ${format} loop counts go up to ${max}, not ${count}`);
    return count;
}

/**
 * The longest frame duration each format stores, in milliseconds: GIF 16 bits of centiseconds, APNG 16 bits of
 * centiseconds (16 bits of milliseconds below that), WebP 24 bits of milliseconds
 */
const DURATION_LIMITS = { GIF: 655350, APNG: 655350, WebP: 0xffffff };

/** The longest frame duration a format stores (in milliseconds), see {@link fitDuration} */
export const maxDuration = (format: keyof typeof DURATION_LIMITS): number => DURATION_LIMITS[format];

/**
 * A frame duration for a format's frames: a duration above the format's limit would be cut silently, so it throws a
 * RangeError, like {@link fitLoops}
 */
export function fitDuration(duration: number, format: keyof typeof DURATION_LIMITS): number {
    const max = DURATION_LIMITS[format];
    if (duration > max) throw new RangeError(`refuse frame durations that don't fit the format: ${format} frames last up to ${max} ms, not ${duration}`);
    return duration;
}

/** A number of 0 or more, finite: a negative one throws a RangeError naming the argument */
/** An instance of one of the classes `types` (an Image, a Frame, ...), else a TypeError naming the argument and the value */
export function instance(value: unknown, types: Array<abstract new (...args: never[]) => unknown>, name: string): void {
    if (!types.some(type => value instanceof type)) throw new TypeError(`${name} must be ${types.map(type => `a ${type.name}`).join(' or ')}, not ${shown(value)}`);
}

/**
 * A scale factor of an image or animation of `width`x`height`: above 0, and small enough for the sides it gives
 * (at most 2147483647 pixels), else a RangeError naming the factor
 */
export function scaleFactor(factor: number, width: number, height: number): number {
    positive(factor, 'scale factor');
    const largest = Math.floor(0x7fffffff / Math.max(width, height));
    if (Math.max(width, height) * factor >= 0x7fffffff + 0.5) throw new RangeError(`scale factor must be at most ${largest} for an image of ${width}x${height}, not ${factor}`);
    return factor;
}

export function nonNegative(value: number, name: string): number {
    finite(value, name);
    if (value < 0) throw new RangeError(`${name} must be 0 or more, not ${value}`);
    return value;
}

/** A color channel from 0 to 255 once rounded to a whole number (255.4 is fine, 255.5 isn't): one outside of it throws a RangeError naming the channel */
export function byte(value: number, name: string): number {
    finite(value, name);
    const rounded = Math.round(value);
    if (rounded < 0 || rounded > 255) throw new RangeError(`${name} must be 0-255, not ${value}`);
    return rounded;
}

/**
 * A size in pixels: a number from 1 (a fraction is truncated, like the size of an image), up to what an image can have.
 * Anything else throws a RangeError naming the argument and the value given
 */
export function pixels(value: number, name: string): number {
    finite(value, name);
    const whole = Math.trunc(value);
    if (whole < 1 || whole > 0x7fffffff) throw new RangeError(`${name} must be 1-2147483647, not ${value}`);
    return whole;
}

/** A pixel coordinate: a number from 0 to `last` (the coordinate of the last pixel), else a RangeError naming the coordinate */
export function coordinate(value: number, last: number, name: string): number {
    if (!(value >= 0 && value <= last)) throw new RangeError(`${name} must be 0-${last}, not ${value}`);
    return value;
}

/**
 * A crop region clipped to a `width` by `height` image or canvas, as [x, y, width, height]: fractions are truncated, a
 * region that doesn't overlap it throws a RangeError naming the region as given
 */
export function cropBounds(width: number, height: number, x: number, y: number, regionWidth: number, regionHeight: number, what: string): [number, number, number, number] {
    const rx = Math.trunc(finite(x, 'x')), ry = Math.trunc(finite(y, 'y'));
    const rw = Math.trunc(finite(regionWidth, 'width')), rh = Math.trunc(finite(regionHeight, 'height'));
    const left = Math.max(0, rx), top = Math.max(0, ry);
    const right = Math.min(width, rx + rw), bottom = Math.min(height, ry + rh);
    if (right <= left || bottom <= top) throw new RangeError(`crop region must be partly inside the ${width}x${height} ${what}, not ${regionWidth}x${regionHeight} at ${x},${y}`);
    return [left, top, right - left, bottom - top];
}

/** A number from 0 to 1, finite: a number outside of it throws a RangeError naming the argument */
export function unitInterval(value: number, name: string): number {
    finite(value, name);
    if (value < 0 || value > 1) throw new RangeError(`${name} must be 0-1, not ${value}`);
    return value;
}

/** A number above 0, finite: 0 and negative ones throw a RangeError naming the argument */
export function positive(value: number, name: string): number {
    finite(value, name);
    if (!(value > 0)) throw new RangeError(`${name} must be above 0, not ${value}`);
    return value;
}

/** A quality argument (0-100) of the encoders that take one, finite and in range */
export function quality(value: number, name = 'quality'): number {
    const q = finite(value, name);
    if (q < 0 || q > 100) throw new RangeError(`${name} must be 0-100, not ${q}`);
    return q;
}

/** A limit of pixels (`maxPixels`, ...): a number above 0, `Infinity` lifts it. Returns it as a number */
export function pixelLimit(value: number, name = 'maxPixels'): number {
    checkNumber(value, name);
    if (!(value > 0)) throw new RangeError(`${name} must be a positive number, not ${value}`);
    return value;
}

/**
 * The `gainMap` option of the encoders that embed one: `true`, `false` or an object with the map's `quality` (1-100)
 * and `scale`; anything else throws a TypeError. Returns the options, null for `false`
 */
export function gainMapEmbed(value: unknown): { quality?: number, scale?: number } | null {
    if (value === false) return null;
    if (value === true) return {};
    if (typeof value !== 'object' || value === null) throw new TypeError(`gainMap must be true, false or an options object like { quality: 90, scale: 0.5 }, not ${shown(value)}`);
    const { quality: q, scale } = value as { quality?: unknown, scale?: unknown };
    const options: { quality?: number, scale?: number } = {};
    if (q !== undefined) options.quality = quality(q as number, 'gain map quality');
    if (scale !== undefined) options.scale = gainMapScale(scale as number);
    return options;
}

/** The `scale` of a gain map: above 0 and at most 1 (1 is the size of the image) */
export function gainMapScale(value: number): number {
    const scale = finite(value, 'gain map scale');
    if (!(scale > 0 && scale <= 1)) throw new RangeError(`The gain map scale must be above 0 and at most 1, not ${scale}`);
    return scale;
}

/** The `threads` option: a whole number of at least 1 */
export function checkThreads(threads: number): void {
    checkNumber(threads, 'threads');
    if (!Number.isInteger(threads) || threads < 1) throw new RangeError(`threads must be a positive integer, not ${threads}`);
}

/** An effort argument: an integer from 0 to max */
export function effort(value: number, max: number): number {
    checkNumber(value, 'effort');
    if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`effort must be an integer 0-${max}, not ${value}`);
    return value;
}

/** A zlib compression level (PNG's and APNG's): an integer from 0 to 9, like effort */
export function compressionLevel(value: number): number {
    checkNumber(value, 'compression level');
    if (!Number.isInteger(value) || value < 0 || value > 9) throw new RangeError(`compression level must be an integer 0-9, not ${value}`);
    return value;
}

/**
 * A color argument (RGBA, 0xrrggbbaa) as an unsigned 32-bit integer. Signed 32-bit integers are accepted too, they're
 * what bitwise operators return (`r << 24 | g << 16 | b << 8 | a` is negative for red above 127); anything else that
 * isn't an integer from -2^31 to 2^32 - 1 throws a RangeError instead of wrapping around
 */
export function color(value: number, name = 'color'): number {
    const number = finite(value, name);
    if (!Number.isInteger(number) || number < -0x80000000 || number > 0xffffffff) throw new RangeError(`${name} must be an integer from -2147483648 to 4294967295, like 0xrrggbbaa, not ${value}`);
    return number >>> 0;
}
