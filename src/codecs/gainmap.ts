// Gain map JPEGs (Ultra HDR, JPEG-R, ISO 21496-1): an SDR JPEG (the primary image) with a second JPEG appended, the
// gain map, which says how much brighter each part gets on an HDR display. The primary's MPF index (APP2 "MPF\0")
// says where the gain map is; the gain map's parameters are in its own ISO 21496-1 block (APP2) and/or Adobe's
// hdrgm XMP (APP1). Layout and defaults like Google's libultrahdr (lib/src/jpegr.cpp, gainmapmetadata.cpp).
// iPhones (iOS 14.1 on) write their own kind: the gain map is an MPF image marked by Apple's XMP, its headroom in that
// XMP (iOS 18 on) or in the primary's Exif maker note, and it boosts by 1 + (headroom - 1) * value^1.961 (like
// Skia: SkXmp.cpp, SkExif.cpp, SkGainmapShader.cpp)

/** The parameters of a gain map (log2 values like hdrgm's XMP; per channel: red, green, blue) */
export interface Params {
    /** log2 of the smallest boost (stored value 0) */
    min: number[];
    /** log2 of the largest boost (stored value 255) */
    max: number[];
    /** the stored values' gamma */
    gamma: number[];
    /** added to the SDR and HDR linear values before the ratio (keeps black finite) */
    offsetSDR: number[];
    offsetHDR: number[];
    /** log2 of the display headroom from which on the map starts to apply, and from which on fully */
    capacityMin: number;
    capacityMax: number;
    /** whether the gains apply in the base image's color space (else the HDR image's) */
    useBaseColorSpace: boolean;
}

const XMP_NAMESPACE = 'http://ns.adobe.com/xap/1.0/\0';
const ISO_NAMESPACE = 'urn:iso:std:iso:ts:21496:-1\0';
const MPF_SIGNATURE = 'MPF\0';
const HDRGM_URI = 'http://ns.adobe.com/hdr-gain-map/1.0/';
const APPLE_GAIN_MAP = 'urn:com:apple:photo:2020:aux:hdrgainmap';
/** The exponent of Apple's gain map values */
export const APPLE_GAMMA = 1.961;

const ascii = (text: string): Uint8Array => Uint8Array.from(text, c => c.charCodeAt(0));
const startsWith = (data: Uint8Array, offset: number, text: string): boolean => {
    if (offset + text.length > data.length) return false;
    for (let i = 0; i < text.length; i++) if (data[offset + i] !== text.charCodeAt(i)) return false;
    return true;
};
const latin1 = (data: Uint8Array): string => {
    let text = '';
    for (let i = 0; i < data.length; i += 0x8000) text += String.fromCharCode(...data.subarray(i, i + 0x8000));
    return text;
};

/** A marker segment of a JPEG's header: its marker, where it starts (the 0xff) and its body */
interface Segment {
    marker: number;
    start: number;
    end: number;
    body: Uint8Array;
}

/** The segments before the first scan (or the image's end) */
export function segments(data: Uint8Array): Segment[] {
    const out: Segment[] = [];
    if (data[0] !== 0xff || data[1] !== 0xd8) return out;
    let p = 2;
    while (p + 4 <= data.length) {
        if (data[p] !== 0xff) break;
        const marker = data[p + 1];
        if (marker === 0xff) {
            p++;
            continue;
        }
        if (marker === 0xda || marker === 0xd9) break;
        if (marker >= 0xd0 && marker <= 0xd7 || marker === 0x01) {
            p += 2;
            continue;
        }
        const length = data[p + 2] << 8 | data[p + 3];
        if (length < 2 || p + 2 + length > data.length) break;
        out.push({ marker, start: p, end: p + 2 + length, body: data.subarray(p + 4, p + 2 + length) });
        p += 2 + length;
    }
    return out;
}

/** The number of color components of a JPEG (its frame header), 0 without one */
export function componentCount(data: Uint8Array): number {
    for (const { marker, body } of segments(data))
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return body[5] ?? 0;
    return 0;
}

/** The size of a JPEG (its frame header), null without one */
export function dimensions(data: Uint8Array): { width: number, height: number } | null {
    for (const { marker, body } of segments(data))
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc && body.length >= 5)
            return { width: body[3] << 8 | body[4], height: body[1] << 8 | body[2] };
    return null;
}

