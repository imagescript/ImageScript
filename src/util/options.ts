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
