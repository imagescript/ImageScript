import { shown } from './options.ts';
/** Data accepted wherever binary input is expected */
export type BinaryData = ArrayBuffer | ArrayBufferView;

// eslint-disable-next-line @typescript-eslint/unbound-method -- called on the value, as a check
const byteLengthOf = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
// eslint-disable-next-line @typescript-eslint/unbound-method -- called on the value, as a check
const sharedByteLengthOf = typeof SharedArrayBuffer === 'undefined' ? null : Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'byteLength')!.get!;

/** Whether a value is a buffer (an ArrayBuffer or a SharedArrayBuffer), also one of another realm */
function isBuffer(value: unknown): value is ArrayBuffer {
    // (by the byteLength getter's own check, not instanceof: a buffer of another realm, an iframe's or a vm context's,
    // isn't an instance here; nor by the tag, which any object can claim)
    if (typeof value !== 'object' || value === null) return false;
    for (const getter of [byteLengthOf, sharedByteLengthOf]) {
        try {
            getter?.call(value);
            if (getter) return true;
        } catch { /* another kind */ }
    }
    return false;
}

/** Whether a value is binary data (an ArrayBuffer, a SharedArrayBuffer or a view), also one of another realm */
export function isBinaryData(value: unknown): value is BinaryData {
    return ArrayBuffer.isView(value) || isBuffer(value);
}

/**
 * Returns a Uint8Array view of the given buffer without copying
 */
export function view(buffer: BinaryData): Uint8Array {
    // (a buffer transferred away, to a worker for one, has no data: said so instead of the engine's construct error, or
    // the "unsupported type" of 0 bytes)
    const data = ArrayBuffer.isView(buffer) ? buffer.buffer : buffer;
    if (isBuffer(data) && (data as { detached?: boolean }).detached === true)
        throw new TypeError('Binary data has to be readable, not of a detached ArrayBuffer (one transferred, to a worker for one)');
    // subclasses like node's Buffer are unwrapped, their slice() doesn't copy
    if (buffer instanceof Uint8Array && buffer.constructor === Uint8Array) return buffer;
    if (ArrayBuffer.isView(buffer)) return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (isBuffer(buffer)) return new Uint8Array(buffer);

    throw new TypeError(`Binary data has to be an ArrayBuffer or a typed array like Uint8Array, not ${shown(buffer)}`);
}

/**
 * Concatenates byte arrays
 */
export function concat(parts: ArrayLike<number>[]): Uint8Array<ArrayBuffer> {
    let length = 0;
    for (const part of parts) length += part.length;

    const out = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }

    return out;
}
