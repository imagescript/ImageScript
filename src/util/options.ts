/** Whether an argument is an options object rather than a positional value */
export function isOptions<T>(value: T): value is Extract<T, object> {
    return typeof value === 'object' && value !== null && !ArrayBuffer.isView(value);
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

// the largest finite loop count each format stores: GIF 16 bits of repeats, WebP 16 bits of plays (count + 1), APNG 31
// bits of plays
const LOOP_LIMITS = { GIF: 65535, WebP: 65534, APNG: 2 ** 31 - 2 };

/**
 * Checks that a finite loop count fits the format's field (a larger one used to wrap around, e.g. to 0, which plays
 * forever): throws a RangeError naming the format's largest count. Forever (-1 or Infinity) always fits
 */
export function fitLoops(loopCount: number, format: keyof typeof LOOP_LIMITS): number {
    if (loopCount !== Infinity && loopCount > LOOP_LIMITS[format])
        throw new RangeError(`${format} stores loop counts up to ${LOOP_LIMITS[format]} (or Infinity to loop forever), not ${loopCount}`);
    return loopCount;
}