// the images after the first of the primary's MPF index (none that lie outside the file: chat apps and some uploads
// cut the gain map off but keep the index)
function mpfImages(data: Uint8Array, primary: Segment[]): Uint8Array[] {
    const images: Uint8Array[] = [];
    for (const { marker, body, start } of primary) {
        if (marker !== 0xe2 || !startsWith(body, 0, MPF_SIGNATURE)) continue;
        const tiff = start + 4 + 4;
        const view = new DataView(data.buffer, data.byteOffset + tiff, body.length - 4);
        if (view.byteLength < 8) return images;
        const little = view.getUint16(0) === 0x4949;
        const u16 = (o: number): number => view.getUint16(o, little), u32 = (o: number): number => view.getUint32(o, little);
        const ifd = u32(4);
        if (ifd + 2 > view.byteLength) return images;
        const count = u16(ifd);
        let entries = -1, imageCount = 0;
        for (let k = 0; k < count; k++) {
            const t = ifd + 2 + 12 * k;
            if (t + 12 > view.byteLength) return images;
            const tag = u16(t);
            if (tag === 0xb001) imageCount = u32(t + 8);
            if (tag === 0xb002) entries = u32(t + 8);
        }
        if (entries < 0 || imageCount < 2) return images;
        for (let k = 1; k < imageCount; k++) {
            const e = entries + 16 * k;
            if (e + 16 > view.byteLength) return images;
            const size = u32(e + 4), offset = u32(e + 8);
            if (!offset || !size) continue;
            const begin = tiff + offset;
            if (begin + size > data.length || data[begin] !== 0xff || data[begin + 1] !== 0xd8) continue;
            images.push(data.subarray(begin, begin + size));
        }
        return images;
    }
    return images;
}

