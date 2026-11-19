import { shown } from './options.ts';
/** Data accepted wherever binary input is expected */
export type BinaryData = ArrayBuffer | ArrayBufferView;

/** Whether a value is binary data (an ArrayBuffer, a SharedArrayBuffer or a view), also one of another realm */
export function isBinaryData(value: unknown): value is BinaryData {
    if (ArrayBuffer.isView(value)) return true;
    const tag = Object.prototype.toString.call(value);
    return tag === '[object ArrayBuffer]' || tag === '[object SharedArrayBuffer]';
}

/**
 * Returns a Uint8Array view of the given buffer without copying
 */
export function view(buffer: BinaryData): Uint8Array {
    // subclasses like node's Buffer are unwrapped, their slice() doesn't copy
    if (buffer instanceof Uint8Array && buffer.constructor === Uint8Array) return buffer;
    if (ArrayBuffer.isView(buffer)) return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    // (by its tag, not instanceof: a buffer of another realm, an iframe's or a vm context's, isn't an instance here)
    const tag = Object.prototype.toString.call(buffer);
    if (tag === '[object ArrayBuffer]' || tag === '[object SharedArrayBuffer]') return new Uint8Array(buffer);

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
