/** Whether an argument is an options object rather than a positional value */
export function isOptions<T>(value: T): value is Extract<T, object> {
    return typeof value === 'object' && value !== null && !ArrayBuffer.isView(value);
}

/**
 * Checks that the options argument of a method is left out or an object: anything else throws a TypeError instead of
 * being ignored silently, naming the form that works (`usage`, e.g. `cropCircle({ size: 'cover' })`)
 */
export function checkOptions(value: unknown, usage: string): void {
    if (value !== undefined && !isOptions(value)) throw new TypeError(`${usage.split('(')[0]}() takes an options object, like ${usage}, not ${value === null ? 'null' : typeof value}`);
}

/**
 * One of a fixed set of string values: anything else throws a TypeError naming the allowed ones, like
 * `mode must be 'a', 'b' or 'c', not d`
 */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
        const list = allowed.map(a => `'${a}'`);
        const expected = list.length > 1 ? `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}` : list[0];
        throw new TypeError(`${name} must be ${expected}, not ${typeof value === 'string' ? `'${value}'` : String(value)}`);
    }
    return value as T;
}

/**
 * A number argument, converted like arithmetic does (numeric strings keep working); NaN and the infinities throw
 * a RangeError naming the argument
 */
export function finite(value: number, name: string): number {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new RangeError(`Invalid ${name}: ${value}`);
    return number;
}

/**
 * A loop count: `Infinity` (loop forever) or an integer from 0 (0 plays once, 1 plays twice, ...). Anything else that is
 * a number throws a RangeError, anything that isn't one a TypeError
 */
export function loopCount(value: unknown, name = 'loop count'): number {
    if (typeof value !== 'number') throw new TypeError(`${name} must be a number (Infinity or an integer from 0), not ${value === null ? 'null' : typeof value}`);
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

/** A quality argument (0-100) of the encoders that take one, finite and in range */
export function quality(value: number, name = 'quality'): number {
    const q = finite(value, name);
    if (q < 0 || q > 100) throw new RangeError(`${name} must be 0-100, not ${q}`);
    return q;
}

/** A limit of pixels (`maxPixels`, ...): a number above 0, `Infinity` lifts it. Returns it as a number */
export function pixelLimit(value: number, name = 'maxPixels'): number {
    if (!(Number(value) > 0)) throw new RangeError(`${name} must be a positive number, not ${value}`);
    return Number(value);
}

/** The `threads` option: a whole number of at least 1 */
export function checkThreads(threads: number): void {
    if (!Number.isInteger(threads) || threads < 1) throw new RangeError(`threads must be a positive integer, not ${threads}`);
}

/** An effort argument: an integer from 0 to max */
export function effort(value: number, max: number): number {
    if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`effort must be an integer 0-${max}, not ${value}`);
    return value;
}

/** A zlib compression level (PNG's and APNG's): an integer from 0 to 9, like effort */
export function compressionLevel(value: number): number {
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
    if (!Number.isInteger(number) || number < -0x80000000 || number > 0xffffffff) throw new RangeError(`Invalid ${name}: ${value} (a color is an integer like 0xrrggbbaa)`);
    return number >>> 0;
}