// the gain map by the primary's XMP container directory (its Item:Length, at the end of the file), for files without
// a usable MPF index
function containerSecondImage(data: Uint8Array, primary: Segment[]): Uint8Array | null {
    for (const { marker, body } of primary) {
        if (marker !== 0xe1 || !startsWith(body, 0, XMP_NAMESPACE)) continue;
        const xmp = latin1(body.subarray(XMP_NAMESPACE.length));
        const item = /Item:Semantic\s*=\s*["']GainMap["'][^>]*?Item:Length\s*=\s*["'](\d+)["']|Item:Length\s*=\s*["'](\d+)["'][^>]*?Item:Semantic\s*=\s*["']GainMap["']/.exec(xmp);
        if (!item) return null;
        const length = Number(item[1] ?? item[2]), begin = data.length - length;
        if (!(length > 0) || begin <= 0 || data[begin] !== 0xff || data[begin + 1] !== 0xd8) return null;
        return data.subarray(begin);
    }
    return null;
}

/**
 * A JPEG's gain map (the map's JPEG) and its parameters, null if it has none (or none that can be read). `apple`: the
 * headroom of an Apple gain map, whose values need converting (see {@link appleValue})
 */
export function find(data: Uint8Array): { map: Uint8Array, params: Params, apple?: number } | null {
    const primary = segments(data);
    const images = mpfImages(data, primary);
    const container = containerSecondImage(data, primary);
    if (container) images.push(container);
    for (const map of images) {
        const params = readParams(map);
        if (params) return { map, params };
    }
    // (Apple's: the headroom read only once a map is marked as one)
    for (const map of images) {
        const apple = readApple(map, primary);
        if (apple) return { map, ...apple };
    }
    return null;
}

/** An Apple gain map's stored value (0-1) as the value of the parameters {@link find} gives it (log2 gain over the headroom's) */
export const appleValue = (value: number, headroom: number): number => Math.log2(1 + (headroom - 1) * value ** APPLE_GAMMA) / Math.log2(headroom);

// an MPF image marked as Apple's gain map: its headroom (its XMP's, else the primary's maker note's) and parameters
// for the converted values (log2 gain 0 up to the headroom's, like the display applies it)
function readApple(map: Uint8Array, primary: Segment[]): { params: Params, apple: number } | null {
    let xmp: string | null = null;
    for (const { marker, body } of segments(map))
        if (marker === 0xe1 && startsWith(body, 0, XMP_NAMESPACE)) xmp = latin1(body.subarray(XMP_NAMESPACE.length));
    if (!xmp || !xmp.includes(APPLE_GAIN_MAP) || !/HDRGainMapVersion/.test(xmp)) return null;
    const value = (name: string): number | null => {
        const m = new RegExp(`:${name}\\s*(?:=\\s*["']([^"']*)["']|>([^<]*)<)`).exec(xmp);
        return m ? Number((m[1] ?? m[2]).trim()) : null;
    };
    const headroom = value('HDRGainMapHeadroom') ?? makerNoteHeadroom(primary);
    if (!(headroom !== null && headroom > 1 && Number.isFinite(headroom))) return null;
    const stops = Math.log2(headroom);
    const params: Params = { min: [0, 0, 0], max: [stops, stops, stops], gamma: [1, 1, 1], offsetSDR: [0, 0, 0], offsetHDR: [0, 0, 0], capacityMin: 0, capacityMax: stops, useBaseColorSpace: true };
    return { params, apple: headroom };
}

// the headroom of an iPhone photo from its Exif maker note (tags 33 and 48: Apple's "Applying Apple HDR effect to your
// photos", by Skia's SkExif.cpp), null without one
function makerNoteHeadroom(primary: Segment[]): number | null {
    const exif = primary.find(({ marker, body }) => marker === 0xe1 && startsWith(body, 0, 'Exif\0\0'));
    if (!exif) return null;
    const tiff = exif.body.subarray(6);
    if (tiff.length < 8) return null;
    const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
    const little = view.getUint16(0) === 0x4949;
    // an IFD's entries: tag, type, count, value or offset (from `base`)
    const entries = (v: DataView, at: number, le: boolean): { tag: number, type: number, count: number, value: number }[] => {
        if (at + 2 > v.byteLength) return [];
        const out = [];
        for (let k = 0, n = v.getUint16(at, le); k < n && at + 2 + 12 * k + 12 <= v.byteLength; k++) {
            const e = at + 2 + 12 * k;
            out.push({ tag: v.getUint16(e, le), type: v.getUint16(e + 2, le), count: v.getUint32(e + 4, le), value: v.getUint32(e + 8, le) });
        }
        return out;
    };
    const sub = entries(view, view.getUint32(4, little), little).find(e => e.tag === 0x8769);
    const note = sub && entries(view, sub.value, little).find(e => e.tag === 0x927c);
    if (!note || note.value + note.count > tiff.length) return null;
    const maker = tiff.subarray(note.value, note.value + note.count);
    if (!startsWith(maker, 0, 'Apple iOS\0\0\x01MM')) return null;
    const mv = new DataView(maker.buffer, maker.byteOffset, maker.byteLength);
    let m33: number | null = null, m48 = 0;
    for (const { tag, type, count, value } of entries(mv, 14, false)) {
        if ((tag !== 33 && tag !== 48) || type !== 10 || count < 1 || value + 8 > maker.length) continue;
        const d = mv.getUint32(value + 4);
        if (!d) continue;
        const r = mv.getInt32(value) / d;
        if (tag === 33) m33 = r; else m48 = r;
    }
    if (m33 === null) return null;
    const stops = m33 < 1 ? (m48 <= 0.01 ? -20 * m48 + 1.8 : -0.101 * m48 + 1.601) : (m48 <= 0.01 ? -70 * m48 + 3 : -0.303 * m48 + 2.303);
    return 2 ** Math.max(stops, 0);
}

/** The parameters in a gain map JPEG: ISO 21496-1 first (like libultrahdr), else hdrgm XMP; null if neither is valid */
export function readParams(map: Uint8Array): Params | null {
    const list = segments(map);
    for (const { marker, body } of list)
        if (marker === 0xe2 && startsWith(body, 0, ISO_NAMESPACE)) {
            const params = readISO(body.subarray(ISO_NAMESPACE.length));
            if (params) return params;
        }
    for (const { marker, body } of list)
        if (marker === 0xe1 && startsWith(body, 0, XMP_NAMESPACE)) {
            const params = readXMP(latin1(body.subarray(XMP_NAMESPACE.length)));
            if (params) return params;
        }
    return null;
}

/** Whether parameters can be used: finite, gamma above 0, max at least min, capacity max above min */
export function valid(p: Params): boolean {
    const ok = (v: number): boolean => Number.isFinite(v);
    for (let c = 0; c < 3; c++)
        if (!ok(p.min[c]) || !ok(p.max[c]) || !ok(p.gamma[c]) || !ok(p.offsetSDR[c]) || !ok(p.offsetHDR[c]) || p.gamma[c] <= 0 || p.max[c] < p.min[c]) return false;
    return ok(p.capacityMin) && ok(p.capacityMax) && p.capacityMax > p.capacityMin && p.capacityMin >= 0;
}

// ISO 21496-1 (version 0): u16 minimum version, u16 writer version, flags (0x80: 3 channels, 0x40: use the base color
// space, 4: the base is the HDR image, 8: a common denominator; libultrahdr's bits), then the headrooms and per channel min, max, gamma,
// base offset, alternate offset, as fractions (big endian, signed where they can be negative)
export function readISO(data: Uint8Array): Params | null {
    if (data.length < 5) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (view.getUint16(0) !== 0) return null;
    const flags = data[4];
    // (the HDR image as the base: unsupported, like libultrahdr)
    if (flags & 4) return null;
    const channels = flags & 0x80 ? 3 : 1, common = (flags & 8) !== 0;
    let p = 5;
    const need = (n: number): boolean => p + n <= data.length;
    let denominator = 1;
    if (common) {
        if (!need(4)) return null;
        denominator = view.getUint32(p);
        p += 4;
        if (!denominator) return null;
    }
    const fraction = (signed: boolean): number => {
        if (!need(common ? 4 : 8)) return NaN;
        const n = signed ? view.getInt32(p) : view.getUint32(p);
        const d = common ? denominator : view.getUint32(p + 4);
        p += common ? 4 : 8;
        return d ? n / d : NaN;
    };
    const capacityMin = fraction(false), capacityMax = fraction(false);
    const min: number[] = [], max: number[] = [], gamma: number[] = [], offsetSDR: number[] = [], offsetHDR: number[] = [];
    for (let c = 0; c < channels; c++) {
        min.push(fraction(true));
        max.push(fraction(true));
        gamma.push(fraction(false));
        offsetSDR.push(fraction(true));
        offsetHDR.push(fraction(true));
    }
    const params = { min: fill3(min), max: fill3(max), gamma: fill3(gamma), offsetSDR: fill3(offsetSDR), offsetHDR: fill3(offsetHDR), capacityMin, capacityMax, useBaseColorSpace: (flags & 0x40) !== 0 };
    return valid(params) ? params : null;
}

const fill3 = (values: number[]): number[] => values.length === 1 ? [values[0], values[0], values[0]] : values.slice(0, 3);

// hdrgm XMP: attributes (hdrgm:GainMapMax="2.5") or elements, per channel as an rdf:Seq; Version, GainMapMax and
// HDRCapacityMax are required, the others have defaults (libultrahdr's: min 0, gamma 1, offsets 1/64, capacity min 0)
function readXMP(xmp: string): Params | null {
    if (!xmp.includes(HDRGM_URI)) return null;
    const prefix = /xmlns:([\w-]+)\s*=\s*["']http:\/\/ns\.adobe\.com\/hdr-gain-map\/1\.0\/["']/.exec(xmp)?.[1] ?? 'hdrgm';
    const get = (name: string): string[] | null => {
        const attribute = new RegExp(`${prefix}:${name}\\s*=\\s*["']([^"']*)["']`).exec(xmp);
        if (attribute) return [attribute[1]];
        const element = new RegExp(`<${prefix}:${name}>([\\s\\S]*?)</${prefix}:${name}>`).exec(xmp);
        if (!element) return null;
        const items = [...element[1].matchAll(/<rdf:li[^>]*>([^<]*)<\/rdf:li>/g)].map(m => m[1]);
        return items.length ? items : [element[1].trim()];
    };
    const numbers = (name: string, fallback: number | null): number[] | null => {
        const values = get(name);
        if (!values) return fallback === null ? null : [fallback, fallback, fallback];
        if (values.length !== 1 && values.length !== 3) return null;
        const parsed = values.map(v => v.trim() === '' ? NaN : Number(v));
        return fill3(parsed);
    };
    if (!get('Version')) return null;
    if (/^\s*true\s*$/i.test(get('BaseRenditionIsHDR')?.[0] ?? '')) return null;
    const max = numbers('GainMapMax', null), capacityMax = numbers('HDRCapacityMax', null);
    const min = numbers('GainMapMin', 0), gamma = numbers('Gamma', 1);
    const offsetSDR = numbers('OffsetSDR', 1 / 64), offsetHDR = numbers('OffsetHDR', 1 / 64), capacityMin = numbers('HDRCapacityMin', 0);
    if (!max || !capacityMax || !min || !gamma || !offsetSDR || !offsetHDR || !capacityMin) return null;
    const params = { min, max, gamma, offsetSDR, offsetHDR, capacityMin: capacityMin[0], capacityMax: capacityMax[0], useBaseColorSpace: true };
    return valid(params) ? params : null;
}

const identical = (values: number[]): boolean => values[0] === values[1] && values[0] === values[2];
/** Whether the parameters are the same for every channel */
export function singleChannel(p: Params): boolean {
    return identical(p.min) && identical(p.max) && identical(p.gamma) && identical(p.offsetSDR) && identical(p.offsetHDR);
}

// a fraction n/d close to the value: d a power of two as large as n allows (exact for binary fractions)
function toFraction(value: number, signed: boolean): [number, number] {
    const limit = signed ? 0x7fffffff : 0xffffffff;
    let d = 1 << 30;
    while (d > 1 && Math.abs(value) * d > limit) d /= 2;
    // (unsigned denominators up to 2^31 too)
    if (!signed && Math.abs(value) * d * 2 <= limit) d *= 2;
    return [Math.round(value * d), d];
}

/** The ISO 21496-1 block of a gain map (after the namespace) */
export function writeISO(p: Params): Uint8Array {
    const channels = singleChannel(p) ? 1 : 3;
    const out = new Uint8Array(5 + 16 + channels * 40);
    const view = new DataView(out.buffer);
    out[4] = (channels === 3 ? 0x80 : 0) | (p.useBaseColorSpace ? 0x40 : 0);
    let o = 5;
    const write = (value: number, signed: boolean): void => {
        const [n, d] = toFraction(value, signed);
        if (signed) view.setInt32(o, n); else view.setUint32(o, n);
        view.setUint32(o + 4, d);
        o += 8;
    };
    write(p.capacityMin, false);
    write(p.capacityMax, false);
    for (let c = 0; c < channels; c++) {
        write(p.min[c], true);
        write(p.max[c], true);
        write(p.gamma[c], false);
        write(p.offsetSDR[c], true);
        write(p.offsetHDR[c], true);
    }
    return out;
}

const number = (v: number): string => String(Math.round(v * 1e6) / 1e6);

/** The hdrgm XMP of a gain map (per channel values as rdf:Seq where they differ) */
export function writeMapXMP(p: Params): string {
    const attributes: string[] = [`hdrgm:Version="1.0"`];
    const elements: string[] = [];
    const add = (name: string, values: number[]): void => {
        if (identical(values)) attributes.push(`hdrgm:${name}="${number(values[0])}"`);
        else elements.push(`<hdrgm:${name}><rdf:Seq>${values.map(v => `<rdf:li>${number(v)}</rdf:li>`).join('')}</rdf:Seq></hdrgm:${name}>`);
    };
    add('GainMapMin', p.min);
    add('GainMapMax', p.max);
    add('Gamma', p.gamma);
    add('OffsetSDR', p.offsetSDR);
    add('OffsetHDR', p.offsetHDR);
    attributes.push(`hdrgm:HDRCapacityMin="${number(p.capacityMin)}"`, `hdrgm:HDRCapacityMax="${number(p.capacityMax)}"`, 'hdrgm:BaseRenditionIsHDR="False"');
    const description = `<rdf:Description rdf:about="" xmlns:hdrgm="${HDRGM_URI}" ${attributes.join(' ')}${elements.length ? `>${elements.join('')}</rdf:Description>` : '/>'}`;
    return `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="ImageScript"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">${description}</rdf:RDF></x:xmpmeta>`;
}

/** The primary image's XMP: the container directory (the gain map's length) and hdrgm:Version */
export function writePrimaryXMP(mapLength: number): string {
    return '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="ImageScript"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        + `<rdf:Description xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/" xmlns:hdrgm="${HDRGM_URI}" hdrgm:Version="1.0">`
        + '<Container:Directory><rdf:Seq>'
        + '<rdf:li rdf:parseType="Resource"><Container:Item Item:Semantic="Primary" Item:Mime="image/jpeg"/></rdf:li>'
        + `<rdf:li rdf:parseType="Resource"><Container:Item Item:Semantic="GainMap" Item:Mime="image/jpeg" Item:Length="${mapLength}"/></rdf:li>`
        + '</rdf:Seq></Container:Directory></rdf:Description></rdf:RDF></x:xmpmeta>';
}

const segmentBytes = (marker: number, body: Uint8Array): Uint8Array => {
    if (body.length > 65533) throw new RangeError('JPEG: metadata too large');
    const out = new Uint8Array(4 + body.length);
    out.set([0xff, marker, body.length + 2 >> 8, body.length + 2 & 255]);
    out.set(body, 4);
    return out;
};
const join = (parts: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
};

/** A JPEG without its XMP, ISO 21496-1 and MPF segments (a gain map's compressed pixels, for new metadata) */
export function stripMetadata(jpeg: Uint8Array): Uint8Array {
    const remove = segments(jpeg).filter(({ marker, body }) => marker === 0xe1 && startsWith(body, 0, XMP_NAMESPACE)
        || marker === 0xe2 && (startsWith(body, 0, ISO_NAMESPACE) || startsWith(body, 0, MPF_SIGNATURE)));
    if (!remove.length) return jpeg;
    const parts: Uint8Array[] = [];
    let p = 0;
    for (const { start, end } of remove) {
        parts.push(jpeg.subarray(p, start));
        p = end;
    }
    parts.push(jpeg.subarray(p));
    return join(parts);
}

// inserts segments after a JPEG's APP0 (JFIF) segment if it starts with one, else after SOI
function insert(jpeg: Uint8Array, added: Uint8Array[]): Uint8Array {
    let at = 2;
    if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + (jpeg[4] << 8 | jpeg[5]);
    return join([jpeg.subarray(0, at), ...added, jpeg.subarray(at)]);
}

/** A gain map JPEG with its metadata (hdrgm XMP and ISO 21496-1), from its compressed pixels */
export function mapWithMetadata(body: Uint8Array, p: Params): Uint8Array {
    const added = [segmentBytes(0xe1, join([ascii(XMP_NAMESPACE), ascii(writeMapXMP(p))])), segmentBytes(0xe2, join([ascii(ISO_NAMESPACE), writeISO(p)]))];
    return insert(stripMetadata(body), added);
}

const MPF_LENGTH = 4 + 50 + 32;

/** The primary's extra segments (XMP, ISO 21496-1 version, an MPF index to fill in by {@link finish}) */
export function primarySegments(mapLength: number): Uint8Array[] {
    return [
        segmentBytes(0xe1, join([ascii(XMP_NAMESPACE), ascii(writePrimaryXMP(mapLength))])),
        segmentBytes(0xe2, join([ascii(ISO_NAMESPACE), new Uint8Array(4)])),
        segmentBytes(0xe2, join([ascii(MPF_SIGNATURE), new Uint8Array(MPF_LENGTH - 4)]))
    ];
}

/** Fills in the primary's MPF index (big endian like libultrahdr) and appends the gain map */
export function finish(primary: Uint8Array, map: Uint8Array): Uint8Array {
    const mpf = segments(primary).find(({ marker, body }) => marker === 0xe2 && startsWith(body, 0, MPF_SIGNATURE));
    if (!mpf) throw new Error('JPEG: missing MPF segment');
    const tiff = mpf.start + 4 + 4;
    const view = new DataView(primary.buffer, primary.byteOffset + tiff, MPF_LENGTH - 4);
    view.setUint32(0, 0x4d4d002a);
    view.setUint32(4, 8);
    view.setUint16(8, 3);
    // version "0100", 2 images, the entries at 50
    view.setUint16(10, 0xb000); view.setUint16(12, 7); view.setUint32(14, 4); view.setUint32(18, 0x30313030);
    view.setUint16(22, 0xb001); view.setUint16(24, 4); view.setUint32(26, 1); view.setUint32(30, 2);
    view.setUint16(34, 0xb002); view.setUint16(36, 7); view.setUint32(38, 32); view.setUint32(42, 50);
    view.setUint32(46, 0);
    view.setUint32(50, 0x030000); view.setUint32(54, primary.length); view.setUint32(58, 0);
    view.setUint32(66, 0); view.setUint32(70, map.length); view.setUint32(74, primary.length - tiff);
    return join([primary, map]);
}
