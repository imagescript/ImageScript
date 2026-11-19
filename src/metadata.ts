import { encode as utf8 } from './util/utf8.ts';
import { shown } from './util/options.ts';
import * as exif from './codecs/exif.ts';

/**
 * Metadata written by the encoders. Each format stores the fields it has a place for:
 *
 * | Format | Fields |
 * |---|---|
 * | PNG, APNG | all (as text chunks) |
 * | JPEG | author, description, copyright, creation time, software (Exif); comment (comment marker) |
 * | WebP, AVIF, JPEG XL | author, description, copyright, creation time, software (Exif) |
 * | GIF | software, comment (comment extensions) |
 * | TGA | author, comment, creation time, software (extension area) |
 *
 * The Exif and TGA text fields are ASCII in the file format; other characters are written as UTF-8, which readers
 * that follow the format show wrongly. PNG text chunks take any text.
 *
 * Decoding doesn't read metadata: it applies the orientation and the ICC profile to the pixels and drops the rest
 * (Exif, XMP, text), so a decoded image is written with only the metadata given to the encoder.
 *
 * Some formats limit the length: in JPEG the comment and the Exif fields together hold up to 65533 bytes each, and
 * longer ones throw a `RangeError` before encoding. TGA cuts the author and the software to 40 bytes and the comment to
 * 4 lines of 80 bytes.
 *
 * Empty fields (and `null` ones) are left out. Without metadata, the files only say which software made them (`software`), so the same
 * image always encodes to the same bytes
 */
export interface Metadata {
    /** The image's title */
    title?: string;
    /** The image's author */
    author?: string;
    /** The image's description */
    description?: string;
    /** The image's copyright info */
    copyright?: string;
    /**
     * The image's creation time (a date, a timestamp or a date string, in the years 1000 to 9999: the formats write
     * the year with 4 digits)
     * @defaultValue None (`null` leaves it out, too)
     */
    creationTime?: string | number | Date | null;
    /**
     * The software used to create the image
     * @defaultValue `'ImageScript'` (without a version), `null` leaves it out
     */
    software?: string | null;
    /** A disclaimer for the image */
    disclaimer?: string;
    /** A warning for the image */
    warning?: string;
    /** The image's source */
    source?: string;
    /** A comment for the image */
    comment?: string;
}

/**
 * @internal metadata with the defaults applied and empty fields removed
 * @ignore
 */
export interface ResolvedMetadata {
    title?: string;
    author?: string;
    description?: string;
    copyright?: string;
    creationTime?: Date;
    software?: string;
    disclaimer?: string;
    warning?: string;
    source?: string;
    comment?: string;
}

const TEXT_FIELDS = ['title', 'author', 'description', 'copyright', 'software', 'disclaimer', 'warning', 'source', 'comment'] as const;

/**
 * @internal
 * @ignore
 */
export function resolveMetadata(metadata: Metadata = {}): ResolvedMetadata {
    if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata))
        throw new TypeError(`metadata takes an object, like { title: 'Sunset' }, not ${shown(metadata)}`);
    const { creationTime, software } = metadata;
    const resolved: ResolvedMetadata = {};
    if (creationTime !== undefined && creationTime !== null) {
        // (other types than these were turned into a date anyway: true was 1970)
        // (a Date by its tag, not instanceof: one of another realm, an iframe's or Jest's, isn't an instance here)
        if (Object.prototype.toString.call(creationTime) !== '[object Date]' && typeof creationTime !== 'number' && typeof creationTime !== 'string') {
            // eslint-disable-next-line no-restricted-syntax -- the one date in the options
            throw new TypeError(`creationTime must be a Date, a number or a string, not ${typeof creationTime === 'object' ? shown(creationTime) : typeof creationTime}`);
        }
        const time = new Date(creationTime);
        // eslint-disable-next-line no-restricted-syntax -- the one date in the options
        if (isNaN(time.getTime())) throw new RangeError(`creationTime must be a date, a timestamp or a date string, not ${shown(creationTime)}`);
        // (the year has 4 digits in Exif and PNG's text, and TGA stores it in 16 bits: years outside of them were written wrapped)
        const year = time.getUTCFullYear();
        // eslint-disable-next-line no-restricted-syntax -- the year is part of the one date in the options
        if (year < 1000 || year > 9999) throw new RangeError(`creationTime's year must be from 1000 to 9999, not ${year}`);
        resolved.creationTime = time;
    }
    for (const key of TEXT_FIELDS) {
        const value = key === 'software' && software === undefined ? 'ImageScript' : metadata[key];
        if (value === undefined || value === null || value === '') continue;
        if (typeof value !== 'string') throw new TypeError(`metadata ${key} must be a string, not ${shown(value)}`);
        resolved[key] = value;
    }
    return resolved;
}

/**
 * @internal PNG tEXt chunks, keyed by their keywords
 * @ignore
 */
export function pngText(m: ResolvedMetadata): Record<string, string | undefined> {
    return {
        Title: m.title,
        Author: m.author,
        Description: m.description,
        Copyright: m.copyright,
        'Creation Time': m.creationTime?.toUTCString(),
        Software: m.software,
        Disclaimer: m.disclaimer,
        Warning: m.warning,
        Source: m.source,
        Comment: m.comment
    };
}

/**
 * @internal Exif data (a TIFF header and IFDs) for JPEG, WebP, AVIF and JPEG XL
 * @ignore
 */
export function exifData(m: ResolvedMetadata): Uint8Array | undefined {
    // (an Exif block without any field is left out)
    if (!m.description && !m.software && !m.creationTime && !m.author && !m.copyright) return undefined;
    return exif.encode({
        description: m.description,
        software: m.software,
        dateTime: m.creationTime,
        artist: m.author,
        copyright: m.copyright
    });
}

/**
 * @internal GIF comment extensions
 * @ignore
 */
export function gifComments(m: ResolvedMetadata): Uint8Array[] {
    return [m.software, m.comment].filter((c): c is string => !!c).map(utf8);
}
