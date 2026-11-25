const {Image} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};

// LZW-compressed TIFFs: valid streams (new style, and the LSB-first style of libtiff before 5.0) must decode to their
// data; damaged ones (cut, bytes flipped) must decode to what the decoder of ImageScript 4.0.0 made of them, which is
// kept here as the reference

let seed = 4242;
const random = () => (seed = seed * 1103515245 + 12345 >>> 0) / 2 ** 32;

/** TIFF LZW (section 13 of the TIFF 6.0 specification); `old` writes LSB first codes without the early change */
function encode(data, old) {
    const out = [];
    let buffer = 0, bits = 0;
    const put = (code, size) => {
        if (old) {
            buffer |= code << bits;
            bits += size;
            while (bits >= 8) { out.push(buffer & 255); buffer >>>= 8; bits -= 8; }
        } else {
            buffer = (buffer << size | code) & 0xffffff;
            bits += size;
            while (bits >= 8) { out.push(buffer >> bits - 8 & 255); bits -= 8; }
        }
    };
    let table = new Map(), next = 258, size = 9;
    const early = old ? 0 : 1;
    put(256, size);
    let w = '';
    for (const byte of data) {
        const wc = w + String.fromCharCode(byte);
        if (w === '' || table.has(wc) || wc.length === 1 && !w) { w = wc; continue; }
        put(w.length === 1 ? w.charCodeAt(0) : table.get(w), size);
        table.set(wc, next++);
        if (next + early > 1 << size && size < 12) size++;
        if (next + early >= 4094) {
            put(256, size);
            table = new Map(); next = 258; size = 9;
        }
        w = String.fromCharCode(byte);
    }
    if (w) put(w.length === 1 ? w.charCodeAt(0) : table.get(w), size);
    put(257, size);
    if (bits) put(0, 8 - bits);
    return Uint8Array.from(out);
}

// the LZW decoder of ImageScript 4.0.0
function reference(input, expected) {
    const out = new Uint8Array(expected);
    const compat = input[0] === 0 && (input[1] & 1) === 1;
    const prefix = new Uint16Array(4096), suffix = new Uint8Array(4096), first = new Uint8Array(4096), lengths = new Uint16Array(4096);
    for (let i = 0; i < 256; i++) { suffix[i] = first[i] = i; lengths[i] = 1; }
    let codeSize = 9, next = 258, previous = -1, buffer = 0, bits = 0, position = 0, written = 0;
    while (written < expected) {
        while (bits < codeSize) {
            if (position >= input.length) return out.subarray(0, written);
            buffer = compat ? buffer | input[position++] << bits : (buffer << 8 | input[position++]) & 0xffffff;
            bits += 8;
        }
        let code;
        if (compat) { code = buffer & (1 << codeSize) - 1; buffer >>>= codeSize; } else code = buffer >> bits - codeSize & (1 << codeSize) - 1;
        bits -= codeSize;
        if (code === 256) { codeSize = 9; next = 258; previous = -1; continue; }
        if (code === 257) break;
        let entry;
        if (previous === -1) { if (code > 255) break; entry = code; } else if (code < next) entry = code; else if (code === next) entry = previous; else break;
        const length = lengths[entry];
        let c = entry;
        for (let i = written + length - 1; i >= written; i--) { if (i < expected) out[i] = suffix[c]; c = prefix[c]; }
        written += length;
        if (code === next && written < expected) out[written] = first[previous];
        if (code === next) written++;
        if (previous !== -1 && next < 4096) {
            prefix[next] = previous; suffix[next] = first[code === next ? previous : code];
            first[next] = first[previous]; lengths[next] = lengths[previous] + 1; next++;
        }
        if (next + (compat ? 0 : 1) >= 1 << codeSize && codeSize < 12) codeSize++;
        previous = code;
    }
    return out.subarray(0, Math.min(written, expected));
}

/** An 8-bit gray TIFF of one strip, `width` x 1 */
function tiff(strip, width) {
    const tags = [[256, width], [257, 1], [258, 8], [259, 5], [262, 1], [273, 0], [277, 1], [278, 1], [279, strip.length]];
    const ifd = 8, data = ifd + 2 + tags.length * 12 + 4;
    const out = new Uint8Array(data + strip.length);
    const view = new DataView(out.buffer);
    out[0] = out[1] = 0x49;
    view.setUint16(2, 42, true);
    view.setUint32(4, ifd, true);
    view.setUint16(ifd, tags.length, true);
    tags.forEach(([tag, value], i) => {
        const entry = ifd + 2 + i * 12;
        view.setUint16(entry, tag, true);
        view.setUint16(entry + 2, 4, true);
        view.setUint32(entry + 4, 1, true);
        view.setUint32(entry + 8, tag === 273 ? data : value, true);
    });
    out.set(strip, data);
    return out;
}

async function decoded(strip, width) {
    const image = await Image.decode(tiff(strip, width));
    return Uint8Array.from({ length: width }, (_, x) => image.bitmap[x * 4]);
}

function sample(length) {
    const kind = random() * 4 | 0;
    const data = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        if (kind === 0) data[i] = random() * 256;
        else if (kind === 1) data[i] = random() < 0.9 && i ? data[i - 1] : random() * 4; // long runs of few values
        else if (kind === 2) data[i] = i % 13 * 19 + (random() < 0.02 ? 1 : 0); // repeats
        else data[i] = Math.abs(Math.sin(i / 50)) * 255 + random() * 3; // smooth
    }
    return data;
}

(async () => {
    let checked = 0;
    for (const old of [false, true])
        for (let n = 0; n < 24; n++) {
            const length = n < 4 ? [1, 2, 300, 9000][n] : 1 + (random() * 60000 | 0);
            const data = sample(length);
            const strip = encode(data, old);
            const got = await decoded(strip, length);
            const at = got.findIndex((v, i) => v !== data[i]);
            if (at >= 0) panic(`${old ? 'old style' : 'LZW'} ${length} bytes: byte ${at} is ${got[at]}, expected ${data[at]}`);

            // damaged: cut, and flipped bytes; the result must be the 4.0.0 decoder's (padded with zeros)
            for (let k = 0; k < 6; k++) {
                const broken = strip.slice(0, k < 2 ? 1 + (random() * strip.length | 0) : strip.length);
                if (k >= 2) for (let f = 0; f < k; f++) broken[random() * broken.length | 0] ^= 1 << (random() * 8 | 0);
                const want = new Uint8Array(length);
                want.set(reference(broken, length));
                const result = await decoded(broken, length).catch(error => error);
                if (result instanceof Error) panic(`damaged ${old ? 'old style' : 'LZW'} stream threw ${result}`);
                const bad = result.findIndex((v, i) => v !== want[i]);
                if (bad >= 0) panic(`damaged ${old ? 'old style' : 'LZW'} stream (${length} bytes, case ${k}): byte ${bad} is ${result[bad]}, the 4.0.0 decoder gave ${want[bad]}`);
                checked++;
            }
        }
    if (checked !== 288) panic(`checked ${checked} damaged streams`);
})();
