// limits against decompression bombs: small files declaring huge images

/**
 * Thrown when an image exceeds a limit of the decode options (`maxPixels`) or the render options of SVGs
 * @hideconstructor
 */
export class LimitError extends RangeError {
    /** `'LimitError'`: tells a limit apart from other `RangeError`s */
    override name = 'LimitError';
}

/** The default of the decode options' maxPixels: 16383 squared (like sharp's limitInputPixels) */
export const MAX_PIXELS = 0x3fff * 0x3fff;

/**
 * What a frame of an animation counts at least: a frame takes memory however small it is (200000 frames of 1x1, a
 * 4.6 MB GIF, took 720 MB), so the limit bounds the memory of tiny frames too
 */
export const FRAME_PIXELS = 1024;

/**
 * Throws if decoding an image of the given size would exceed the limit, before anything that size is allocated
 * @param count the number of such images (frames of an animation, each counting at least {@link FRAME_PIXELS})
 */
export function checkPixels(width: number, height: number, limit: number, count = 1): void {
    const floor = count > 1 && width * height < FRAME_PIXELS;
    if (!((floor ? FRAME_PIXELS : width * height) * count <= limit))
        throw new LimitError(`Image too large: ${count > 1 ? `${count} frames of ` : ''}${width}x${height} pixels exceed the limit of ${limit}${floor ? ` (each frame counts at least ${FRAME_PIXELS})` : ''} (the decode options' maxPixels)`);
}

/**
 * Throws a {@link LimitError} naming the operation if an image it makes would have more pixels than an image can
 * (the default `maxPixels` of the decoders): a shadow or outline of a huge size or offset would only fail allocating
 */
export function checkGrowth(width: number, height: number, what: string): void {
    if (!(width * height <= MAX_PIXELS))
        throw new LimitError(`${what} would make the image ${width}x${height} pixels, more than the limit of ${MAX_PIXELS}`);
}

/** The most bytes of raw samples per pixel of the limit (4 samples of 16 bits) */
export const MAX_BYTES_PER_PIXEL = 8;

/**
 * Throws if an image's raw samples (bytes) would exceed what the pixel limit allows, for formats with any number of
 * samples per pixel
 */
export function checkBytes(bytes: number, limit: number): void {
    if (!(bytes <= limit * MAX_BYTES_PER_PIXEL))
        throw new LimitError(`Image too large: ${bytes} bytes of samples exceed what the limit of ${limit} pixels allows (the decode options' maxPixels)`);
}

/** Counts the pixels of decoded frames against a limit, each frame at least `floor` ({@link FRAME_PIXELS} for animations) */
export class PixelBudget {
    private left: number;
    private limit: number;
    private count = 0;
    private first = 0;

    constructor(limit: number, private readonly floor = 0) {
        this.limit = this.left = limit;
    }

    /** Throws if another frame of the given size would exceed the limit */
    take(width: number, height: number): void {
        const pixels = width * height;
        // (the floor counts from the second frame, for the first one too: a single frame is its pixels, like in
        // checkPixels)
        if (++this.count === 1) this.first = pixels;
        else if (this.count === 2) this.left -= Math.max(0, this.floor - this.first);
        this.left -= this.count === 1 ? pixels : Math.max(pixels, this.floor);
        if (!(this.left >= 0)) throw new LimitError(`Image too large: ${this.count} frames exceed the limit of ${this.limit} pixels${this.floor ? `, at least ${this.floor} each` : ''} (the decode options' maxPixels)`);
    }
}

/**
 * Runs a decoder: reading past the end of damaged or truncated data throws a RangeError, which becomes an Error saying
 * so (with the RangeError as its cause); exceeded limits stay RangeErrors
 */
export async function decoding<T>(decode: () => T | Promise<T>): Promise<T> {
    try {
        return await decode();
    } catch (err) {
        if (err instanceof RangeError && !(err instanceof LimitError)) throw new Error('Image: damaged or truncated image data', { cause: err });
        throw err;
    }
}
