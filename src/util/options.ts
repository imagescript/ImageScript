/** Whether an argument is an options object rather than a positional value */
export function isOptions<T>(value: T): value is Extract<T, object> {
    return typeof value === 'object' && value !== null && !ArrayBuffer.isView(value);
}

/**
 * Checks that the options argument of a method is left out or an object. A method that only takes options (4.0 removed
 * the positional forms) throws a TypeError for anything else instead of silently ignoring it, which names the form that
 * works: `usage` is e.g. `cropCircle({ size: 'cover' })`
 */
export function checkOptions(value: unknown, usage: string): void {
    if (value !== undefined && !isOptions(value)) throw new TypeError(`${usage.split('(')[0]}() takes an options object, like ${usage}, not ${value === null ? 'null' : typeof value}`);
}

/**
 * The channel methods take a factor only: 3.x's `absolute` argument, a second one, would be a silent scale now, so more
 * than one argument throws (before the image is touched). `method` is the name of the method
 */
export function checkFactorOnly(method: string, count: number): void {
    if (count > 1) throw new TypeError(`channel methods reject the removed absolute argument: use ${method}(factor) to scale, or recolor() for a fixed color`);
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
 * a number throws a RangeError (`-1`, which 3.x meant as forever, says so), anything that isn't one a TypeError
 */
export function loopCount(value: unknown, name = 'loop count'): number {
    if (typeof value !== 'number') throw new TypeError(`${name} must be a number (Infinity or an integer from 0), not ${value === null ? 'null' : typeof value}`);
    if (value !== Infinity && (!Number.isInteger(value) || value < 0))
        throw new RangeError(`${name} must be Infinity or an integer from 0, not ${value}${value === -1 ? ' (use Infinity to loop forever)' : ''}`);
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

/** A quality argument (0-100) of the encoders that take one, finite and in range */
export function quality(value: number, name = 'quality'): number {
    const q = finite(value, name);
    if (q < 0 || q > 100) throw new RangeError(`${name} must be 0-100, not ${q}`);
    return q;
}

/** An effort argument: an integer from 0 to max */
export function effort(value: number, max: number): number {
    if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`effort must be an integer 0-${max}, not ${value}`);
    return value;
}

/** A zlib compression level: finite, clamped to 0-9 and truncated (PNG's and APNG's) */
export const compressionLevel = (value: number): number => Math.min(9, Math.max(0, ~~finite(value, 'compression level')));

/** A color argument: a finite number (as RGBA, 0xrrggbbaa) */
export const color = (value: number, name = 'color'): number => finite(value, name);
